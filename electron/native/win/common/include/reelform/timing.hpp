// Host-clock timing for the Windows capture helpers (ENGINEERING_SPEC §5.3/§5.4/§5.6).
//
// Every timestamp here is nanoseconds on the QueryPerformanceCounter clock,
// which is system-wide: the capture helper and the cursor monitor sample the
// same clock, so main rebases telemetry with (hostNs - firstFramePtsNs) / 1e6.
//
// Sources of host time:
//   - WGC  Direct3D11CaptureFrame::SystemRelativeTime  -> 100ns QPC units  (hnsToNs)
//   - DXGI DXGI_OUTDUPL_FRAME_INFO::LastPresentTime     -> raw QPC ticks   (qpcTicksToNs)
//   - WASAPI IAudioCaptureClient::GetBuffer qpcPosition -> 100ns QPC units  (hnsToNs)
//
// Pure: no clocks are read in this file; callers pass times in.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <deque>
#include <optional>
#include <vector>

namespace reelform::timing {

inline constexpr std::int64_t kNsPerSec = 1'000'000'000;
inline constexpr std::int64_t kNsPerHns = 100;

inline std::int64_t hnsToNs(std::int64_t hns) { return hns * kNsPerHns; }
inline std::int64_t nsToHns(std::int64_t ns) { return ns / kNsPerHns; }

/// Convert raw QPC ticks to ns without overflowing for realistic uptimes.
inline std::int64_t qpcTicksToNs(std::int64_t ticks, std::int64_t frequency) {
  if (frequency <= 0) return 0;
  const std::int64_t whole = ticks / frequency;
  const std::int64_t rem = ticks % frequency;
  // rem < frequency; rem * 1e9 fits int64 while frequency < ~9.2e9 (QPC is 1e7 on
  // modern Windows, ~3.5e6 on TSC-less hardware).
  if (frequency < 9'000'000'000LL) return whole * kNsPerSec + (rem * kNsPerSec) / frequency;
  return whole * kNsPerSec +
         static_cast<std::int64_t>(static_cast<long double>(rem) * static_cast<long double>(kNsPerSec) /
                                   static_cast<long double>(frequency));
}

struct PausedRange {
  std::int64_t startNs = 0;  // host clock
  std::int64_t endNs = 0;    // host clock
};

/// Maps host timestamps to continuous media time: 0 at the first frame,
/// paused spans removed (§5.3 "subtract paused duration from PTS so the file is
/// continuous"). Decisions use the sample's *capture* time, so a frame captured
/// just before `pause` but delivered after it is still kept.
class MediaClock {
 public:
  /// Offer a video frame. Anchors on the first frame seen while not paused.
  /// Returns media ns, or nullopt when the frame must be dropped.
  std::optional<std::int64_t> onVideoFrame(std::int64_t hostNs) {
    if (!anchor_.has_value()) {
      if (paused_) return std::nullopt;
      anchor_ = hostNs;
    }
    return toMediaNs(hostNs);
  }

  bool anchored() const { return anchor_.has_value(); }
  std::optional<std::int64_t> anchorNs() const { return anchor_; }
  bool paused() const { return paused_; }

  /// Returns false if already paused.
  bool pause(std::int64_t nowNs) {
    if (paused_) return false;
    paused_ = true;
    pauseStart_ = nowNs;
    return true;
  }

  /// Returns false if not paused. Pauses that end before the anchor leave no range.
  bool resume(std::int64_t nowNs) {
    if (!paused_) return false;
    paused_ = false;
    if (anchor_.has_value()) {
      const std::int64_t start = std::max(pauseStart_, *anchor_);
      const std::int64_t end = std::max(nowNs, start);
      if (end > start) ranges_.push_back(PausedRange{start, end});
    }
    return true;
  }

  /// Media time for any host timestamp (video or audio); nullopt before the
  /// anchor, inside a paused range, or at/after the start of an open pause.
  std::optional<std::int64_t> toMediaNs(std::int64_t hostNs) const {
    if (!anchor_.has_value() || hostNs < *anchor_) return std::nullopt;
    if (paused_ && hostNs >= pauseStart_) return std::nullopt;
    std::int64_t removed = 0;
    for (const PausedRange& r : ranges_) {
      if (hostNs >= r.endNs) {
        removed += r.endNs - r.startNs;
      } else if (hostNs >= r.startNs) {
        return std::nullopt;
      }
    }
    return hostNs - *anchor_ - removed;
  }

  std::int64_t pausedTotalNs() const {
    std::int64_t total = 0;
    for (const PausedRange& r : ranges_) total += r.endNs - r.startNs;
    return total;
  }

  const std::vector<PausedRange>& pausedRanges() const { return ranges_; }

 private:
  std::optional<std::int64_t> anchor_;
  bool paused_ = false;
  std::int64_t pauseStart_ = 0;
  std::vector<PausedRange> ranges_;
};

/// Media Foundation's sink writer rejects non-increasing video sample times;
/// duplicates (same PTS after rounding to 100ns) are dropped and counted.
class MonotonicPts {
 public:
  bool accept(std::int64_t ptsHns) {
    if (last_.has_value() && ptsHns <= *last_) return false;
    last_ = ptsHns;
    return true;
  }
  std::optional<std::int64_t> last() const { return last_; }

 private:
  std::optional<std::int64_t> last_;
};

/// Frames delivered in the trailing 1s window (for `stats.fps`).
class FpsMeter {
 public:
  void onFrame(std::int64_t hostNs) {
    frames_.push_back(hostNs);
    trim(hostNs);
  }
  double fps(std::int64_t nowNs) {
    trim(nowNs);
    return static_cast<double>(frames_.size());
  }

 private:
  void trim(std::int64_t nowNs) {
    while (!frames_.empty() && frames_.front() <= nowNs - kNsPerSec) frames_.pop_front();
  }
  std::deque<std::int64_t> frames_;
};

/// How to place one captured audio packet into the continuous output track.
struct AudioPlacement {
  std::int64_t silenceFrames = 0;  // zero frames to write before the packet
  std::int64_t skipFrames = 0;     // leading frames of the packet to discard
  std::int64_t writeFrames = 0;    // frames of the packet to write after skipping
};

/// Keeps an audio track aligned with video on the shared MediaClock.
///
/// WASAPI loopback delivers *no* packets while nothing is playing, and devices
/// drift or glitch; the AAC writer ignores gaps in timestamps, so without this
/// the system track would slide earlier than the video. We track frames written
/// and compare with where the packet belongs:
///   ahead by > tolerance  -> insert silence
///   behind by > tolerance -> drop the overlapping leading frames
///   within tolerance      -> append as-is (no jitter correction)
class AudioAligner {
 public:
  explicit AudioAligner(std::uint32_t sampleRate, std::int64_t toleranceNs = 20'000'000)
      : rate_(sampleRate), tolerance_(framesFor(toleranceNs, sampleRate)) {}

  AudioPlacement place(const MediaClock& clock, std::int64_t packetHostNs, std::int64_t frames) {
    AudioPlacement p;
    if (frames <= 0 || rate_ == 0) return p;

    std::int64_t skip = 0;
    std::optional<std::int64_t> media = clock.toMediaNs(packetHostNs);
    if (!media.has_value()) {
      // Packet starts before the anchor: keep the part at/after the anchor.
      const std::optional<std::int64_t> anchor = clock.anchorNs();
      if (!anchor.has_value() || clock.paused() || packetHostNs >= *anchor) return p;
      skip = ceilFrames(*anchor - packetHostNs);
      if (skip >= frames) return p;
      media = 0;
    }

    const std::int64_t expected = framesFor(*media, rate_);
    std::int64_t silence = 0;
    if (expected > written_ + tolerance_) {
      silence = expected - written_;
    } else if (expected + tolerance_ < written_) {
      skip += written_ - expected;
    }
    skip = std::min(skip, frames);
    p.silenceFrames = silence;
    p.skipFrames = skip;
    p.writeFrames = frames - skip;
    written_ += silence + p.writeFrames;
    return p;
  }

  /// Silence frames needed to extend the track to `mediaEndNs` (called at stop so
  /// every track spans the video duration).
  std::int64_t padTo(std::int64_t mediaEndNs) {
    const std::int64_t target = framesFor(mediaEndNs, rate_);
    if (target <= written_) return 0;
    const std::int64_t pad = target - written_;
    written_ = target;
    return pad;
  }

  std::int64_t framesWritten() const { return written_; }
  /// Presentation time (hns) of the next frame to write, for IMFSample::SetSampleTime.
  std::int64_t nextSampleTimeHns() const {
    return rate_ == 0 ? 0 : (written_ * 10'000'000LL) / rate_;
  }

  static std::int64_t framesFor(std::int64_t ns, std::uint32_t rate) {
    if (ns <= 0) return 0;
    // round-to-nearest; split to avoid overflow for multi-hour recordings
    const std::int64_t whole = ns / kNsPerSec;
    const std::int64_t rem = ns % kNsPerSec;
    return whole * rate + (rem * rate + kNsPerSec / 2) / kNsPerSec;
  }

 private:
  std::int64_t ceilFrames(std::int64_t ns) const {
    const std::int64_t whole = ns / kNsPerSec;
    const std::int64_t rem = ns % kNsPerSec;
    return whole * rate_ + (rem * rate_ + kNsPerSec - 1) / kNsPerSec;
  }

  std::uint32_t rate_;
  std::int64_t tolerance_;
  std::int64_t written_ = 0;
};

/// RMS level in dBFS of interleaved int16 PCM (floor -100 dB). For `stats.micLevel`.
inline double rmsDbfs(const std::int16_t* samples, std::size_t count) {
  if (samples == nullptr || count == 0) return -100.0;
  double sum = 0.0;
  for (std::size_t i = 0; i < count; ++i) {
    const double s = static_cast<double>(samples[i]) / 32768.0;
    sum += s * s;
  }
  const double rms = std::sqrt(sum / static_cast<double>(count));
  if (rms <= 1e-5) return -100.0;
  return std::max(-100.0, 20.0 * std::log10(rms));
}

/// Fixed-rate tick schedule without drift: tick k fires at start + k*period.
/// After an oversleep, missed ticks are skipped (never burst-sampled).
struct TickSchedule {
  std::int64_t startNs = 0;
  std::int64_t periodNs = 0;

  /// Index and time of the first tick strictly after `nowNs`.
  std::int64_t nextTickNs(std::int64_t nowNs) const {
    if (periodNs <= 0) return nowNs;
    if (nowNs < startNs) return startNs;
    const std::int64_t k = (nowNs - startNs) / periodNs + 1;
    return startNs + k * periodNs;
  }
};

}  // namespace reelform::timing
