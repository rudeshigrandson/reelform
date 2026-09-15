// Abstraction over the two frame producers (WGC, DXGI Desktop Duplication).
// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#pragma once

#include "../common/win_util.hpp"

#include <d3d11.h>
#include <dxgi1_2.h>

#include <cstdint>
#include <functional>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include <winrt/base.h>

#include "reelform/capture_math.hpp"
#include "reelform/protocol.hpp"

namespace reelform::wgc {

/// Called on a capture thread for every delivered frame. `texture` is only valid
/// for the duration of the call (the pool recycles it); copy before returning.
/// Invocations for one source are serialised (never concurrent).
using FrameCallback = std::function<void(ID3D11Texture2D* texture, std::int64_t contentWidth,
                                         std::int64_t contentHeight, std::int64_t hostNs)>;

/// Called at most once when the source can no longer deliver frames (window
/// closed, display disconnected, duplication lost permanently).
using ClosedCallback = std::function<void(const std::string& reason, const std::string& message)>;

/// Start-time failure with a stable protocol error code.
struct SourceError : std::runtime_error {
  SourceError(std::string c, const std::string& message) : std::runtime_error(message), code(std::move(c)) {}
  std::string code;  // protocol::code::* (sourceNotFound | badRequest | streamFailed | permissionDenied)
};

struct SourceInfo {
  std::int64_t width = 0;   // captured surface size at start (physical px)
  std::int64_t height = 0;
  bool cursorCaptured = true;  // true when the OS cursor is burned into frames
  double scaleFactor = 1.0;    // effective DPI / 96 of the captured monitor or window
};

/// Effective DPI scale (DPI / 96) of a monitor / window; 1.0 when unknown.
double monitorScaleFactor(HMONITOR monitor);
double windowScaleFactor(HWND window);

class FrameSource {
 public:
  virtual ~FrameSource() = default;
  virtual const char* backendId() const = 0;  // "wgc" | "dxgi"
  /// Resolve the capture target. Throws SourceError / winrt::hresult_error.
  virtual void resolve(const protocol::StartOptions& options) = 0;
  /// Adapter the D3D device must be created on (after resolve), or null for "any".
  virtual winrt::com_ptr<IDXGIAdapter1> requiredAdapter() = 0;
  /// Prepare capture on `device`. Throws SourceError / winrt::hresult_error.
  virtual SourceInfo open(ID3D11Device* device) = 0;
  virtual void start(FrameCallback onFrame, ClosedCallback onClosed) = 0;
  /// Stop delivering frames; blocks until no callback is running. Idempotent.
  virtual void stop() = 0;
};

/// Defined by exactly one of wgc_source.cpp / dxgi_source.cpp per executable.
std::unique_ptr<FrameSource> createFrameSource();

/// Capabilities for `pong.caps` contributed by the linked frame source.
std::vector<std::string> frameSourceCaps();

struct MonitorHandle {
  capture::MonitorDesc desc;
  HMONITOR handle = nullptr;
};
/// EnumDisplayMonitors in the portable description used by capture::resolveMonitor.
std::vector<MonitorHandle> enumerateMonitors();

/// HKLM\...\CurrentVersion\CurrentBuildNumber (0 when unreadable).
unsigned windowsBuildNumber();

}  // namespace reelform::wgc
