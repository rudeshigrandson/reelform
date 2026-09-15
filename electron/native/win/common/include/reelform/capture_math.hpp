// Pure geometry + encoder sizing for the Windows capture helpers.
#pragma once

#include <algorithm>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "protocol.hpp"

namespace reelform::capture {

using protocol::Rect;

/// H.264 4:2:0 needs even dimensions.
inline std::int64_t evenFloor(std::int64_t v) { return v <= 0 ? 0 : v - (v % 2); }

inline std::optional<Rect> intersect(const Rect& a, const Rect& b) {
  const std::int64_t x0 = std::max(a.x, b.x);
  const std::int64_t y0 = std::max(a.y, b.y);
  const std::int64_t x1 = std::min(a.x + a.width, b.x + b.width);
  const std::int64_t y1 = std::min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return std::nullopt;
  return Rect{x0, y0, x1 - x0, y1 - y0};
}

/// Clamp a monitor-relative region to the monitor and floor to even size.
/// No region -> the whole monitor (even-floored). nullopt -> nothing capturable.
inline std::optional<Rect> normalizeRegion(const std::optional<Rect>& region,
                                           std::int64_t monitorWidth, std::int64_t monitorHeight) {
  const Rect monitor{0, 0, monitorWidth, monitorHeight};
  if (monitorWidth <= 0 || monitorHeight <= 0) return std::nullopt;
  std::optional<Rect> r = region.has_value() ? intersect(*region, monitor) : monitor;
  if (!r.has_value()) return std::nullopt;
  r->width = evenFloor(r->width);
  r->height = evenFloor(r->height);
  if (r->width < 2 || r->height < 2) return std::nullopt;
  return r;
}

/// One GPU copy: source box in captured-texture coordinates, pasted at (0,0) of
/// an output texture of the encoder size. `needsClear` means the copied area is
/// smaller than the output (window shrank) so the rest must be cleared first.
struct CopyPlan {
  bool empty = true;
  std::uint32_t left = 0, top = 0, right = 0, bottom = 0;  // D3D11_BOX x/y extents
  bool needsClear = false;
};

/// `contentW/H`: captured frame content size (WGC ContentSize, may be smaller than
/// the pool texture). `crop`: region in content coordinates (whole content when
/// absent). `outW/H`: encoder frame size, fixed for the session.
inline CopyPlan planCopy(std::int64_t contentW, std::int64_t contentH,
                         const std::optional<Rect>& crop, std::int64_t outW, std::int64_t outH) {
  CopyPlan plan;
  if (contentW <= 0 || contentH <= 0 || outW <= 0 || outH <= 0) return plan;
  const Rect content{0, 0, contentW, contentH};
  std::optional<Rect> src = crop.has_value() ? intersect(*crop, content) : content;
  if (!src.has_value()) return plan;
  const std::int64_t w = std::min(src->width, outW);
  const std::int64_t h = std::min(src->height, outH);
  plan.empty = false;
  plan.left = static_cast<std::uint32_t>(src->x);
  plan.top = static_cast<std::uint32_t>(src->y);
  plan.right = static_cast<std::uint32_t>(src->x + w);
  plan.bottom = static_cast<std::uint32_t>(src->y + h);
  plan.needsClear = w < outW || h < outH;
  return plan;
}

/// Record-time bitrate table (ENGINEERING_SPEC §5.2, shared by native backends):
/// 1080p 18 Mbps, 1440p 28, 4K 45; x1.7 above 30 fps. Tiers by pixel count.
inline std::int64_t recordBitrate(std::int64_t width, std::int64_t height, int fps) {
  const std::int64_t pixels = std::max<std::int64_t>(0, width) * std::max<std::int64_t>(0, height);
  std::int64_t base = 45'000'000;
  if (pixels <= 1920LL * 1080LL) {
    base = 18'000'000;
  } else if (pixels <= 2560LL * 1440LL) {
    base = 28'000'000;
  }
  return fps > 30 ? (base * 17) / 10 : base;
}

/// Monitor description as enumerated on Windows (EnumDisplayMonitors).
struct MonitorDesc {
  std::string deviceName;  // MONITORINFOEX::szDevice, UTF-8, e.g. "\\\\.\\DISPLAY1"
  Rect bounds;             // rcMonitor, virtual-desktop physical px
  bool primary = false;
};

/// Pick the monitor for a display source: exact device-name match, else the
/// monitor with the largest overlap with `bounds`, else primary, else first.
inline std::optional<std::size_t> resolveMonitor(const std::vector<MonitorDesc>& monitors,
                                                 const protocol::Source& source) {
  if (monitors.empty()) return std::nullopt;
  if (!source.id.empty()) {
    for (std::size_t i = 0; i < monitors.size(); ++i) {
      if (monitors[i].deviceName == source.id) return i;
    }
  }
  if (source.bounds.has_value()) {
    std::optional<std::size_t> best;
    std::int64_t bestArea = 0;
    for (std::size_t i = 0; i < monitors.size(); ++i) {
      if (auto r = intersect(monitors[i].bounds, *source.bounds)) {
        const std::int64_t area = r->width * r->height;
        if (area > bestArea) {
          bestArea = area;
          best = i;
        }
      }
    }
    if (best.has_value()) return best;
  }
  for (std::size_t i = 0; i < monitors.size(); ++i) {
    if (monitors[i].primary) return i;
  }
  return 0;
}

/// Parse an HWND given as decimal or 0x-prefixed hex text. 0 / garbage -> nullopt.
inline std::optional<std::uint64_t> parseWindowHandle(const std::string& text) {
  if (text.empty()) return std::nullopt;
  std::uint64_t v = 0;
  std::size_t i = 0;
  int base = 10;
  if (text.size() > 2 && text[0] == '0' && (text[1] == 'x' || text[1] == 'X')) {
    base = 16;
    i = 2;
  }
  for (; i < text.size(); ++i) {
    const char c = text[i];
    std::uint64_t d = 0;
    if (c >= '0' && c <= '9') {
      d = static_cast<std::uint64_t>(c - '0');
    } else if (base == 16 && c >= 'a' && c <= 'f') {
      d = static_cast<std::uint64_t>(c - 'a' + 10);
    } else if (base == 16 && c >= 'A' && c <= 'F') {
      d = static_cast<std::uint64_t>(c - 'A' + 10);
    } else {
      return std::nullopt;
    }
    if (v > (UINT64_MAX - d) / static_cast<std::uint64_t>(base)) return std::nullopt;
    v = v * static_cast<std::uint64_t>(base) + d;
  }
  if (v == 0) return std::nullopt;
  return v;
}

}  // namespace reelform::capture
