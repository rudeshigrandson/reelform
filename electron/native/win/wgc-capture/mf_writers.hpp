// Media Foundation sink writers: H.264 video (screen.mp4) and AAC audio (*.m4a).
// Both use the fragmented MP4 container so a crash leaves a playable file (§5.6).
// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#pragma once

#include "../common/win_util.hpp"

#include <d3d11.h>
#include <mfidl.h>
#include <mfreadwrite.h>

#include <cstdint>
#include <memory>
#include <mutex>
#include <string>

#include <winrt/base.h>

#include "d3d_util.hpp"
#include "reelform/meta.hpp"

namespace reelform::wgc {

/// True when at least one hardware H.264 encoder MFT is registered (MFT_ENUM_FLAG_HARDWARE).
bool hardwareH264EncoderAvailable();

struct VideoWriterConfig {
  std::wstring path;
  UINT32 width = 0;
  UINT32 height = 0;
  int fps = 60;
  std::int64_t bitrate = 0;
  bool preferHardware = true;
};

class VideoWriter {
 public:
  /// Hardware transforms first (when available and preferred), software fallback.
  /// Returns nullptr and fills `error` when both fail.
  static std::unique_ptr<VideoWriter> create(ID3D11Device* device, const VideoWriterConfig& config,
                                             std::string& error);
  ~VideoWriter();
  VideoWriter(const VideoWriter&) = delete;
  VideoWriter& operator=(const VideoWriter&) = delete;

  /// Encode `texture` (encoder-sized BGRA from `pool`). The texture returns to the
  /// pool once Media Foundation releases the sample. False on encoder failure.
  bool write(const std::shared_ptr<OutputTexturePool>& pool, winrt::com_ptr<ID3D11Texture2D> texture,
             std::int64_t timeHns, std::int64_t durationHns);

  /// Idempotent. False (with `error`) when finalization failed; the fragmented
  /// file written so far remains playable.
  bool finalize(std::string& error);

  const meta::EncoderInfo& encoder() const { return encoder_; }

 private:
  VideoWriter() = default;
  HRESULT init(ID3D11Device* device, const VideoWriterConfig& config, bool useHardware);
  void configureCodec(const VideoWriterConfig& config);
  void detectEncoder(bool useHardware);

  winrt::com_ptr<IMFDXGIDeviceManager> manager_;
  winrt::com_ptr<IMFSinkWriter> writer_;
  DWORD stream_ = 0;
  meta::EncoderInfo encoder_{"unknown", false};
  std::mutex mutex_;
  bool finalized_ = false;
};

class AudioWriter {
 public:
  static constexpr UINT32 kSampleRate = 48000;
  static constexpr UINT32 kChannels = 2;
  static constexpr UINT32 kBitsPerSample = 16;
  static constexpr UINT32 kAacBytesPerSecond = 24000;  // 192 kbps

  static std::unique_ptr<AudioWriter> create(const std::wstring& path, std::string& error);
  ~AudioWriter();
  AudioWriter(const AudioWriter&) = delete;
  AudioWriter& operator=(const AudioWriter&) = delete;

  /// Write `frames` of interleaved 16-bit stereo starting at output frame index
  /// `startFrame`; `interleaved == nullptr` writes silence. Chunked to 1 s buffers.
  bool writePcm(const std::int16_t* interleaved, std::int64_t frames, std::int64_t startFrame);
  bool finalize(std::string& error);
  bool hasSamples() const { return wroteSamples_; }

 private:
  AudioWriter() = default;
  winrt::com_ptr<IMFSinkWriter> writer_;
  DWORD stream_ = 0;
  std::mutex mutex_;
  bool finalized_ = false;
  bool wroteSamples_ = false;
};

inline std::int64_t framesToHns(std::int64_t frames, UINT32 rate) {
  return rate == 0 ? 0 : (frames * 10'000'000LL) / static_cast<std::int64_t>(rate);
}

}  // namespace reelform::wgc
