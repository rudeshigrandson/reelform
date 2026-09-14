// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#include <unknwn.h>

#include "d3d_util.hpp"

#include <d3d11_4.h>
#include <shellscalingapi.h>

#include <cwchar>

#include <winrt/base.h>

namespace reelform::wgc {

namespace {

HRESULT tryCreateDevice(IDXGIAdapter1* adapter, D3D_DRIVER_TYPE type, UINT flags, ID3D11Device** out) {
  static const D3D_FEATURE_LEVEL kLevels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0,
                                              D3D_FEATURE_LEVEL_10_1};
  HRESULT hr = D3D11CreateDevice(adapter, type, nullptr, flags, kLevels, ARRAYSIZE(kLevels),
                                 D3D11_SDK_VERSION, out, nullptr, nullptr);
  if (hr == E_INVALIDARG) {
    // Runtimes without 11_1 reject the whole list.
    hr = D3D11CreateDevice(adapter, type, nullptr, flags, kLevels + 1, ARRAYSIZE(kLevels) - 1,
                           D3D11_SDK_VERSION, out, nullptr, nullptr);
  }
  return hr;
}

/// RAII over ID3D11Multithread::Enter/Leave (the lock Media Foundation also takes).
class ContextLock {
 public:
  explicit ContextLock(ID3D11DeviceContext* ctx) {
    winrt::com_ptr<ID3D11DeviceContext> context;
    context.copy_from(ctx);
    mt_ = context.try_as<ID3D11Multithread>();
    if (mt_) mt_->Enter();
  }
  ~ContextLock() {
    if (mt_) mt_->Leave();
  }
  ContextLock(const ContextLock&) = delete;
  ContextLock& operator=(const ContextLock&) = delete;

 private:
  winrt::com_ptr<ID3D11Multithread> mt_;
};

}  // namespace

winrt::com_ptr<ID3D11Device> createDevice(IDXGIAdapter1* adapter) {
  const D3D_DRIVER_TYPE type = adapter != nullptr ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE;
  UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT;
  winrt::com_ptr<ID3D11Device> device;
  HRESULT hr = tryCreateDevice(adapter, type, flags, device.put());
  if (FAILED(hr)) {
    device = nullptr;
    flags &= ~static_cast<UINT>(D3D11_CREATE_DEVICE_VIDEO_SUPPORT);
    hr = tryCreateDevice(adapter, type, flags, device.put());
  }
  if (FAILED(hr) && adapter == nullptr) {
    device = nullptr;
    hr = tryCreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, flags, device.put());
  }
  winrt::check_hresult(hr);
  if (auto mt = device.try_as<ID3D11Multithread>()) mt->SetMultithreadProtected(TRUE);
  return device;
}

OutputTexturePool::OutputTexturePool(ID3D11Device* device, UINT width, UINT height, std::size_t maxTextures)
    : width_(width), height_(height), max_(maxTextures) {
  device_.copy_from(device);
}

winrt::com_ptr<ID3D11Texture2D> OutputTexturePool::acquire() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!free_.empty()) {
    winrt::com_ptr<ID3D11Texture2D> t = std::move(free_.back());
    free_.pop_back();
    return t;
  }
  if (created_ >= max_) return nullptr;
  D3D11_TEXTURE2D_DESC desc{};
  desc.Width = width_;
  desc.Height = height_;
  desc.MipLevels = 1;
  desc.ArraySize = 1;
  desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  desc.SampleDesc.Count = 1;
  desc.Usage = D3D11_USAGE_DEFAULT;
  // RENDER_TARGET: needed for clears and by the DXVA color converter in the sink writer.
  desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
  winrt::com_ptr<ID3D11Texture2D> t;
  if (FAILED(device_->CreateTexture2D(&desc, nullptr, t.put()))) return nullptr;
  ++created_;
  return t;
}

void OutputTexturePool::release(winrt::com_ptr<ID3D11Texture2D> texture) {
  if (!texture) return;
  std::lock_guard<std::mutex> lock(mutex_);
  free_.push_back(std::move(texture));
}

void copyFrame(ID3D11Device* device, ID3D11Texture2D* src, ID3D11Texture2D* dst, const capture::CopyPlan& plan) {
  if (plan.empty) return;
  winrt::com_ptr<ID3D11DeviceContext> ctx;
  device->GetImmediateContext(ctx.put());
  ContextLock lock(ctx.get());
  if (plan.needsClear) {
    winrt::com_ptr<ID3D11RenderTargetView> rtv;
    if (SUCCEEDED(device->CreateRenderTargetView(dst, nullptr, rtv.put()))) {
      const float black[4] = {0.0f, 0.0f, 0.0f, 1.0f};
      ctx->ClearRenderTargetView(rtv.get(), black);
    }
  }
  D3D11_BOX box{plan.left, plan.top, 0, plan.right, plan.bottom, 1};
  ctx->CopySubresourceRegion(dst, 0, 0, 0, 0, src, 0, &box);
}

std::vector<MonitorHandle> enumerateMonitors() {
  std::vector<MonitorHandle> out;
  ::EnumDisplayMonitors(
      nullptr, nullptr,
      [](HMONITOR monitor, HDC, LPRECT, LPARAM data) -> BOOL {
        auto* list = reinterpret_cast<std::vector<MonitorHandle>*>(data);
        MONITORINFOEXW info{};
        info.cbSize = sizeof(info);
        if (::GetMonitorInfoW(monitor, &info)) {
          MonitorHandle m;
          m.handle = monitor;
          m.desc.deviceName = win::toUtf8(info.szDevice);
          m.desc.bounds = {info.rcMonitor.left, info.rcMonitor.top, info.rcMonitor.right - info.rcMonitor.left,
                           info.rcMonitor.bottom - info.rcMonitor.top};
          m.desc.primary = (info.dwFlags & MONITORINFOF_PRIMARY) != 0;
          list->push_back(std::move(m));
        }
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&out));
  return out;
}

double monitorScaleFactor(HMONITOR monitor) {
  UINT dpiX = 0;
  UINT dpiY = 0;
  if (monitor == nullptr || FAILED(::GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY)) || dpiX == 0) {
    return 1.0;
  }
  return static_cast<double>(dpiX) / 96.0;
}

double windowScaleFactor(HWND window) {
  const UINT dpi = window != nullptr ? ::GetDpiForWindow(window) : 0;
  return dpi == 0 ? 1.0 : static_cast<double>(dpi) / 96.0;
}

unsigned windowsBuildNumber() {
  wchar_t buf[32] = {};
  DWORD size = sizeof(buf);
  if (::RegGetValueW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
                     L"CurrentBuildNumber", RRF_RT_REG_SZ, nullptr, buf, &size) != ERROR_SUCCESS) {
    return 0;
  }
  return static_cast<unsigned>(std::wcstoul(buf, nullptr, 10));
}

}  // namespace reelform::wgc
