// Windows.Graphics.Capture frame source (§5.4).
// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#include <unknwn.h>
#include <inspectable.h>

#include "wgc_source.hpp"

#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <mutex>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Metadata.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Security.Authorization.AppCapabilityAccess.h>

#include "reelform/timing.hpp"

namespace reelform::wgc {

namespace {

namespace wgcapi = winrt::Windows::Graphics::Capture;
namespace d3dapi = winrt::Windows::Graphics::DirectX::Direct3D11;
using winrt::Windows::Foundation::Metadata::ApiInformation;

constexpr auto kPixelFormat = winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized;
constexpr std::int32_t kPoolBuffers = 2;
constexpr const wchar_t* kSessionClass = L"Windows.Graphics.Capture.GraphicsCaptureSession";

d3dapi::IDirect3DDevice toWinrtDevice(ID3D11Device* device) {
  winrt::com_ptr<ID3D11Device> d3d;
  d3d.copy_from(device);
  const auto dxgi = d3d.as<IDXGIDevice>();
  winrt::com_ptr<::IInspectable> inspectable;
  winrt::check_hresult(::CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), inspectable.put()));
  return inspectable.as<d3dapi::IDirect3DDevice>();
}

winrt::com_ptr<ID3D11Texture2D> textureFromSurface(const d3dapi::IDirect3DSurface& surface) {
  const auto access = surface.as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
  winrt::com_ptr<ID3D11Texture2D> texture;
  winrt::check_hresult(access->GetInterface(winrt::guid_of<ID3D11Texture2D>(), texture.put_void()));
  return texture;
}

bool propertyPresent(const wchar_t* property) {
  try {
    return ApiInformation::IsPropertyPresent(kSessionClass, property);
  } catch (...) {
    return false;
  }
}

class WgcSource final : public FrameSource {
 public:
  ~WgcSource() override { stop(); }

  const char* backendId() const override { return "wgc"; }

  void resolve(const protocol::StartOptions& options) override {
    if (!wgcapi::GraphicsCaptureSession::IsSupported()) {
      throw SourceError(protocol::code::StreamFailed, "Windows.Graphics.Capture is not supported on this system");
    }
    hideCursor_ = options.hideCursor;
    isWindow_ = options.source.kind == protocol::SourceKind::Window;
    const auto interop = winrt::get_activation_factory<wgcapi::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    if (isWindow_) {
      const auto handle = capture::parseWindowHandle(options.source.id);
      if (!handle) throw SourceError(protocol::code::SourceNotFound, "invalid window id");
      const HWND hwnd = reinterpret_cast<HWND>(static_cast<std::uintptr_t>(*handle));
      if (!::IsWindow(hwnd)) throw SourceError(protocol::code::SourceNotFound, "window no longer exists");
      scaleFactor_ = windowScaleFactor(hwnd);
      winrt::check_hresult(
          interop->CreateForWindow(hwnd, winrt::guid_of<wgcapi::GraphicsCaptureItem>(), winrt::put_abi(item_)));
    } else {
      const auto monitors = enumerateMonitors();
      std::vector<capture::MonitorDesc> descs;
      descs.reserve(monitors.size());
      for (const auto& m : monitors) descs.push_back(m.desc);
      const auto index = capture::resolveMonitor(descs, options.source);
      if (!index) throw SourceError(protocol::code::SourceNotFound, "no display found");
      scaleFactor_ = monitorScaleFactor(monitors[*index].handle);
      winrt::check_hresult(interop->CreateForMonitor(monitors[*index].handle,
                                                     winrt::guid_of<wgcapi::GraphicsCaptureItem>(),
                                                     winrt::put_abi(item_)));
    }
  }

  winrt::com_ptr<IDXGIAdapter1> requiredAdapter() override { return nullptr; }

  SourceInfo open(ID3D11Device* device) override {
    device_ = toWinrtDevice(device);
    poolSize_ = item_.Size();
    framePool_ = wgcapi::Direct3D11CaptureFramePool::CreateFreeThreaded(device_, kPixelFormat, kPoolBuffers, poolSize_);
    session_ = framePool_.CreateCaptureSession(item_);

    SourceInfo info;
    info.width = poolSize_.Width;
    info.height = poolSize_.Height;
    info.cursorCaptured = true;
    info.scaleFactor = scaleFactor_;
    // §5.4: IsCursorCaptureEnabled works for monitors from 19041 but for window
    // items only from 20348; below that the cursor stays in window captures.
    if (propertyPresent(L"IsCursorCaptureEnabled") && (!isWindow_ || windowsBuildNumber() >= 20348)) {
      session_.IsCursorCaptureEnabled(!hideCursor_);
      info.cursorCaptured = !hideCursor_;
    }
    if (propertyPresent(L"IsBorderRequired")) {
      try {
        // Unpackaged apps may need to request borderless access first (Windows 11).
        if (ApiInformation::IsTypePresent(L"Windows.Graphics.Capture.GraphicsCaptureAccess")) {
          wgcapi::GraphicsCaptureAccess::RequestAccessAsync(wgcapi::GraphicsCaptureAccessKind::Borderless).get();
        }
        session_.IsBorderRequired(false);
      } catch (const winrt::hresult_error&) {
        // Yellow border stays; not fatal.
      }
    }
    return info;
  }

  void start(FrameCallback onFrame, ClosedCallback onClosed) override {
    onFrame_ = std::move(onFrame);
    onClosed_ = std::move(onClosed);
    frameArrived_ = framePool_.FrameArrived(winrt::auto_revoke, {this, &WgcSource::onFrameArrived});
    itemClosed_ = item_.Closed(winrt::auto_revoke, {this, &WgcSource::onItemClosed});
    session_.StartCapture();
  }

  void stop() override {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (stopped_) return;
      stopped_ = true;
    }
    frameArrived_.revoke();
    itemClosed_.revoke();
    try {
      if (session_) session_.Close();
    } catch (...) {
    }
    {
      std::unique_lock<std::mutex> lock(mutex_);
      idle_.wait(lock, [this] { return inFlight_ == 0; });
    }
    try {
      if (framePool_) framePool_.Close();
    } catch (...) {
    }
    session_ = nullptr;
    framePool_ = nullptr;
    item_ = nullptr;
  }

 private:
  void onFrameArrived(const wgcapi::Direct3D11CaptureFramePool& sender, const winrt::Windows::Foundation::IInspectable&) {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (stopped_) return;
      ++inFlight_;
    }
    struct Done {
      WgcSource* self;
      ~Done() {
        std::lock_guard<std::mutex> lock(self->mutex_);
        --self->inFlight_;
        self->idle_.notify_all();
      }
    } done{this};

    try {
      wgcapi::Direct3D11CaptureFrame frame = sender.TryGetNextFrame();
      if (!frame) return;
      const auto content = frame.ContentSize();
      // SystemRelativeTime: QPC-based, 100 ns units.
      const std::int64_t hostNs = timing::hnsToNs(frame.SystemRelativeTime().count());
      {
        winrt::com_ptr<ID3D11Texture2D> texture = textureFromSurface(frame.Surface());
        // ContentSize can exceed the pool surface right after a window grows (the
        // pool is recreated below); never let the copy box leave the texture.
        D3D11_TEXTURE2D_DESC desc{};
        texture->GetDesc(&desc);
        const std::int64_t w = std::min<std::int64_t>(content.Width, static_cast<std::int64_t>(desc.Width));
        const std::int64_t h = std::min<std::int64_t>(content.Height, static_cast<std::int64_t>(desc.Height));
        if (onFrame_) onFrame_(texture.get(), w, h, hostNs);
      }
      frame.Close();
      // Window resized: recreate the pool so later frames are not clipped.
      if (content.Width > 0 && content.Height > 0 &&
          (content.Width != poolSize_.Width || content.Height != poolSize_.Height)) {
        poolSize_ = content;
        sender.Recreate(device_, kPixelFormat, kPoolBuffers, poolSize_);
      }
    } catch (const winrt::hresult_error& e) {
      const HRESULT hr = static_cast<HRESULT>(e.code());
      if (hr == DXGI_ERROR_DEVICE_REMOVED || hr == DXGI_ERROR_DEVICE_RESET) {
        notifyClosed(protocol::reason::StreamStopped, "graphics device removed " + win::hresultText(hr));
      }
    }
  }

  void onItemClosed(const wgcapi::GraphicsCaptureItem&, const winrt::Windows::Foundation::IInspectable&) {
    notifyClosed(protocol::reason::SourceLost, "capture target closed");
  }

  void notifyClosed(const std::string& reason, const std::string& message) {
    if (closedNotified_.exchange(true)) return;
    if (onClosed_) onClosed_(reason, message);
  }

  bool hideCursor_ = true;
  bool isWindow_ = false;
  double scaleFactor_ = 1.0;
  wgcapi::GraphicsCaptureItem item_{nullptr};
  d3dapi::IDirect3DDevice device_{nullptr};
  wgcapi::Direct3D11CaptureFramePool framePool_{nullptr};
  wgcapi::GraphicsCaptureSession session_{nullptr};
  winrt::Windows::Graphics::SizeInt32 poolSize_{};
  wgcapi::Direct3D11CaptureFramePool::FrameArrived_revoker frameArrived_;
  wgcapi::GraphicsCaptureItem::Closed_revoker itemClosed_;
  FrameCallback onFrame_;
  ClosedCallback onClosed_;
  std::mutex mutex_;
  std::condition_variable idle_;
  int inFlight_ = 0;
  bool stopped_ = false;
  std::atomic<bool> closedNotified_{false};
};

}  // namespace

std::unique_ptr<FrameSource> createFrameSource() { return std::make_unique<WgcSource>(); }

std::vector<std::string> frameSourceCaps() {
  std::vector<std::string> caps;
  bool supported = false;
  try {
    supported = wgcapi::GraphicsCaptureSession::IsSupported();
  } catch (...) {
  }
  if (!supported) return {"unsupported"};
  caps = {"display", "window", "region"};
  if (propertyPresent(L"IsCursorCaptureEnabled")) {
    caps.emplace_back("hideCursor");
    // §5.4: hiding the cursor for *window* items needs build >= 20348.
    if (windowsBuildNumber() >= 20348) caps.emplace_back("hideCursorWindow");
  }
  if (propertyPresent(L"IsBorderRequired")) caps.emplace_back("borderless");
  return caps;
}

}  // namespace reelform::wgc
