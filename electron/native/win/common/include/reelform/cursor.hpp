// Pure pieces of reelform-cursor-monitor (ENGINEERING_SPEC §4 telemetry, §5.4, §13).
//
// Outbound lines match the macOS cursor monitor (`CursorEvent` in
// electron/native/mac/protocol.ts), in addition to the shared pong/ready/error:
//   {"t":"started","id"?,"hostTimeNs":n,"sampleHz":120,"clickSource":"eventTap","keys":true}
//   {"t":"move","tNs":n,"x":px,"y":px,"cursor":"arrow"}              120 Hz while recording
//   {"t":"click","tNs":n,"x":px,"y":px,"button":"left"|"middle"|"right","phase":"down"|"up"}
//   {"t":"key","tNs":n,"keyCode":vk,"modifiers":bits}                 key *down* only, no repeats
//   {"t":"scroll","tNs":n,"dx":notches,"dy":notches}
//   {"t":"stopped","id"?,"samples":n}
// Coordinates are virtual-desktop physical pixels (process is PerMonitorV2 DPI
// aware); main normalizes to the captured area. Key events carry virtual-key
// codes only — never characters — and are produced only while recording.
// `clickSource:"eventTap"` means clicks and keys come from system-wide hooks
// (WH_MOUSE_LL / WH_KEYBOARD_LL on Windows), the equivalent of a CGEventTap.
#pragma once

#include <bitset>
#include <cstdint>
#include <initializer_list>
#include <optional>
#include <string>

#include "json.hpp"

namespace reelform::cursor {

inline constexpr int kSampleHz = 120;

/// Cursor shapes Windows can distinguish (system cursors from LoadCursor).
enum class CursorType {
  Arrow,
  IBeam,
  Hand,
  ResizeEW,
  ResizeNS,
  ResizeNESW,
  ResizeNWSE,
  Move,
  Wait,
  Crosshair,
  NotAllowed,
  Hidden,
  Other
};

/// Style-pack sprite name (mac CURSOR_KINDS, §9.2). Shapes without a sprite
/// render as the arrow.
inline const char* cursorKindName(CursorType t) {
  switch (t) {
    case CursorType::IBeam: return "ibeam";
    case CursorType::Hand: return "hand";
    case CursorType::ResizeEW: return "resize-ew";
    case CursorType::ResizeNS: return "resize-ns";
    case CursorType::ResizeNESW: return "resize-nesw";
    case CursorType::ResizeNWSE: return "resize-nwse";
    case CursorType::Arrow:
    case CursorType::Move:
    case CursorType::Wait:
    case CursorType::Crosshair:
    case CursorType::NotAllowed:
    case CursorType::Hidden:
    case CursorType::Other:
      return "arrow";
  }
  return "arrow";
}

enum class MouseButton { Left, Middle, Right };

inline const char* buttonName(MouseButton b) {
  switch (b) {
    case MouseButton::Left: return "left";
    case MouseButton::Middle: return "middle";
    case MouseButton::Right: return "right";
  }
  return "left";
}

/// Modifier bitmask (mac MODIFIER: shift 1, control 2, option/alt 4, command/win 8).
enum Modifier : std::uint32_t { kShift = 1, kCtrl = 2, kAlt = 4, kMeta = 8 };

// Virtual-key codes (winuser.h) duplicated here so this header stays Windows-free.
namespace vk {
inline constexpr std::uint32_t Shift = 0x10, Control = 0x11, Menu = 0x12;
inline constexpr std::uint32_t LWin = 0x5B, RWin = 0x5C;
inline constexpr std::uint32_t LShift = 0xA0, RShift = 0xA1, LControl = 0xA2, RControl = 0xA3;
inline constexpr std::uint32_t LMenu = 0xA4, RMenu = 0xA5;
}  // namespace vk

/// Tracks which keys are held so auto-repeat key-downs are suppressed and
/// modifiers are derived from our own state (GetAsyncKeyState inside a
/// low-level hook reflects the state *before* the event).
class KeyState {
 public:
  /// Returns true when this is a fresh press (not an auto-repeat).
  bool down(std::uint32_t keyCode) {
    if (keyCode >= 256) return false;
    if (held_.test(keyCode)) return false;
    held_.set(keyCode);
    return true;
  }
  void up(std::uint32_t keyCode) {
    if (keyCode < 256) held_.reset(keyCode);
  }
  void clear() { held_.reset(); }

  std::uint32_t modifiers() const {
    std::uint32_t m = 0;
    if (any({vk::Shift, vk::LShift, vk::RShift})) m |= kShift;
    if (any({vk::Control, vk::LControl, vk::RControl})) m |= kCtrl;
    if (any({vk::Menu, vk::LMenu, vk::RMenu})) m |= kAlt;
    if (any({vk::LWin, vk::RWin})) m |= kMeta;
    return m;
  }

  static bool isModifier(std::uint32_t keyCode) {
    switch (keyCode) {
      case vk::Shift: case vk::Control: case vk::Menu: case vk::LWin: case vk::RWin:
      case vk::LShift: case vk::RShift: case vk::LControl: case vk::RControl:
      case vk::LMenu: case vk::RMenu:
        return true;
      default:
        return false;
    }
  }

 private:
  bool any(std::initializer_list<std::uint32_t> codes) const {
    for (std::uint32_t c : codes) {
      if (held_.test(c)) return true;
    }
    return false;
  }
  std::bitset<256> held_;
};

inline std::string startedLine(std::optional<std::int64_t> id, std::int64_t hostTimeNs, bool keys) {
  json::Value v = json::Value::object();
  v.set("t", "started");
  if (id.has_value()) v.set("id", *id);
  v.set("hostTimeNs", hostTimeNs).set("sampleHz", kSampleHz).set("clickSource", "eventTap");
  v.set("keys", keys);
  return v.dump();
}

inline std::string moveLine(std::int64_t tNs, std::int32_t x, std::int32_t y, CursorType type) {
  json::Value v = json::Value::object();
  v.set("t", "move").set("tNs", tNs).set("x", x).set("y", y);
  v.set("cursor", cursorKindName(type));
  return v.dump();
}

inline std::string clickLine(std::int64_t tNs, std::int32_t x, std::int32_t y, MouseButton button, bool isDown) {
  json::Value v = json::Value::object();
  v.set("t", "click").set("tNs", tNs).set("x", x).set("y", y);
  v.set("button", buttonName(button)).set("phase", isDown ? "down" : "up");
  return v.dump();
}

inline std::string keyLine(std::int64_t tNs, std::uint32_t keyCode, std::uint32_t modifiers) {
  json::Value v = json::Value::object();
  v.set("t", "key").set("tNs", tNs).set("keyCode", keyCode & 0xFFFFU).set("modifiers", modifiers & 63U);
  return v.dump();
}

/// Wheel deltas arrive in multiples of WHEEL_DELTA (120); emitted as notches
/// (fractional for high-resolution wheels/touchpads). dy > 0 = scrolled down,
/// matching DOM WheelEvent sign (Windows reports wheel-up as positive).
inline std::string scrollLine(std::int64_t tNs, std::int32_t rawHorizontal, std::int32_t rawVertical) {
  json::Value v = json::Value::object();
  v.set("t", "scroll").set("tNs", tNs);
  v.set("dx", static_cast<double>(rawHorizontal) / 120.0);
  v.set("dy", static_cast<double>(-static_cast<std::int64_t>(rawVertical)) / 120.0);
  return v.dump();
}

inline std::string stoppedLine(std::optional<std::int64_t> id, std::int64_t samples) {
  json::Value v = json::Value::object();
  v.set("t", "stopped");
  if (id.has_value()) v.set("id", *id);
  v.set("samples", samples < 0 ? 0 : samples);
  return v.dump();
}

}  // namespace reelform::cursor
