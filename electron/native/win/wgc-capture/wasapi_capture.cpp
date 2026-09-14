// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#include <unknwn.h>

#include <future>

#include "wasapi_capture.hpp"

#include <audioclient.h>
#include <mmdeviceapi.h>

#include <winrt/base.h>

#include "mf_writers.hpp"
#include "reelform/timing.hpp"

namespace reelform::wgc {

namespace {
constexpr REFERENCE_TIME kBufferHns = 2'000'000;  // 200 ms engine buffer
constexpr DWORD kPollMs = 10;
}  // namespace

WasapiCapture::WasapiCapture(AudioEndpointKind kind, std::optional<std::string> deviceId)
    : kind_(kind), deviceId_(std::move(deviceId)) {
  stopEvent_ = ::CreateEventW(nullptr, TRUE, FALSE, nullptr);
}

WasapiCapture::~WasapiCapture() {
  stop();
  if (stopEvent_ != nullptr) ::CloseHandle(stopEvent_);
}

bool WasapiCapture::start(AudioPacketCallback onPacket, AudioLostCallback onLost, std::string& error) {
  if (stopEvent_ == nullptr) {
    error = "CreateEvent failed";
    return false;
  }
  onPacket_ = std::move(onPacket);
  onLost_ = std::move(onLost);
  std::promise<std::string> ready;
  std::future<std::string> result = ready.get_future();
  thread_ = std::thread([this, &ready] { run(&ready); });
  error = result.get();
  if (!error.empty()) {
    thread_.join();
    return false;
  }
  return true;
}

void WasapiCapture::stop() {
  if (stopEvent_ != nullptr) ::SetEvent(stopEvent_);
  if (thread_.joinable()) thread_.join();
}

void WasapiCapture::run(std::promise<std::string>* ready) {
  const HRESULT hrCo = ::CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool loopback = kind_ == AudioEndpointKind::SystemLoopback;
  bool readySent = false;
  const auto failStart = [&](const char* step, HRESULT hr) {
    ready->set_value(std::string(loopback ? "system audio " : "microphone ") + step + " failed " +
                     win::hresultText(hr));
    readySent = true;
  };

  {  // COM objects must be released before CoUninitialize
    winrt::com_ptr<IMMDeviceEnumerator> enumerator;
    winrt::com_ptr<IMMDevice> device;
    winrt::com_ptr<IAudioClient> client;
    winrt::com_ptr<IAudioCaptureClient> capture;
    HRESULT hr = ::CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator),
                                    enumerator.put_void());
    if (FAILED(hr)) {
      failStart("device enumerator", hr);
    } else {
      if (loopback) {
        hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, device.put());
      } else {
        const bool wantsDefault = !deviceId_.has_value() || deviceId_->empty() || *deviceId_ == "default";
        hr = E_FAIL;
        if (!wantsDefault) hr = enumerator->GetDevice(win::toWide(*deviceId_).c_str(), device.put());
        if (FAILED(hr)) {
          if (!wantsDefault) usedDefaultFallback_ = true;
          device = nullptr;
          hr = enumerator->GetDefaultAudioEndpoint(eCapture, eConsole, device.put());
        }
      }
      if (FAILED(hr)) failStart("endpoint lookup", hr);
    }

    if (!readySent) {
      hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, client.put_void());
      if (FAILED(hr)) failStart("Activate", hr);
    }
    if (!readySent) {
      WAVEFORMATEX format{};
      format.wFormatTag = WAVE_FORMAT_PCM;
      format.nChannels = static_cast<WORD>(AudioWriter::kChannels);
      format.nSamplesPerSec = AudioWriter::kSampleRate;
      format.wBitsPerSample = static_cast<WORD>(AudioWriter::kBitsPerSample);
      format.nBlockAlign = static_cast<WORD>(format.nChannels * format.wBitsPerSample / 8);
      format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
      DWORD flags = AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
      if (loopback) flags |= AUDCLNT_STREAMFLAGS_LOOPBACK;
      hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, kBufferHns, 0, &format, nullptr);
      if (FAILED(hr)) failStart("Initialize", hr);
    }
    if (!readySent) {
      hr = client->GetService(__uuidof(IAudioCaptureClient), capture.put_void());
      if (FAILED(hr)) failStart("GetService", hr);
    }
    if (!readySent) {
      hr = client->Start();
      if (FAILED(hr)) failStart("Start", hr);
    }

    if (!readySent) {
      ready->set_value(std::string());
      readySent = true;

      std::int64_t lastHostNs = -1;
      std::int64_t lastFrames = 0;
      bool lost = false;
      while (!lost && ::WaitForSingleObject(stopEvent_, kPollMs) == WAIT_TIMEOUT) {
        for (;;) {
          UINT32 packetFrames = 0;
          hr = capture->GetNextPacketSize(&packetFrames);
          if (hr == AUDCLNT_E_DEVICE_INVALIDATED) {
            lost = true;
            break;
          }
          if (FAILED(hr) || packetFrames == 0) break;

          BYTE* data = nullptr;
          UINT32 frames = 0;
          DWORD bufferFlags = 0;
          UINT64 devicePosition = 0;
          UINT64 qpcPosition = 0;  // 100 ns units on the QPC clock
          hr = capture->GetBuffer(&data, &frames, &bufferFlags, &devicePosition, &qpcPosition);
          if (hr == AUDCLNT_E_DEVICE_INVALIDATED) {
            lost = true;
            break;
          }
          if (hr == AUDCLNT_S_BUFFER_EMPTY || FAILED(hr)) break;

          std::int64_t hostNs = timing::hnsToNs(static_cast<std::int64_t>(qpcPosition));
          if (((bufferFlags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) != 0 || qpcPosition == 0) && lastHostNs >= 0) {
            hostNs = lastHostNs + (lastFrames * timing::kNsPerSec) / AudioWriter::kSampleRate;
          }
          AudioPacket packet;
          packet.samples = (bufferFlags & AUDCLNT_BUFFERFLAGS_SILENT) != 0
                               ? nullptr
                               : reinterpret_cast<const std::int16_t*>(data);
          packet.frames = frames;
          packet.hostNs = hostNs;
          packet.discontinuity = (bufferFlags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) != 0;
          if (onPacket_) onPacket_(packet);
          capture->ReleaseBuffer(frames);
          lastHostNs = hostNs;
          lastFrames = frames;
        }
      }
      client->Stop();
      if (lost && onLost_) onLost_(loopback ? "system audio device was removed or changed" : "microphone was disconnected");
    }
  }

  if (!readySent) ready->set_value("audio capture failed");
  if (SUCCEEDED(hrCo)) ::CoUninitialize();
}

}  // namespace reelform::wgc
