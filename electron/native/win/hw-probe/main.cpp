// reelform-hw-probe.exe (§5.4): enumerate Media Foundation video encoders
// (hardware + software) and DXGI adapters, print one JSON report line.
//
//   reelform-hw-probe.exe            print {"t":"report",...} and exit 0
//   reelform-hw-probe.exe --stdio    protocol loop: ping -> pong, {"t":"probe"} -> report, stop -> exit
//
// Report schema: common/include/reelform/hw_probe_report.hpp; parsed by ../probe.ts.
// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#include <unknwn.h>

#include "../common/win_util.hpp"

#include <d3d11.h>
#include <dxgi1_2.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>

#include <cwchar>

#include <winrt/base.h>

#include "reelform/hw_probe_report.hpp"
#include "reelform/json.hpp"
#include "reelform/line_io.hpp"
#include "reelform/protocol.hpp"

namespace {

using namespace reelform;

/// FOURCC-based MF video subtype GUID ({FOURCC-0000-0010-8000-00AA00389B71}).
/// Built locally so older SDK headers lacking MFVideoFormat_AV1 still compile.
GUID fourccSubtype(std::uint32_t fourcc) {
  return GUID{fourcc, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71}};
}

std::uint32_t fourcc(const char s[5]) {
  return static_cast<std::uint32_t>(static_cast<unsigned char>(s[0])) |
         (static_cast<std::uint32_t>(static_cast<unsigned char>(s[1])) << 8) |
         (static_cast<std::uint32_t>(static_cast<unsigned char>(s[2])) << 16) |
         (static_cast<std::uint32_t>(static_cast<unsigned char>(s[3])) << 24);
}

std::optional<std::string> allocatedString(IMFActivate* activate, const GUID& key) {
  LPWSTR value = nullptr;
  UINT32 length = 0;
  if (FAILED(activate->GetAllocatedString(key, &value, &length)) || value == nullptr) return std::nullopt;
  std::string out = win::toUtf8(std::wstring_view(value, length));
  ::CoTaskMemFree(value);
  return out;
}

void enumerateEncoders(std::uint32_t subtypeFourcc, bool hardware, hwprobe::Report& report) {
  const MFT_REGISTER_TYPE_INFO outputType{MFMediaType_Video, fourccSubtype(subtypeFourcc)};
  const UINT32 flags = hardware ? (MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER)
                                : (MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_LOCALMFT | MFT_ENUM_FLAG_SORTANDFILTER);
  IMFActivate** activates = nullptr;
  UINT32 count = 0;
  const HRESULT hr = ::MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, flags, nullptr, &outputType, &activates, &count);
  if (FAILED(hr)) {
    report.errors.push_back("MFTEnumEx(" + hwprobe::fourccText(subtypeFourcc) + (hardware ? ", hw" : ", sw") +
                            ") failed " + win::hresultText(hr));
    return;
  }
  for (UINT32 i = 0; i < count; ++i) {
    IMFActivate* activate = activates[i];
    hwprobe::Encoder e;
    e.subtypeFourcc = subtypeFourcc;
    e.name = allocatedString(activate, MFT_FRIENDLY_NAME_Attribute).value_or("unknown");
    // Trust the attribute over the enumeration flag: hardware MFTs carry a URL.
    UINT32 urlLength = 0;
    e.hardware = hardware || SUCCEEDED(activate->GetStringLength(MFT_ENUM_HARDWARE_URL_Attribute, &urlLength));
    e.vendorId = allocatedString(activate, MFT_ENUM_HARDWARE_VENDOR_ID_Attribute);
    if (!(hardware == false && e.hardware)) report.encoders.push_back(std::move(e));  // avoid double-listing
    activate->Release();
  }
  ::CoTaskMemFree(activates);
}

std::string featureLevelText(D3D_FEATURE_LEVEL level) {
  const unsigned major = (static_cast<unsigned>(level) >> 12) & 0xF;
  const unsigned minor = (static_cast<unsigned>(level) >> 8) & 0xF;
  return std::to_string(major) + "_" + std::to_string(minor);
}

void enumerateAdapters(hwprobe::Report& report) {
  winrt::com_ptr<IDXGIFactory1> factory;
  const HRESULT hr = ::CreateDXGIFactory1(__uuidof(IDXGIFactory1), factory.put_void());
  if (FAILED(hr)) {
    report.errors.push_back("CreateDXGIFactory1 failed " + win::hresultText(hr));
    return;
  }
  static const D3D_FEATURE_LEVEL kLevels[] = {D3D_FEATURE_LEVEL_12_1, D3D_FEATURE_LEVEL_12_0, D3D_FEATURE_LEVEL_11_1,
                                              D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0};
  for (UINT index = 0;; ++index) {
    winrt::com_ptr<IDXGIAdapter1> adapter;
    if (factory->EnumAdapters1(index, adapter.put()) == DXGI_ERROR_NOT_FOUND) break;
    DXGI_ADAPTER_DESC1 desc{};
    if (FAILED(adapter->GetDesc1(&desc))) continue;
    hwprobe::Adapter a;
    a.name = win::toUtf8(desc.Description);
    a.vendorId = desc.VendorId;
    a.deviceId = desc.DeviceId;
    a.dedicatedVideoMemory = static_cast<std::uint64_t>(desc.DedicatedVideoMemory);
    a.software = (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0;
    D3D_FEATURE_LEVEL level{};
    HRESULT created = ::D3D11CreateDevice(adapter.get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, 0, kLevels,
                                          ARRAYSIZE(kLevels), D3D11_SDK_VERSION, nullptr, &level, nullptr);
    if (created == E_INVALIDARG) {  // runtime without 12_x / 11_1 in the list
      created = ::D3D11CreateDevice(adapter.get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, 0, kLevels + 3,
                                    ARRAYSIZE(kLevels) - 3, D3D11_SDK_VERSION, nullptr, &level, nullptr);
    }
    a.featureLevel = SUCCEEDED(created) ? featureLevelText(level) : std::string();
    report.adapters.push_back(std::move(a));
  }
}

std::string buildReport() {
  hwprobe::Report report;
  enumerateAdapters(report);
  for (const char* codec : {"H264", "HEVC", "AV01", "VP90"}) {
    enumerateEncoders(fourcc(codec), true, report);
    enumerateEncoders(fourcc(codec), false, report);
  }
  return hwprobe::toJson(report).dump();
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  win::initHelperProcess();
  const HRESULT hrCo = ::CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const HRESULT hrMf = ::MFStartup(MF_VERSION, MFSTARTUP_LITE);
  const bool stdioMode = argc > 1 && std::wcscmp(argv[1], L"--stdio") == 0;

  int exitCode = 0;
  {
    io::LineWriter out(win::stdoutSink());
    if (FAILED(hrMf)) {
      out.post(protocol::error(protocol::code::Internal, "Media Foundation is unavailable " + win::hresultText(hrMf), true));
      exitCode = 2;
    } else if (!stdioMode) {
      out.post(buildReport());
    } else {
      io::LineSplitter splitter(protocol::kMaxLineBytes);
      std::vector<std::string> lines;
      char buffer[4096];
      bool done = false;
      while (!done) {
        const int n = _read(_fileno(stdin), buffer, sizeof buffer);
        if (n <= 0) break;
        lines.clear();
        splitter.feed(std::string_view(buffer, static_cast<std::size_t>(n)), lines);
        for (const std::string& line : lines) {
          if (line.empty()) continue;
          const json::ParseResult raw = json::parse(line);
          const json::Value* type = raw.ok ? raw.value.find("t") : nullptr;
          if (type != nullptr && type->isString() && type->asString() == "probe") {
            out.post(buildReport());
            continue;
          }
          const protocol::ParsedCommand parsed = protocol::parseCommand(line, false);
          if (!parsed.ok) {
            out.post(protocol::error(parsed.error));
          } else if (parsed.command.type == protocol::CommandType::Ping) {
            out.post(protocol::pong({"encoders", "adapters"}, parsed.command.id));
          } else if (parsed.command.type == protocol::CommandType::Stop ||
                     parsed.command.type == protocol::CommandType::Discard) {
            done = true;
            break;
          } else {
            out.post(protocol::error(protocol::code::InvalidState, "hw-probe only supports ping, probe and stop", false,
                                     parsed.command.id));
          }
        }
      }
    }
    out.close();
  }

  if (SUCCEEDED(hrMf)) ::MFShutdown();
  if (SUCCEEDED(hrCo)) ::CoUninitialize();
  return exitCode;
}
