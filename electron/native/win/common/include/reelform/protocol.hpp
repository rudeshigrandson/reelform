// Reelform helper stdio protocol (ENGINEERING_SPEC §5.5), shared by
// reelform-wgc, reelform-dxgi, reelform-cursor-monitor and reelform-hw-probe.
//
// Wire-compatible with the macOS helper: every outbound line validates against
// the zod schemas in electron/native/mac/protocol.ts (`SckEvent`, `CursorEvent`),
// checked by ../../../protocol-compat.test.ts against lines emitted by this header
// (`reelform-native-tests --emit-protocol-fixture`).
//
// Transport: UTF-8, one JSON object per line, `{"t": "<type>", "id"?: n, ...}`.
//
// Inbound (main -> helper)
//   {"t":"ping","id"?:n}
//   {"t":"start","id"?:n,
//     "source":{"kind":"display","displayId"?:n,"bounds"?:{x,y,width,height}}
//            | {"kind":"window","windowId":<HWND as number>},
//     "region"?:{"x","y","width","height"},  // physical px, relative to monitor top-left
//     "fps":30|60, "audio":{"system":bool,"mic"?:"<WASAPI endpoint id>"|"default"},
//     "hideCursor"?:bool (default true), "outputDir":"C:\\...\\recording-123"}
//   {"t":"pause"} {"t":"resume"} {"t":"stop"} {"t":"discard"}
//   Windows extensions (ignored by mac): source.bounds (virtual-desktop physical px,
//   used to pick the monitor since Electron display ids do not map to HMONITORs),
//   hideCursor. Also accepted: source.type instead of kind, source.id (number or
//   string: "\\\\.\\DISPLAY1" device name or HWND text) instead of displayId/windowId.
//   excludePids is accepted and ignored (WGC cannot exclude windows).
//
// Outbound (helper -> main)
//   {"t":"pong","id"?,"version":"1.0.0","caps":[...]}
//   {"t":"ready","id"?}                   start accepted, writers armed, awaiting first frame
//   {"t":"started","id"?,"firstFramePtsNs","startHostTimeNs","width","height","scaleFactor"}
//   {"t":"stats","fps","droppedFrames","fileBytes","micLevel"?:dBFS}
//   {"t":"interrupted","reason":"streamStopped"|"sourceLost"|"deviceLost"|"writerFailed"|"parentGone","message"}
//   {"t":"stopped","id"?,"durationMs","paths":{"screen"?,"system"?,"mic"?,"meta"?},"pausedRanges":[{startNs,endNs}],"discarded":bool}
//   {"t":"error","id"?,"code":<ErrorCode>,"message","fatal":bool}
//
// pause/resume are silent on success (main already knows); failures answer
// with `error` carrying the command id. All `*Ns` values are QPC nanoseconds.
#pragma once

#include <cstdint>
#include <initializer_list>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "json.hpp"
#include "timing.hpp"

namespace reelform::protocol {

inline constexpr const char* kProtocolVersion = "1.0.0";
inline constexpr std::size_t kMaxLineBytes = 1U << 20;

/// `interrupted.reason` values (mac INTERRUPT_REASONS).
namespace reason {
inline constexpr const char* StreamStopped = "streamStopped";
inline constexpr const char* SourceLost = "sourceLost";
inline constexpr const char* DeviceLost = "deviceLost";
inline constexpr const char* WriterFailed = "writerFailed";
inline constexpr const char* ParentGone = "parentGone";
}  // namespace reason

/// `error.code` values (mac HELPER_ERROR_CODES).
namespace code {
inline constexpr const char* BadRequest = "badRequest";
inline constexpr const char* UnknownCommand = "unknownCommand";
inline constexpr const char* InvalidState = "invalidState";
inline constexpr const char* PermissionDenied = "permissionDenied";
inline constexpr const char* SourceNotFound = "sourceNotFound";
inline constexpr const char* WriterFailed = "writerFailed";
inline constexpr const char* StreamFailed = "streamFailed";
inline constexpr const char* MicUnavailable = "micUnavailable";
inline constexpr const char* NoFrames = "noFrames";
inline constexpr const char* Internal = "internal";
}  // namespace code

enum class CommandType { Ping, Start, Pause, Resume, Stop, Discard };

inline const char* commandName(CommandType t) {
  switch (t) {
    case CommandType::Ping: return "ping";
    case CommandType::Start: return "start";
    case CommandType::Pause: return "pause";
    case CommandType::Resume: return "resume";
    case CommandType::Stop: return "stop";
    case CommandType::Discard: return "discard";
  }
  return "unknown";
}

struct Rect {
  std::int64_t x = 0;
  std::int64_t y = 0;
  std::int64_t width = 0;
  std::int64_t height = 0;
};

enum class SourceKind { Display, Window };

struct Source {
  SourceKind kind = SourceKind::Display;
  std::string id;              // display id / device name / HWND text; may be empty for display
  std::optional<Rect> bounds;  // display bounds in virtual-desktop physical px (display only)
};

struct AudioOptions {
  bool system = false;
  std::optional<std::string> mic;  // endpoint id; "" or "default" means default capture device
};

struct StartOptions {
  Source source;
  std::optional<Rect> region;
  int fps = 60;
  AudioOptions audio;
  bool hideCursor = true;
  std::string outputDir;
};

struct Command {
  CommandType type = CommandType::Ping;
  std::optional<std::int64_t> id;
  StartOptions start;  // meaningful only for Start
};

struct ParseError {
  std::string code;  // code::BadRequest | code::UnknownCommand
  std::string message;
  std::optional<std::int64_t> id;
};

struct ParsedCommand {
  bool ok = false;
  Command command;
  ParseError error;
};

namespace detail {

inline ParsedCommand failure(std::string errorCode, std::string message,
                             std::optional<std::int64_t> id) {
  ParsedCommand r;
  r.error = ParseError{std::move(errorCode), std::move(message), id};
  return r;
}

inline std::int64_t roundHalfAway(double v) {
  return static_cast<std::int64_t>(v + (v < 0 ? -0.5 : 0.5));
}

inline bool readRect(const json::Value* v, Rect& out) {
  if (v == nullptr || !v->isObject()) return false;
  const json::Value* x = v->find("x");
  const json::Value* y = v->find("y");
  const json::Value* w = v->find("width");
  const json::Value* h = v->find("height");
  if (x == nullptr || y == nullptr || w == nullptr || h == nullptr) return false;
  if (!x->isNumber() || !y->isNumber() || !w->isNumber() || !h->isNumber()) return false;
  const double limit = 1e9;  // far beyond any desktop; keeps the int64 casts defined
  for (const json::Value* c : {x, y, w, h}) {
    const double d = c->asDouble();
    if (!(d > -limit && d < limit)) return false;
  }
  // Region selector may deliver fractional px at non-integer scale factors; round.
  out.x = roundHalfAway(x->asDouble());
  out.y = roundHalfAway(y->asDouble());
  out.width = roundHalfAway(w->asDouble());
  out.height = roundHalfAway(h->asDouble());
  return out.width > 0 && out.height > 0;
}

inline std::string idText(const json::Value* v) {
  if (v == nullptr) return {};
  if (v->isString()) return v->asString();
  if (v->isInt()) return std::to_string(v->asInt());
  return {};
}

}  // namespace detail

/// `requireStartOptions == false` accepts a bare `{"t":"start"}` (cursor monitor,
/// which has no source/output); any start payload is then ignored.
inline ParsedCommand parseCommand(std::string_view line, bool requireStartOptions = true) {
  if (line.size() > kMaxLineBytes) return detail::failure(code::BadRequest, "line too long", {});
  // Tolerate a trailing CR from Windows-style line endings.
  if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
  const json::ParseResult parsed = json::parse(line);
  if (!parsed.ok) return detail::failure(code::BadRequest, "invalid JSON: " + parsed.error, {});
  const json::Value& msg = parsed.value;
  if (!msg.isObject()) return detail::failure(code::BadRequest, "message must be an object", {});

  std::optional<std::int64_t> id;
  if (const json::Value* idv = msg.find("id"); idv != nullptr && idv->isInt()) {
    id = idv->asInt();
  }
  const json::Value* t = msg.find("t");
  if (t == nullptr || !t->isString()) return detail::failure(code::BadRequest, "missing \"t\"", id);

  ParsedCommand r;
  r.ok = true;
  r.command.id = id;
  const std::string& type = t->asString();
  if (type == "ping") {
    r.command.type = CommandType::Ping;
  } else if (type == "pause") {
    r.command.type = CommandType::Pause;
  } else if (type == "resume") {
    r.command.type = CommandType::Resume;
  } else if (type == "stop") {
    r.command.type = CommandType::Stop;
  } else if (type == "discard") {
    r.command.type = CommandType::Discard;
  } else if (type == "start") {
    r.command.type = CommandType::Start;
    if (!requireStartOptions) return r;
    StartOptions& o = r.command.start;

    const json::Value* src = msg.find("source");
    if (src == nullptr || !src->isObject()) return detail::failure(code::BadRequest, "missing source", id);
    const json::Value* kind = src->find("kind");
    if (kind == nullptr) kind = src->find("type");
    if (kind == nullptr || !kind->isString()) {
      return detail::failure(code::BadRequest, "missing source.kind", id);
    }
    if (kind->asString() == "display") {
      o.source.kind = SourceKind::Display;
      const json::Value* sid = src->find("displayId");
      o.source.id = detail::idText(sid != nullptr ? sid : src->find("id"));
    } else if (kind->asString() == "window") {
      o.source.kind = SourceKind::Window;
      const json::Value* sid = src->find("windowId");
      o.source.id = detail::idText(sid != nullptr ? sid : src->find("id"));
      if (o.source.id.empty()) return detail::failure(code::BadRequest, "window source requires windowId", id);
    } else {
      return detail::failure(code::BadRequest, "source.kind must be display or window", id);
    }
    if (const json::Value* b = src->find("bounds"); b != nullptr && !b->isNull()) {
      Rect rect;
      if (!detail::readRect(b, rect)) return detail::failure(code::BadRequest, "invalid source.bounds", id);
      o.source.bounds = rect;
    }

    if (const json::Value* reg = msg.find("region"); reg != nullptr && !reg->isNull()) {
      Rect rect;
      if (!detail::readRect(reg, rect)) return detail::failure(code::BadRequest, "invalid region", id);
      if (o.source.kind == SourceKind::Window) {
        return detail::failure(code::BadRequest, "region is only valid for display sources", id);
      }
      o.region = rect;
    }

    if (const json::Value* fps = msg.find("fps"); fps != nullptr) {
      const std::int64_t f = fps->asInt(-1);
      if (f != 30 && f != 60) return detail::failure(code::BadRequest, "fps must be 30 or 60", id);
      o.fps = static_cast<int>(f);
    }

    if (const json::Value* audio = msg.find("audio"); audio != nullptr && audio->isObject()) {
      if (const json::Value* sys = audio->find("system"); sys != nullptr) {
        o.audio.system = sys->asBool(false);
      }
      if (const json::Value* mic = audio->find("mic"); mic != nullptr && mic->isString()) {
        o.audio.mic = mic->asString();
      }
    }

    if (const json::Value* hc = msg.find("hideCursor"); hc != nullptr) {
      o.hideCursor = hc->asBool(true);
    }

    const json::Value* dir = msg.find("outputDir");
    if (dir == nullptr || !dir->isString() || dir->asString().empty()) {
      return detail::failure(code::BadRequest, "missing outputDir", id);
    }
    o.outputDir = dir->asString();
  } else {
    return detail::failure(code::UnknownCommand, "unknown command \"" + type + "\"", id);
  }
  return r;
}

// ---- outbound builders (return one line without the trailing '\n') ----

namespace detail {
inline json::Value envelope(const char* type, std::optional<std::int64_t> id) {
  json::Value v = json::Value::object();
  v.set("t", type);
  if (id.has_value()) v.set("id", *id);
  return v;
}
}  // namespace detail

inline std::string pong(const std::vector<std::string>& caps, std::optional<std::int64_t> id = {}) {
  json::Value v = detail::envelope("pong", id);
  v.set("version", kProtocolVersion);
  json::Value arr = json::Value::array();
  for (const auto& c : caps) arr.push(c);
  v.set("caps", std::move(arr));
  return v.dump();
}

inline std::string ready(std::optional<std::int64_t> id = {}) {
  return detail::envelope("ready", id).dump();
}

struct StartedInfo {
  std::int64_t firstFramePtsNs = 0;  // QPC ns of the first video frame
  std::int64_t startHostTimeNs = 0;  // QPC ns when capture was started
  std::int64_t width = 0;            // encoded frame size (physical px)
  std::int64_t height = 0;
  double scaleFactor = 1.0;          // monitor/window DPI / 96
};

inline std::string started(const StartedInfo& s, std::optional<std::int64_t> id = {}) {
  json::Value v = detail::envelope("started", id);
  v.set("firstFramePtsNs", s.firstFramePtsNs);
  v.set("startHostTimeNs", s.startHostTimeNs);
  v.set("width", s.width);
  v.set("height", s.height);
  v.set("scaleFactor", s.scaleFactor > 0.0 ? s.scaleFactor : 1.0);
  return v.dump();
}

struct Stats {
  double fps = 0.0;
  std::int64_t droppedFrames = 0;
  std::int64_t fileBytes = 0;
  std::optional<double> micLevel;  // dBFS, <= 0
};

inline std::string stats(const Stats& s) {
  json::Value v = detail::envelope("stats", {});
  v.set("fps", s.fps);
  v.set("droppedFrames", s.droppedFrames);
  v.set("fileBytes", s.fileBytes);
  if (s.micLevel.has_value()) v.set("micLevel", *s.micLevel);
  return v.dump();
}

inline std::string interrupted(std::string_view why, std::string_view message) {
  json::Value v = detail::envelope("interrupted", {});
  v.set("reason", why);
  v.set("message", message);
  return v.dump();
}

struct StoppedPaths {
  std::optional<std::string> screen;
  std::optional<std::string> system;
  std::optional<std::string> mic;
  std::optional<std::string> meta;  // Windows extension: meta.json (startQpc, encoder, ...)
};

inline std::string stopped(std::int64_t durationMs, const StoppedPaths& paths,
                           const std::vector<timing::PausedRange>& pausedRanges, bool discarded,
                           std::optional<std::int64_t> id = {}) {
  json::Value v = detail::envelope("stopped", id);
  v.set("durationMs", durationMs < 0 ? 0 : durationMs);
  json::Value p = json::Value::object();
  if (paths.screen) p.set("screen", *paths.screen);
  if (paths.system) p.set("system", *paths.system);
  if (paths.mic) p.set("mic", *paths.mic);
  if (paths.meta) p.set("meta", *paths.meta);
  v.set("paths", std::move(p));
  json::Value ranges = json::Value::array();
  for (const auto& r : pausedRanges) {
    json::Value jr = json::Value::object();
    jr.set("startNs", r.startNs).set("endNs", r.endNs);
    ranges.push(std::move(jr));
  }
  v.set("pausedRanges", std::move(ranges));
  v.set("discarded", discarded);
  return v.dump();
}

inline std::string error(std::string_view errorCode, std::string_view message, bool fatal,
                         std::optional<std::int64_t> id = {}) {
  json::Value v = detail::envelope("error", id);
  v.set("code", errorCode);
  v.set("message", message);
  v.set("fatal", fatal);
  return v.dump();
}

inline std::string error(const ParseError& e) { return error(e.code, e.message, false, e.id); }

}  // namespace reelform::protocol
