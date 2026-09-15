// meta.json written next to the capture outputs at stop. Consumed by main at
// `recording:finalize` (ENGINEERING_SPEC §3, §5.4 "startQpc written to meta").
#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "json.hpp"
#include "protocol.hpp"
#include "timing.hpp"

namespace reelform::meta {

struct EncoderInfo {
  std::string name;  // MFT friendly name, or "unknown"
  bool hardware = false;
};

struct RecordingMeta {
  std::string backend;  // "wgc" | "dxgi"
  std::int64_t startQpc = 0;        // raw QPC ticks of the first frame
  std::int64_t qpcFrequency = 0;    // QueryPerformanceFrequency
  std::int64_t firstFramePtsNs = 0; // same instant, host ns
  std::int64_t width = 0;
  std::int64_t height = 0;
  int fps = 0;
  std::int64_t bitrate = 0;
  std::int64_t durationMs = 0;
  std::int64_t frameCount = 0;
  std::int64_t droppedFrames = 0;
  bool cursorCaptured = false;
  std::string sourceKind;  // "display" | "window"
  std::optional<protocol::Rect> region;
  EncoderInfo encoder;
  std::vector<timing::PausedRange> pausedRanges;
  std::optional<std::string> video;
  std::optional<std::string> system;
  std::optional<std::string> mic;
  bool interrupted = false;
  std::string interruptReason;
};

inline json::Value toJson(const RecordingMeta& m) {
  json::Value v = json::Value::object();
  v.set("version", 1);
  v.set("backend", m.backend);
  v.set("clock", "qpc");
  v.set("startQpc", m.startQpc);
  v.set("qpcFrequency", m.qpcFrequency);
  v.set("firstFramePtsNs", m.firstFramePtsNs);
  v.set("width", m.width);
  v.set("height", m.height);
  v.set("fps", m.fps);
  v.set("bitrate", m.bitrate);
  v.set("durationMs", m.durationMs);
  v.set("frameCount", m.frameCount);
  v.set("droppedFrames", m.droppedFrames);
  v.set("cursorCaptured", m.cursorCaptured);
  v.set("sourceKind", m.sourceKind);
  if (m.region.has_value()) {
    json::Value r = json::Value::object();
    r.set("x", m.region->x).set("y", m.region->y);
    r.set("width", m.region->width).set("height", m.region->height);
    v.set("region", std::move(r));
  } else {
    v.set("region", nullptr);
  }
  json::Value enc = json::Value::object();
  enc.set("codec", "h264").set("name", m.encoder.name).set("hardware", m.encoder.hardware);
  v.set("encoder", std::move(enc));
  json::Value ranges = json::Value::array();
  for (const auto& r : m.pausedRanges) {
    json::Value jr = json::Value::object();
    jr.set("startNs", r.startNs).set("endNs", r.endNs);
    ranges.push(std::move(jr));
  }
  v.set("pausedRanges", std::move(ranges));
  json::Value files = json::Value::object();
  if (m.video) files.set("video", *m.video);
  if (m.system) files.set("system", *m.system);
  if (m.mic) files.set("mic", *m.mic);
  v.set("files", std::move(files));
  // Audio tracks are aligned to the first video frame by AudioAligner, so their
  // offset relative to video is 0 by construction.
  v.set("audioOffsetMs", 0);
  v.set("interrupted", m.interrupted);
  if (m.interrupted) v.set("interruptReason", m.interruptReason);
  return v;
}

}  // namespace reelform::meta
