// Direct3D 11 helpers for the capture pipeline.
// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#pragma once

#include <d3d11.h>
#include <dxgi1_2.h>

#include <cstdint>
#include <mutex>
#include <vector>

#include <winrt/base.h>

#include "frame_source.hpp"

namespace reelform::wgc {

/// Hardware D3D11 device (BGRA + video support, multithread-protected so Media
/// Foundation can share it). `adapter == nullptr` -> default adapter; falls back
/// to WARP when no hardware device can be created.
winrt::com_ptr<ID3D11Device> createDevice(IDXGIAdapter1* adapter);

/// Fixed-size output textures (encoder frame size) recycled through Media
/// Foundation tracked samples: a texture returns to the free list only when the
/// encoder has released the sample that wraps it (IMFTrackedSample allocator
/// callback), so frames are never overwritten while the MFT still reads them.
class OutputTexturePool {
 public:
  OutputTexturePool(ID3D11Device* device, UINT width, UINT height, std::size_t maxTextures);

  /// A free texture, or nullptr when all `maxTextures` are in flight (caller drops the frame).
  winrt::com_ptr<ID3D11Texture2D> acquire();
  /// Return a texture (called from the tracked-sample callback).
  void release(winrt::com_ptr<ID3D11Texture2D> texture);

  UINT width() const { return width_; }
  UINT height() const { return height_; }

 private:
  winrt::com_ptr<ID3D11Device> device_;
  UINT width_;
  UINT height_;
  std::size_t max_;
  std::size_t created_ = 0;
  std::mutex mutex_;
  std::vector<winrt::com_ptr<ID3D11Texture2D>> free_;
};

/// Copy (and crop) `src` into `dst` per `plan`, clearing `dst` to black first
/// when the copied area does not cover it. Serialised by an internal lock on
/// the immediate context.
void copyFrame(ID3D11Device* device, ID3D11Texture2D* src, ID3D11Texture2D* dst,
               const capture::CopyPlan& plan);

}  // namespace reelform::wgc
