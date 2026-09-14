// WASAPI shared-mode capture: system loopback or microphone, converted by the
// audio engine to 48 kHz / stereo / int16 (AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM).
// Packet timestamps come from IAudioCaptureClient::GetBuffer's QPC position so
// audio and video share the host clock (§5.4).
// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#pragma once

#include "../common/win_util.hpp"

#include <atomic>
#include <cstdint>
#include <functional>
#include <future>
#include <optional>
#include <string>
#include <thread>

namespace reelform::wgc {

enum class AudioEndpointKind { SystemLoopback, Microphone };

struct AudioPacket {
  const std::int16_t* samples = nullptr;  // interleaved stereo; nullptr = silence
  std::int64_t frames = 0;
  std::int64_t hostNs = 0;  // QPC ns of the first frame
  bool discontinuity = false;
};

using AudioPacketCallback = std::function<void(const AudioPacket&)>;
using AudioLostCallback = std::function<void(const std::string& message)>;

class WasapiCapture {
 public:
  WasapiCapture(AudioEndpointKind kind, std::optional<std::string> deviceId);
  ~WasapiCapture();
  WasapiCapture(const WasapiCapture&) = delete;
  WasapiCapture& operator=(const WasapiCapture&) = delete;

  /// Initialise and start the capture thread. Blocks until the client is started or failed.
  bool start(AudioPacketCallback onPacket, AudioLostCallback onLost, std::string& error);
  /// Stop and join. Idempotent. No callbacks run after this returns.
  void stop();

  /// True when the requested mic endpoint id was not found and the default device was used.
  bool usedDefaultFallback() const { return usedDefaultFallback_; }

 private:
  void run(std::promise<std::string>* ready);

  AudioEndpointKind kind_;
  std::optional<std::string> deviceId_;
  AudioPacketCallback onPacket_;
  AudioLostCallback onLost_;
  HANDLE stopEvent_ = nullptr;
  std::thread thread_;
  std::atomic<bool> usedDefaultFallback_{false};
};

}  // namespace reelform::wgc
