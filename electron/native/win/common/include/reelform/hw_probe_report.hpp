// JSON report produced by reelform-hw-probe.exe (ENGINEERING_SPEC §5.4, §3 export:probeEncoders).
// Parsed on the TypeScript side by electron/native/win/probe.ts — keep in sync.
//
// {
//   "t": "report", "version": "1.0.0",
//   "adapters": [{ "name", "vendorId", "deviceId", "dedicatedVideoMemory", "software", "featureLevel" }],
//   "encoders": [{ "codec": "h264"|"hevc"|"av1"|"vp9"|"other", "subtype": "H264",
//                  "name", "hardware", "vendorId"?: "VEN_10DE" }],
//   "errors": ["..."]
// }
#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "json.hpp"
#include "protocol.hpp"

namespace reelform::hwprobe {

/// Media Foundation video subtypes are FOURCC-based GUIDs
/// ({FOURCC-0000-0010-8000-00AA00389B71}); Data1 is the little-endian FOURCC.
inline std::string fourccText(std::uint32_t data1) {
  std::string s;
  for (int i = 0; i < 4; ++i) {
    const auto c = static_cast<char>((data1 >> (8 * i)) & 0xFF);
    s.push_back((c >= 0x20 && c < 0x7F) ? c : '?');
  }
  return s;
}

inline const char* codecForFourcc(std::uint32_t data1) {
  const std::string f = fourccText(data1);
  if (f == "H264" || f == "h264" || f == "AVC1" || f == "avc1") return "h264";
  if (f == "HEVC" || f == "hevc" || f == "H265" || f == "hvc1") return "hevc";
  if (f == "AV01" || f == "av01") return "av1";
  if (f == "VP90" || f == "vp90") return "vp9";
  return "other";
}

struct Adapter {
  std::string name;
  std::uint32_t vendorId = 0;
  std::uint32_t deviceId = 0;
  std::uint64_t dedicatedVideoMemory = 0;
  bool software = false;
  std::string featureLevel;  // "11_0", "12_1", or "" if device creation failed
};

struct Encoder {
  std::uint32_t subtypeFourcc = 0;
  std::string name;
  bool hardware = false;
  std::optional<std::string> vendorId;
};

struct Report {
  std::vector<Adapter> adapters;
  std::vector<Encoder> encoders;
  std::vector<std::string> errors;
};

inline json::Value toJson(const Report& r) {
  json::Value v = json::Value::object();
  v.set("t", "report").set("version", protocol::kProtocolVersion);
  json::Value adapters = json::Value::array();
  for (const Adapter& a : r.adapters) {
    json::Value ja = json::Value::object();
    ja.set("name", a.name).set("vendorId", a.vendorId).set("deviceId", a.deviceId);
    ja.set("dedicatedVideoMemory", a.dedicatedVideoMemory).set("software", a.software);
    ja.set("featureLevel", a.featureLevel);
    adapters.push(std::move(ja));
  }
  v.set("adapters", std::move(adapters));
  json::Value encoders = json::Value::array();
  for (const Encoder& e : r.encoders) {
    json::Value je = json::Value::object();
    je.set("codec", codecForFourcc(e.subtypeFourcc)).set("subtype", fourccText(e.subtypeFourcc));
    je.set("name", e.name).set("hardware", e.hardware);
    if (e.vendorId.has_value()) je.set("vendorId", *e.vendorId);
    encoders.push(std::move(je));
  }
  v.set("encoders", std::move(encoders));
  json::Value errors = json::Value::array();
  for (const auto& e : r.errors) errors.push(e);
  v.set("errors", std::move(errors));
  return v;
}

/// Deterministic sample report (an NVIDIA + Intel laptop), used by the C++
/// tests and emitted as the TypeScript parser's fixture
/// (`reelform-native-tests --emit-probe-fixture`).
inline Report sampleReport() {
  auto fourcc = [](const char* s) {
    return static_cast<std::uint32_t>(static_cast<unsigned char>(s[0])) |
           (static_cast<std::uint32_t>(static_cast<unsigned char>(s[1])) << 8) |
           (static_cast<std::uint32_t>(static_cast<unsigned char>(s[2])) << 16) |
           (static_cast<std::uint32_t>(static_cast<unsigned char>(s[3])) << 24);
  };
  Report r;
  r.adapters.push_back({"NVIDIA GeForce RTX 4070 Laptop GPU", 0x10DE, 0x2820, 8585740288ULL, false, "12_1"});
  r.adapters.push_back({"Intel(R) UHD Graphics", 0x8086, 0xA788, 134217728ULL, false, "12_1"});
  r.adapters.push_back({"Microsoft Basic Render Driver", 0x1414, 0x008C, 0, true, "12_1"});
  r.encoders.push_back({fourcc("H264"), "NVIDIA H.264 Encoder MFT", true, std::string("VEN_10DE")});
  r.encoders.push_back({fourcc("HEVC"), "NVIDIA HEVC Encoder MFT", true, std::string("VEN_10DE")});
  r.encoders.push_back({fourcc("AV01"), "NVIDIA AV1 Encoder MFT", true, std::string("VEN_10DE")});
  r.encoders.push_back({fourcc("H264"), "Intel\xC2\xAE Quick Sync Video H.264 Encoder MFT", true,
                        std::string("VEN_8086")});
  r.encoders.push_back({fourcc("H264"), "H264 Encoder MFT", false, std::nullopt});
  r.encoders.push_back({fourcc("HEVC"), "HEVCVideoExtensionEncoder", false, std::nullopt});
  r.encoders.push_back({fourcc("MP43"), "WMVideo8 Encoder MFT", false, std::nullopt});
  return r;
}

}  // namespace reelform::hwprobe
