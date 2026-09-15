// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#include <unknwn.h>

#include "recorder.hpp"

#include <fstream>
#include <system_error>

#include <winrt/base.h>

#include "reelform/capture_math.hpp"
#include "reelform/meta.hpp"

namespace reelform::wgc {

namespace fs = std::filesystem;

namespace {
constexpr std::size_t kMaxInFlightTextures = 8;
constexpr std::uint64_t kDiskLowBytes = 500ULL * 1024ULL * 1024ULL;  // §5.6

std::string pathUtf8(const fs::path& p) { return win::toUtf8(p.wstring()); }

void removeQuietly(const fs::path& p) {
  std::error_code ec;
  fs::remove(p, ec);
}
}  // namespace

Recorder::Recorder(PostEvent post) : post_(std::move(post)) {}

Recorder::~Recorder() {
  // Never lose a recording that reached disk: finalise instead of discarding.
  if (active_) stop(false, "helperExit");
}

std::optional<StartError> Recorder::start(const protocol::StartOptions& options) {
  options_ = options;
  try {
    source_ = createFrameSource();
    source_->resolve(options);
    const auto adapter = source_->requiredAdapter();
    device_ = createDevice(adapter.get());
    const SourceInfo info = source_->open(device_.get());
    cursorCaptured_ = info.cursorCaptured;
    scaleFactor_ = info.scaleFactor;

    if (options.source.kind == protocol::SourceKind::Display) {
      crop_ = capture::normalizeRegion(options.region, info.width, info.height);
      if (!crop_) {
        releaseAll();
        return StartError{protocol::code::SourceNotFound, "region outside display bounds"};
      }
      outW_ = crop_->width;
      outH_ = crop_->height;
    } else {
      crop_.reset();
      outW_ = capture::evenFloor(info.width);
      outH_ = capture::evenFloor(info.height);
      if (outW_ < 2 || outH_ < 2) {
        releaseAll();
        return StartError{protocol::code::SourceNotFound, "window has no visible area"};
      }
    }

    dir_ = fs::path(win::toWide(options.outputDir));
    std::error_code ec;
    fs::create_directories(dir_, ec);
    if (ec) {
      releaseAll();
      return StartError{protocol::code::WriterFailed, "cannot create output directory: " + ec.message()};
    }
    videoPath_ = dir_ / L"screen.mp4";
    bitrate_ = capture::recordBitrate(outW_, outH_, options.fps);
    frameDurHns_ = 10'000'000LL / options.fps;

    pool_ = std::make_shared<OutputTexturePool>(device_.get(), static_cast<UINT>(outW_), static_cast<UINT>(outH_),
                                                kMaxInFlightTextures);
    VideoWriterConfig config;
    config.path = videoPath_.wstring();
    config.width = static_cast<UINT32>(outW_);
    config.height = static_cast<UINT32>(outH_);
    config.fps = options.fps;
    config.bitrate = bitrate_;
    config.preferHardware = true;
    std::string error;
    video_ = VideoWriter::create(device_.get(), config, error);
    if (!video_) {
      releaseAll();
      return StartError{protocol::code::WriterFailed, error};
    }

    if (options.audio.system) system_ = startAudio(AudioEndpointKind::SystemLoopback, {}, L"system.m4a");
    if (options.audio.wantsMic()) mic_ = startAudio(AudioEndpointKind::Microphone, options.audio, L"mic.m4a");

    active_ = true;
    startHostNs_ = qpc_.nowNs();
    source_->start(
        [this](ID3D11Texture2D* texture, std::int64_t w, std::int64_t h, std::int64_t hostNs) {
          onFrame(texture, w, h, hostNs);
        },
        [this](const std::string& reason, const std::string& message) {
          post_({PipelineEventType::SourceClosed, 0, reason, message});
        });
  } catch (const SourceError& e) {
    active_ = false;
    releaseAll();
    return StartError{e.code, e.what()};
  } catch (const winrt::hresult_error& e) {
    active_ = false;
    releaseAll();
    return StartError{protocol::code::StreamFailed,
                      win::toUtf8(std::wstring_view(e.message())) + " " + win::hresultText(static_cast<HRESULT>(e.code()))};
  } catch (const std::exception& e) {
    active_ = false;
    releaseAll();
    return StartError{protocol::code::Internal, e.what()};
  }
  return std::nullopt;
}

std::unique_ptr<Recorder::AudioTrack> Recorder::startAudio(AudioEndpointKind kind, const protocol::AudioOptions& mic,
                                                           const wchar_t* fileName) {
  auto track = std::make_unique<AudioTrack>();
  track->isMic = kind == AudioEndpointKind::Microphone;
  track->path = dir_ / fileName;
  const std::string label = track->isMic ? "mic" : "system";
  const std::string unavailable = track->isMic ? protocol::code::MicUnavailable : protocol::code::StreamFailed;
  std::string error;
  track->writer = AudioWriter::create(track->path.wstring(), error);
  if (!track->writer) {
    post_({PipelineEventType::AudioWarning, 0, protocol::code::WriterFailed, label + ": " + error});
    return nullptr;
  }
  track->capture = std::make_unique<WasapiCapture>(kind, mic);
  // Reported in `deviceLost.device`: the most specific identifier main sent.
  const std::string device = mic.micEndpointId ? *mic.micEndpointId
                             : (mic.mic && !mic.mic->empty()) ? *mic.mic
                             : mic.micLabel ? *mic.micLabel
                                            : std::string("default");
  AudioTrack* raw = track.get();
  const bool isMic = track->isMic;
  const bool ok = track->capture->start(
      [this, raw](const AudioPacket& packet) { onAudio(*raw, packet); },
      [this, label, isMic, device](const std::string& message) {
        // Mic loss is non-fatal (as on macOS): main gets `deviceLost` and recording
        // continues. A loopback endpoint change (headphones plugged in) also keeps
        // recording; both tracks are padded with silence at stop.
        if (isMic) {
          post_({PipelineEventType::DeviceLost, 0, device, message});
        } else {
          post_({PipelineEventType::AudioWarning, 0, protocol::code::StreamFailed, label + ": " + message});
        }
      },
      error);
  if (!ok) {
    std::string ignored;
    track->writer->finalize(ignored);
    removeQuietly(track->path);
    post_({PipelineEventType::AudioWarning, 0, unavailable, label + ": " + error});
    return nullptr;
  }
  if (track->capture->usedDefaultFallback()) {
    post_({PipelineEventType::AudioWarning, 0, protocol::code::MicUnavailable,
           "requested microphone not found; using the default device"});
  }
  return track;
}

void Recorder::onFrame(ID3D11Texture2D* texture, std::int64_t contentW, std::int64_t contentH, std::int64_t hostNs) {
  std::optional<std::int64_t> media;
  bool first = false;
  {
    std::lock_guard<std::mutex> lock(clockMutex_);
    if (stopping_) return;
    const bool wasAnchored = clock_.anchored();
    media = clock_.onVideoFrame(hostNs);
    first = !wasAnchored && clock_.anchored();
    if (first) firstFrameNs_ = hostNs;
  }
  if (first) post_({PipelineEventType::FirstFrame, hostNs, {}, {}});
  if (!media) return;  // paused: intentionally not counted as dropped

  const std::int64_t pts = timing::nsToHns(*media);
  if (!mono_.accept(pts)) {
    ++dropped_;
    return;
  }
  winrt::com_ptr<ID3D11Texture2D> out = pool_->acquire();
  if (!out) {  // encoder backpressure
    ++dropped_;
    return;
  }
  const capture::CopyPlan plan = capture::planCopy(contentW, contentH, crop_, outW_, outH_);
  if (plan.empty) {
    pool_->release(std::move(out));
    ++dropped_;
    return;
  }
  copyFrame(device_.get(), texture, out.get(), plan);
  if (!video_->write(pool_, std::move(out), pts, frameDurHns_)) {
    ++dropped_;
    if (!encoderFailed_.exchange(true)) {
      post_({PipelineEventType::EncoderFailed, 0, protocol::reason::WriterFailed, "H.264 encoder rejected a frame"});
    }
    return;
  }
  ++frames_;
  lastPtsHns_ = pts;
  std::lock_guard<std::mutex> lock(statsMutex_);
  fps_.onFrame(hostNs);
}

void Recorder::onAudio(AudioTrack& track, const AudioPacket& packet) {
  if (track.isMic) {
    // Silent packets carry no samples: report the floor instead of a stale level.
    track.level = packet.samples != nullptr
                      ? timing::rmsDbfs(packet.samples, static_cast<std::size_t>(packet.frames) * AudioWriter::kChannels)
                      : -100.0;
  }
  timing::AudioPlacement place;
  std::int64_t before = 0;
  {
    std::lock_guard<std::mutex> lock(clockMutex_);
    if (stopping_) return;
    before = track.aligner.framesWritten();
    place = track.aligner.place(clock_, packet.hostNs, packet.frames);
  }
  if (place.silenceFrames > 0) track.writer->writePcm(nullptr, place.silenceFrames, before);
  if (place.writeFrames > 0) {
    const std::int16_t* samples =
        packet.samples != nullptr ? packet.samples + place.skipFrames * AudioWriter::kChannels : nullptr;
    track.writer->writePcm(samples, place.writeFrames, before + place.silenceFrames);
  }
}

bool Recorder::pause() {
  std::lock_guard<std::mutex> lock(clockMutex_);
  return clock_.pause(qpc_.nowNs());
}

bool Recorder::resume() {
  std::lock_guard<std::mutex> lock(clockMutex_);
  return clock_.resume(qpc_.nowNs());
}

protocol::Stats Recorder::stats() {
  protocol::Stats s;
  {
    std::lock_guard<std::mutex> lock(statsMutex_);
    s.fps = fps_.fps(qpc_.nowNs());
  }
  s.droppedFrames = dropped_;
  std::error_code ec;
  const auto size = fs::file_size(videoPath_, ec);
  s.fileBytes = ec ? 0 : static_cast<std::int64_t>(size);
  if (mic_) s.micLevel = mic_->level.load();
  return s;
}

bool Recorder::diskLow() const {
  if (dir_.empty()) return false;
  ULARGE_INTEGER freeBytes{};
  if (!::GetDiskFreeSpaceExW(dir_.c_str(), &freeBytes, nullptr, nullptr)) return false;
  return freeBytes.QuadPart < kDiskLowBytes;
}

StopResult Recorder::stop(bool discard, const std::string& interruptReason) {
  StopResult result;
  if (!active_) return result;
  active_ = false;

  {
    std::lock_guard<std::mutex> lock(clockMutex_);
    stopping_ = true;
    if (clock_.paused()) clock_.resume(qpc_.nowNs());  // close the open range for meta
  }
  if (source_) source_->stop();
  for (AudioTrack* track : {system_.get(), mic_.get()}) {
    if (track != nullptr && track->capture) track->capture->stop();
  }

  const std::int64_t frameCount = frames_;
  const bool hasFrames = frameCount > 0;
  const std::int64_t endNs = hasFrames ? (lastPtsHns_.load() + frameDurHns_) * timing::kNsPerHns : 0;

  std::string error;
  if (video_ && !video_->finalize(error) && hasFrames) result.warnings.push_back(error);
  for (AudioTrack* track : {system_.get(), mic_.get()}) {
    if (track == nullptr) continue;
    if (hasFrames) {
      const std::int64_t before = track->aligner.framesWritten();
      const std::int64_t pad = track->aligner.padTo(endNs);
      if (pad > 0) track->writer->writePcm(nullptr, pad, before);
    }
    std::string audioError;
    if (!track->writer->finalize(audioError) && hasFrames) result.warnings.push_back(audioError);
  }

  result.pausedRanges = clock_.pausedRanges();  // capture/audio threads are stopped
  if (discard || !hasFrames) {
    result.noFrames = !discard;
    removeQuietly(videoPath_);
    if (system_) removeQuietly(system_->path);
    if (mic_) removeQuietly(mic_->path);
    result.durationMs = 0;
  } else {
    result.durationMs = endNs / 1'000'000;
    result.paths.screen = pathUtf8(videoPath_);
    if (system_) result.paths.system = pathUtf8(system_->path);
    if (mic_) result.paths.mic = pathUtf8(mic_->path);

    meta::RecordingMeta m;
    m.backend = source_ ? source_->backendId() : "wgc";
    m.firstFramePtsNs = firstFrameNs_;
    m.qpcFrequency = qpc_.frequency();
    m.startQpc = qpc_.ticksFromNs(firstFrameNs_);
    m.width = outW_;
    m.height = outH_;
    m.fps = options_.fps;
    m.bitrate = bitrate_;
    m.durationMs = result.durationMs;
    m.frameCount = frameCount;
    m.droppedFrames = dropped_;
    m.cursorCaptured = cursorCaptured_;
    m.sourceKind = options_.source.kind == protocol::SourceKind::Display ? "display" : "window";
    m.region = crop_;
    if (video_) m.encoder = video_->encoder();
    m.pausedRanges = result.pausedRanges;
    m.video = "screen.mp4";
    if (system_) m.system = "system.m4a";
    if (mic_) m.mic = "mic.m4a";
    m.interrupted = !interruptReason.empty();
    m.interruptReason = interruptReason;

    const fs::path metaPath = dir_ / L"meta.json";
    const fs::path tmpPath = dir_ / L"meta.json.tmp";
    {
      std::ofstream file(tmpPath, std::ios::binary | std::ios::trunc);
      file << meta::toJson(m).dump() << '\n';
    }
    std::error_code ec;
    fs::rename(tmpPath, metaPath, ec);
    if (ec) {
      result.warnings.push_back("meta.json write failed: " + ec.message());
    } else {
      result.paths.meta = pathUtf8(metaPath);
    }
  }

  releaseAll();
  return result;
}

void Recorder::releaseAll() {
  if (source_) source_->stop();
  if (system_ && system_->capture) system_->capture->stop();
  if (mic_ && mic_->capture) mic_->capture->stop();
  system_.reset();
  mic_.reset();
  video_.reset();
  pool_.reset();
  source_.reset();
  device_ = nullptr;
}

const std::vector<std::string>& captureCaps() {
  static const std::vector<std::string> caps = [] {
    std::vector<std::string> c = frameSourceCaps();
    for (const char* extra : {"capture", "pause", "systemAudio", "mic", "micLevel", "h264"}) c.emplace_back(extra);
    if (hardwareH264EncoderAvailable()) c.emplace_back("hardwareEncoder");
    return c;
  }();
  return caps;
}

}  // namespace reelform::wgc
