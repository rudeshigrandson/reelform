// Capture pipeline: frame source -> GPU crop -> H.264 writer, plus WASAPI
// system/mic tracks, all timed on the shared QPC MediaClock.
// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#pragma once

#include "../common/win_util.hpp"

#include <atomic>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "d3d_util.hpp"
#include "frame_source.hpp"
#include "mf_writers.hpp"
#include "reelform/protocol.hpp"
#include "reelform/timing.hpp"
#include "wasapi_capture.hpp"

namespace reelform::wgc {

/// SourceClosed: `reason` is a protocol::reason. AudioWarning: `reason` is a
/// protocol::code (non-fatal error). DeviceLost: microphone disappeared mid-recording;
/// `reason` carries the requested device id. Recording continues without the mic (as on macOS).
enum class PipelineEventType { FirstFrame, SourceClosed, EncoderFailed, AudioWarning, DeviceLost };

struct PipelineEvent {
  PipelineEventType type = PipelineEventType::FirstFrame;
  std::int64_t hostNs = 0;
  std::string reason;
  std::string message;
};

/// Called from capture/audio threads; the main loop serialises handling.
using PostEvent = std::function<void(PipelineEvent)>;

struct StartError {
  std::string code;
  std::string message;
};

struct StopResult {
  std::int64_t durationMs = 0;
  protocol::StoppedPaths paths;
  std::vector<timing::PausedRange> pausedRanges;
  std::vector<std::string> warnings;  // reported as error{code:"writerFailed",fatal:false}
  bool noFrames = false;              // stopped (not discarded) before the first frame
};

class Recorder {
 public:
  explicit Recorder(PostEvent post);
  ~Recorder();
  Recorder(const Recorder&) = delete;
  Recorder& operator=(const Recorder&) = delete;

  std::optional<StartError> start(const protocol::StartOptions& options);
  bool pause();
  bool resume();
  /// Finalise everything. `interruptReason` non-empty marks meta as interrupted.
  StopResult stop(bool discard, const std::string& interruptReason);

  protocol::Stats stats();
  bool diskLow() const;
  /// Payload of `started` for the first frame at `firstFrameNs`.
  protocol::StartedInfo startedInfo(std::int64_t firstFrameNs) const {
    return {firstFrameNs, startHostNs_, outW_, outH_, scaleFactor_};
  }
  bool active() const { return active_; }

 private:
  struct AudioTrack {
    std::unique_ptr<WasapiCapture> capture;
    std::unique_ptr<AudioWriter> writer;
    timing::AudioAligner aligner{AudioWriter::kSampleRate};
    std::filesystem::path path;
    bool isMic = false;
    std::atomic<double> level{-100.0};
  };

  std::unique_ptr<AudioTrack> startAudio(AudioEndpointKind kind, const protocol::AudioOptions& mic,
                                         const wchar_t* fileName);
  void onFrame(ID3D11Texture2D* texture, std::int64_t contentW, std::int64_t contentH, std::int64_t hostNs);
  void onAudio(AudioTrack& track, const AudioPacket& packet);
  void releaseAll();

  PostEvent post_;
  const win::Qpc qpc_;
  protocol::StartOptions options_;
  std::unique_ptr<FrameSource> source_;
  winrt::com_ptr<ID3D11Device> device_;
  std::shared_ptr<OutputTexturePool> pool_;
  std::unique_ptr<VideoWriter> video_;
  std::unique_ptr<AudioTrack> system_;
  std::unique_ptr<AudioTrack> mic_;

  std::filesystem::path dir_;
  std::filesystem::path videoPath_;
  std::optional<protocol::Rect> crop_;
  std::int64_t outW_ = 0;
  std::int64_t outH_ = 0;
  std::int64_t bitrate_ = 0;
  std::int64_t frameDurHns_ = 166'666;
  bool cursorCaptured_ = false;
  double scaleFactor_ = 1.0;
  std::int64_t startHostNs_ = 0;

  std::mutex clockMutex_;  // guards clock_, stopping_, aligners
  timing::MediaClock clock_;
  bool stopping_ = false;
  std::int64_t firstFrameNs_ = 0;

  timing::MonotonicPts mono_;  // frame callbacks are serialised per source
  std::mutex statsMutex_;
  timing::FpsMeter fps_;
  std::atomic<std::int64_t> frames_{0};
  std::atomic<std::int64_t> dropped_{0};
  std::atomic<std::int64_t> lastPtsHns_{0};
  std::atomic<bool> encoderFailed_{false};
  bool active_ = false;
};

/// Full `pong.caps` for the capture helpers (evaluated once, cached).
const std::vector<std::string>& captureCaps();

}  // namespace reelform::wgc
