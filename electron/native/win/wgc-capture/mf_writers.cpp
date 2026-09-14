// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#include <unknwn.h>

#include "mf_writers.hpp"

#include <mfapi.h>
#include <mferror.h>
#include <mftransform.h>
#include <strmif.h>

#include <algorithm>
#include <cstring>
#include <initializer_list>

#include <winrt/base.h>

// Last: define the CODECAPI_* property GUIDs in this translation unit.
#include <initguid.h>
#include <codecapi.h>

namespace reelform::wgc {

namespace {

#define RF_RETURN_IF_FAILED(expr)  \
  do {                             \
    const HRESULT hr_ = (expr);    \
    if (FAILED(hr_)) return hr_;   \
  } while (0)

/// Returns a texture to its pool when Media Foundation releases the tracked sample.
struct TextureReturn : winrt::implements<TextureReturn, IMFAsyncCallback> {
  TextureReturn(std::shared_ptr<OutputTexturePool> pool, winrt::com_ptr<ID3D11Texture2D> texture)
      : pool_(std::move(pool)), texture_(std::move(texture)) {}

  HRESULT STDMETHODCALLTYPE GetParameters(DWORD*, DWORD*) noexcept override { return E_NOTIMPL; }

  HRESULT STDMETHODCALLTYPE Invoke(IMFAsyncResult*) noexcept override {
    if (texture_ && pool_) pool_->release(std::move(texture_));
    texture_ = nullptr;
    return S_OK;
  }

 private:
  std::shared_ptr<OutputTexturePool> pool_;
  winrt::com_ptr<ID3D11Texture2D> texture_;
};

void setUi4(ICodecAPI* api, const GUID& property, ULONG value) {
  VARIANT v;
  ::VariantInit(&v);
  v.vt = VT_UI4;
  v.ulVal = value;
  // Best effort: not every MFT supports every property.
  (void)api->SetValue(&property, &v);
}

}  // namespace

bool hardwareH264EncoderAvailable() {
  MFT_REGISTER_TYPE_INFO outputType{MFMediaType_Video, MFVideoFormat_H264};
  IMFActivate** activates = nullptr;
  UINT32 count = 0;
  const HRESULT hr = ::MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
                                 nullptr, &outputType, &activates, &count);
  if (SUCCEEDED(hr) && activates != nullptr) {
    for (UINT32 i = 0; i < count; ++i) activates[i]->Release();
    ::CoTaskMemFree(activates);
  }
  return SUCCEEDED(hr) && count > 0;
}

// ---------------------------------------------------------------------- video

std::unique_ptr<VideoWriter> VideoWriter::create(ID3D11Device* device, const VideoWriterConfig& config,
                                                 std::string& error) {
  const bool hardware = config.preferHardware && hardwareH264EncoderAvailable();
  const std::initializer_list<bool> attempts =
      hardware ? std::initializer_list<bool>{true, false} : std::initializer_list<bool>{false};
  for (const bool useHardware : attempts) {
    std::unique_ptr<VideoWriter> writer(new VideoWriter());
    const HRESULT hr = writer->init(device, config, useHardware);
    if (SUCCEEDED(hr)) return writer;
    if (!error.empty()) error += "; ";
    error += std::string(useHardware ? "hardware" : "software") + " H.264 sink writer init failed " +
             win::hresultText(hr);
    writer.reset();
    ::DeleteFileW(config.path.c_str());
  }
  return nullptr;
}

VideoWriter::~VideoWriter() {
  std::string ignored;
  finalize(ignored);
}

HRESULT VideoWriter::init(ID3D11Device* device, const VideoWriterConfig& c, bool useHardware) {
  UINT resetToken = 0;
  RF_RETURN_IF_FAILED(::MFCreateDXGIDeviceManager(&resetToken, manager_.put()));
  RF_RETURN_IF_FAILED(manager_->ResetDevice(device, resetToken));

  winrt::com_ptr<IMFAttributes> attrs;
  RF_RETURN_IF_FAILED(::MFCreateAttributes(attrs.put(), 6));
  RF_RETURN_IF_FAILED(attrs->SetUnknown(MF_SINK_WRITER_D3D_MANAGER, manager_.get()));
  RF_RETURN_IF_FAILED(attrs->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, useHardware ? TRUE : FALSE));
  RF_RETURN_IF_FAILED(attrs->SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, TRUE));
  RF_RETURN_IF_FAILED(attrs->SetUINT32(MF_LOW_LATENCY, TRUE));
  RF_RETURN_IF_FAILED(attrs->SetGUID(MF_TRANSCODE_CONTAINERTYPE, MFTranscodeContainerType_FMPEG4));
  RF_RETURN_IF_FAILED(::MFCreateSinkWriterFromURL(c.path.c_str(), nullptr, attrs.get(), writer_.put()));

  // Output: H.264 High, BT.709 limited range (matches export colour handling, §10.4).
  winrt::com_ptr<IMFMediaType> out;
  RF_RETURN_IF_FAILED(::MFCreateMediaType(out.put()));
  RF_RETURN_IF_FAILED(out->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video));
  RF_RETURN_IF_FAILED(out->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264));
  RF_RETURN_IF_FAILED(out->SetUINT32(MF_MT_AVG_BITRATE, static_cast<UINT32>(std::max<std::int64_t>(c.bitrate, 1'000'000))));
  RF_RETURN_IF_FAILED(out->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive));
  RF_RETURN_IF_FAILED(::MFSetAttributeSize(out.get(), MF_MT_FRAME_SIZE, c.width, c.height));
  RF_RETURN_IF_FAILED(::MFSetAttributeRatio(out.get(), MF_MT_FRAME_RATE, static_cast<UINT32>(c.fps), 1));
  RF_RETURN_IF_FAILED(::MFSetAttributeRatio(out.get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1));
  RF_RETURN_IF_FAILED(out->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High));
  (void)out->SetUINT32(MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709);
  (void)out->SetUINT32(MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709);
  (void)out->SetUINT32(MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709);
  (void)out->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235);
  RF_RETURN_IF_FAILED(writer_->AddStream(out.get(), &stream_));

  // Input: BGRA DXGI surfaces. Positive default stride = top-down (RGB32 is
  // bottom-up in MF without it, which would flip the video).
  winrt::com_ptr<IMFMediaType> in;
  RF_RETURN_IF_FAILED(::MFCreateMediaType(in.put()));
  RF_RETURN_IF_FAILED(in->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video));
  RF_RETURN_IF_FAILED(in->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32));
  RF_RETURN_IF_FAILED(in->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive));
  RF_RETURN_IF_FAILED(::MFSetAttributeSize(in.get(), MF_MT_FRAME_SIZE, c.width, c.height));
  RF_RETURN_IF_FAILED(::MFSetAttributeRatio(in.get(), MF_MT_FRAME_RATE, static_cast<UINT32>(c.fps), 1));
  RF_RETURN_IF_FAILED(::MFSetAttributeRatio(in.get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1));
  RF_RETURN_IF_FAILED(in->SetUINT32(MF_MT_DEFAULT_STRIDE, c.width * 4));
  RF_RETURN_IF_FAILED(writer_->SetInputMediaType(stream_, in.get(), nullptr));

  configureCodec(c);
  RF_RETURN_IF_FAILED(writer_->BeginWriting());
  detectEncoder(useHardware);
  return S_OK;
}

void VideoWriter::configureCodec(const VideoWriterConfig& c) {
  winrt::com_ptr<ICodecAPI> api;
  if (FAILED(writer_->GetServiceForStream(stream_, GUID_NULL, __uuidof(ICodecAPI), api.put_void())) || !api) {
    return;
  }
  setUi4(api.get(), CODECAPI_AVEncMPVGOPSize, static_cast<ULONG>(c.fps * 2));  // keyframe every 2 s
  setUi4(api.get(), CODECAPI_AVEncCommonRateControlMode, eAVEncCommonRateControlMode_UnconstrainedVBR);
  setUi4(api.get(), CODECAPI_AVEncCommonMeanBitRate, static_cast<ULONG>(c.bitrate));
  setUi4(api.get(), CODECAPI_AVLowLatencyMode, TRUE);
}

void VideoWriter::detectEncoder(bool useHardware) {
  encoder_ = {"unknown", useHardware};
  const auto ex = writer_.try_as<IMFSinkWriterEx>();
  if (!ex) return;
  for (DWORD index = 0;; ++index) {
    GUID category = GUID_NULL;
    winrt::com_ptr<IMFTransform> transform;
    if (FAILED(ex->GetTransformForStream(stream_, index, &category, transform.put()))) break;
    if (category != MFT_CATEGORY_VIDEO_ENCODER || !transform) continue;
    winrt::com_ptr<IMFAttributes> attrs;
    if (SUCCEEDED(transform->GetAttributes(attrs.put())) && attrs) {
      UINT32 length = 0;
      // Hardware MFTs carry MFT_ENUM_HARDWARE_URL_Attribute on their attribute store.
      encoder_.hardware = SUCCEEDED(attrs->GetStringLength(MFT_ENUM_HARDWARE_URL_Attribute, &length));
      LPWSTR name = nullptr;
      if (SUCCEEDED(attrs->GetAllocatedString(MFT_FRIENDLY_NAME_Attribute, &name, &length)) && name != nullptr) {
        encoder_.name = win::toUtf8(name);
        ::CoTaskMemFree(name);
      }
    }
    break;
  }
}

bool VideoWriter::write(const std::shared_ptr<OutputTexturePool>& pool, winrt::com_ptr<ID3D11Texture2D> texture,
                        std::int64_t timeHns, std::int64_t durationHns) {
  winrt::com_ptr<IMFMediaBuffer> buffer;
  if (FAILED(::MFCreateDXGISurfaceBuffer(__uuidof(ID3D11Texture2D), texture.get(), 0, FALSE, buffer.put()))) {
    pool->release(std::move(texture));
    return false;
  }
  winrt::com_ptr<IMFTrackedSample> tracked;
  if (FAILED(::MFCreateTrackedSample(tracked.put()))) {
    pool->release(std::move(texture));
    return false;
  }
  // From here the callback owns returning the texture, on every path.
  const auto callback = winrt::make_self<TextureReturn>(pool, std::move(texture));
  if (FAILED(tracked->SetAllocator(callback.get(), nullptr))) {
    // The sample never took ownership: hand the texture back now, otherwise the
    // pool loses a slot for good and eventually drops every frame.
    callback->Invoke(nullptr);
    return false;
  }

  if (const auto buffer2d = buffer.try_as<IMF2DBuffer>()) {
    DWORD length = 0;
    if (SUCCEEDED(buffer2d->GetContiguousLength(&length))) buffer->SetCurrentLength(length);
  }
  const auto sample = tracked.as<IMFSample>();
  if (FAILED(sample->AddBuffer(buffer.get()))) return false;
  sample->SetSampleTime(timeHns);
  sample->SetSampleDuration(durationHns);

  std::lock_guard<std::mutex> lock(mutex_);
  if (finalized_ || !writer_) return false;
  return SUCCEEDED(writer_->WriteSample(stream_, sample.get()));
}

bool VideoWriter::finalize(std::string& error) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (finalized_) return true;
  finalized_ = true;
  bool ok = true;
  if (writer_) {
    const HRESULT hr = writer_->Finalize();
    if (FAILED(hr)) {
      error = "video Finalize failed " + win::hresultText(hr);
      ok = false;
    }
  }
  writer_ = nullptr;
  manager_ = nullptr;
  return ok;
}

// ---------------------------------------------------------------------- audio

std::unique_ptr<AudioWriter> AudioWriter::create(const std::wstring& path, std::string& error) {
  std::unique_ptr<AudioWriter> w(new AudioWriter());
  const auto fail = [&](const char* step, HRESULT hr) {
    error = std::string("audio writer ") + step + " failed " + win::hresultText(hr);
    w.reset();
    ::DeleteFileW(path.c_str());
    return nullptr;
  };
  HRESULT hr = S_OK;
  winrt::com_ptr<IMFAttributes> attrs;
  if (FAILED(hr = ::MFCreateAttributes(attrs.put(), 2))) return fail("attributes", hr);
  attrs->SetGUID(MF_TRANSCODE_CONTAINERTYPE, MFTranscodeContainerType_FMPEG4);
  attrs->SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, TRUE);
  if (FAILED(hr = ::MFCreateSinkWriterFromURL(path.c_str(), nullptr, attrs.get(), w->writer_.put()))) {
    return fail("create", hr);
  }

  winrt::com_ptr<IMFMediaType> out;
  ::MFCreateMediaType(out.put());
  out->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
  out->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_AAC);
  out->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, kBitsPerSample);
  out->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, kSampleRate);
  out->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, kChannels);
  out->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, kAacBytesPerSecond);
  out->SetUINT32(MF_MT_AAC_PAYLOAD_TYPE, 0);  // raw AAC in MP4
  if (FAILED(hr = w->writer_->AddStream(out.get(), &w->stream_))) return fail("AddStream", hr);

  winrt::com_ptr<IMFMediaType> in;
  ::MFCreateMediaType(in.put());
  in->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
  in->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM);
  in->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, kBitsPerSample);
  in->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, kSampleRate);
  in->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, kChannels);
  in->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, kChannels * kBitsPerSample / 8);
  in->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, kSampleRate * kChannels * kBitsPerSample / 8);
  in->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);
  if (FAILED(hr = w->writer_->SetInputMediaType(w->stream_, in.get(), nullptr))) return fail("SetInputMediaType", hr);
  if (FAILED(hr = w->writer_->BeginWriting())) return fail("BeginWriting", hr);
  return w;
}

AudioWriter::~AudioWriter() {
  std::string ignored;
  finalize(ignored);
}

bool AudioWriter::writePcm(const std::int16_t* interleaved, std::int64_t frames, std::int64_t startFrame) {
  const std::int64_t bytesPerFrame = kChannels * kBitsPerSample / 8;
  while (frames > 0) {
    const std::int64_t chunk = std::min<std::int64_t>(frames, kSampleRate);
    const DWORD bytes = static_cast<DWORD>(chunk * bytesPerFrame);
    winrt::com_ptr<IMFMediaBuffer> buffer;
    if (FAILED(::MFCreateMemoryBuffer(bytes, buffer.put()))) return false;
    BYTE* dst = nullptr;
    if (FAILED(buffer->Lock(&dst, nullptr, nullptr))) return false;
    if (interleaved != nullptr) {
      std::memcpy(dst, interleaved, bytes);
    } else {
      std::memset(dst, 0, bytes);
    }
    buffer->Unlock();
    buffer->SetCurrentLength(bytes);

    winrt::com_ptr<IMFSample> sample;
    if (FAILED(::MFCreateSample(sample.put()))) return false;
    sample->AddBuffer(buffer.get());
    const std::int64_t t0 = framesToHns(startFrame, kSampleRate);
    const std::int64_t t1 = framesToHns(startFrame + chunk, kSampleRate);
    sample->SetSampleTime(t0);
    sample->SetSampleDuration(t1 - t0);
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (finalized_ || !writer_) return false;
      if (FAILED(writer_->WriteSample(stream_, sample.get()))) return false;
      wroteSamples_ = true;
    }
    if (interleaved != nullptr) interleaved += chunk * kChannels;
    frames -= chunk;
    startFrame += chunk;
  }
  return true;
}

bool AudioWriter::finalize(std::string& error) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (finalized_) return true;
  finalized_ = true;
  bool ok = true;
  if (writer_) {
    const HRESULT hr = writer_->Finalize();
    if (FAILED(hr)) {
      error = "audio Finalize failed " + win::hresultText(hr);
      ok = false;
    }
  }
  writer_ = nullptr;
  return ok;
}

}  // namespace reelform::wgc
