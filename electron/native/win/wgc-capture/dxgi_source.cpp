// DXGI Desktop Duplication frame source (§5.4 fallback).
// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#include <unknwn.h>

#include "dxgi_source.hpp"

#include <dxgi1_2.h>

#include <atomic>
#include <chrono>
#include <thread>

#include <winrt/base.h>

#include "reelform/timing.hpp"

namespace reelform::wgc {

namespace {

constexpr UINT kAcquireTimeoutMs = 100;
constexpr DWORD kRetryMs = 50;
constexpr auto kLostGiveUp = std::chrono::seconds(10);

class DxgiSource final : public FrameSource {
 public:
  DxgiSource() { stopEvent_ = ::CreateEventW(nullptr, TRUE, FALSE, nullptr); }
  ~DxgiSource() override {
    stop();
    if (stopEvent_ != nullptr) ::CloseHandle(stopEvent_);
  }

  const char* backendId() const override { return "dxgi"; }

  void resolve(const protocol::StartOptions& options) override {
    if (options.source.kind != protocol::SourceKind::Display) {
      throw SourceError(protocol::code::BadRequest, "the DXGI backend captures displays only");
    }
    const auto monitors = enumerateMonitors();
    std::vector<capture::MonitorDesc> descs;
    for (const auto& m : monitors) descs.push_back(m.desc);
    const auto index = capture::resolveMonitor(descs, options.source);
    if (!index) throw SourceError(protocol::code::SourceNotFound, "no display found");
    const HMONITOR target = monitors[*index].handle;
    scaleFactor_ = monitorScaleFactor(target);

    winrt::com_ptr<IDXGIFactory1> factory;
    winrt::check_hresult(::CreateDXGIFactory1(__uuidof(IDXGIFactory1), factory.put_void()));
    for (UINT ai = 0;; ++ai) {
      winrt::com_ptr<IDXGIAdapter1> adapter;
      if (factory->EnumAdapters1(ai, adapter.put()) == DXGI_ERROR_NOT_FOUND) break;
      for (UINT oi = 0;; ++oi) {
        winrt::com_ptr<IDXGIOutput> output;
        if (adapter->EnumOutputs(oi, output.put()) == DXGI_ERROR_NOT_FOUND) break;
        DXGI_OUTPUT_DESC desc{};
        if (SUCCEEDED(output->GetDesc(&desc)) && desc.Monitor == target) {
          if (desc.Rotation != DXGI_MODE_ROTATION_IDENTITY && desc.Rotation != DXGI_MODE_ROTATION_UNSPECIFIED) {
            throw SourceError(protocol::code::BadRequest, "rotated displays are not supported by the DXGI backend");
          }
          adapter_ = adapter;
          output_ = output.as<IDXGIOutput1>();
          return;
        }
      }
    }
    throw SourceError(protocol::code::SourceNotFound, "display is not attached to a duplicable output");
  }

  winrt::com_ptr<IDXGIAdapter1> requiredAdapter() override { return adapter_; }

  SourceInfo open(ID3D11Device* device) override {
    device_.copy_from(device);
    const HRESULT hr = duplicate();
    if (hr == E_ACCESSDENIED) {
      throw SourceError(protocol::code::PermissionDenied, "desktop duplication denied (secure desktop?)");
    }
    if (hr == DXGI_ERROR_NOT_CURRENTLY_AVAILABLE) {
      throw SourceError(protocol::code::StreamFailed, "too many desktop duplication clients");
    }
    winrt::check_hresult(hr);
    DXGI_OUTDUPL_DESC desc{};
    duplication_->GetDesc(&desc);
    SourceInfo info;
    info.width = desc.ModeDesc.Width;
    info.height = desc.ModeDesc.Height;
    // Desktop Duplication frames never contain the pointer (it is delivered
    // separately via GetFramePointerShape, which we ignore).
    info.cursorCaptured = false;
    info.scaleFactor = scaleFactor_;
    return info;
  }

  void start(FrameCallback onFrame, ClosedCallback onClosed) override {
    onFrame_ = std::move(onFrame);
    onClosed_ = std::move(onClosed);
    thread_ = std::thread([this] { loop(); });
  }

  void stop() override {
    stopping_ = true;
    if (stopEvent_ != nullptr) ::SetEvent(stopEvent_);
    if (thread_.joinable()) thread_.join();
    duplication_ = nullptr;
  }

 private:
  HRESULT duplicate() {
    duplication_ = nullptr;
    return output_->DuplicateOutput(device_.get(), duplication_.put());
  }

  void loop() {
    const HANDLE thread = ::GetCurrentThread();
    ::SetThreadPriority(thread, THREAD_PRIORITY_ABOVE_NORMAL);
    const win::Qpc qpc;
    std::optional<std::chrono::steady_clock::time_point> lostSince;

    while (!stopping_) {
      if (!duplication_) {
        // Access lost (mode change, desktop switch, UAC): retry for a while.
        if (!lostSince) lostSince = std::chrono::steady_clock::now();
        if (SUCCEEDED(duplicate())) {
          lostSince.reset();
        } else {
          if (std::chrono::steady_clock::now() - *lostSince > kLostGiveUp) {
            if (onClosed_) onClosed_(protocol::reason::SourceLost, "desktop duplication lost");
            return;
          }
          if (::WaitForSingleObject(stopEvent_, kRetryMs) == WAIT_OBJECT_0) return;
          continue;
        }
      }

      DXGI_OUTDUPL_FRAME_INFO frameInfo{};
      winrt::com_ptr<IDXGIResource> resource;
      const HRESULT hr = duplication_->AcquireNextFrame(kAcquireTimeoutMs, &frameInfo, resource.put());
      if (hr == DXGI_ERROR_WAIT_TIMEOUT) continue;
      if (hr == DXGI_ERROR_ACCESS_LOST) {
        duplication_ = nullptr;
        continue;
      }
      if (FAILED(hr)) {
        if (onClosed_) onClosed_(protocol::reason::StreamStopped, "AcquireNextFrame failed " + win::hresultText(hr));
        return;
      }
      // LastPresentTime == 0: only the pointer changed; no new desktop image.
      if (frameInfo.LastPresentTime.QuadPart != 0) {
        if (const auto texture = resource.try_as<ID3D11Texture2D>()) {
          D3D11_TEXTURE2D_DESC desc{};
          texture->GetDesc(&desc);
          // LastPresentTime is raw QPC ticks (not 100 ns like WGC/WASAPI).
          const std::int64_t hostNs = timing::qpcTicksToNs(frameInfo.LastPresentTime.QuadPart, qpc.frequency());
          if (onFrame_) onFrame_(texture.get(), desc.Width, desc.Height, hostNs);
        }
      }
      duplication_->ReleaseFrame();
    }
  }

  winrt::com_ptr<IDXGIAdapter1> adapter_;
  winrt::com_ptr<IDXGIOutput1> output_;
  winrt::com_ptr<ID3D11Device> device_;
  winrt::com_ptr<IDXGIOutputDuplication> duplication_;
  FrameCallback onFrame_;
  ClosedCallback onClosed_;
  HANDLE stopEvent_ = nullptr;
  double scaleFactor_ = 1.0;
  std::atomic<bool> stopping_{false};
  std::thread thread_;
};

}  // namespace

std::unique_ptr<FrameSource> createFrameSource() { return std::make_unique<DxgiSource>(); }

std::vector<std::string> frameSourceCaps() {
  // Frames never include the OS cursor, so hideCursor is always honoured
  // (and hideCursor:false cannot burn the cursor in).
  return {"display", "region", "hideCursor", "cursorAlwaysHidden"};
}

}  // namespace reelform::wgc
