// Microphone endpoint selection for reelform-wgc / reelform-dxgi (§5.4).
//
// Main does not know WASAPI endpoint ids: the renderer picks a mic through
// getUserMedia, whose deviceIds are per-origin hashes. The start message can
// therefore carry, in order of preference:
//   audio.micEndpointId  exact IMMDevice::GetId (e.g. from a future helper listing)
//   audio.mic            an endpoint id, "default", or an unusable Chromium hash
//   audio.micLabel       MediaDeviceInfo.label — Chromium uses the endpoint friendly
//                        name (PKEY_Device_FriendlyName), sometimes prefixed with
//                        "Default - " or "Communications - "
// Pure and portable so the matching rules are unit tested off Windows.
#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "protocol.hpp"

namespace reelform::audio {

struct EndpointDesc {
  std::string id;            // IMMDevice::GetId, UTF-8
  std::string friendlyName;  // PKEY_Device_FriendlyName, UTF-8
  bool isDefault = false;    // default eCapture/eConsole endpoint
};

enum class MicMatch {
  EndpointId,     // audio.micEndpointId matched
  Id,             // audio.mic matched an endpoint id
  LabelExact,     // label equals a friendly name (case-insensitive, prefixes stripped)
  LabelContains,  // one friendly name contains the label or vice versa
  Default,        // default device (requested explicitly, or nothing matched)
  None            // no endpoints / no default flagged: caller asks the OS for the default
};

struct MicResolution {
  std::optional<std::size_t> index;
  MicMatch match = MicMatch::None;
  // A specific device was requested but not found (reported as a non-fatal micUnavailable).
  bool fellBack = false;
};

namespace detail {

inline std::string lowerAscii(std::string_view s) {
  std::string out(s);
  for (char& c : out) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return out;
}

inline std::string trimmed(std::string_view s) {
  std::size_t b = 0;
  std::size_t e = s.size();
  while (b < e && (s[b] == ' ' || s[b] == '\t')) ++b;
  while (e > b && (s[e - 1] == ' ' || s[e - 1] == '\t')) --e;
  return std::string(s.substr(b, e - b));
}

/// Lower-cased label without Chromium's "Default - " / "Communications - " prefix.
inline std::string normalizeLabel(std::string_view label) {
  std::string l = lowerAscii(trimmed(label));
  for (std::string_view prefix : {std::string_view("default - "), std::string_view("communications - ")}) {
    if (l.size() > prefix.size() && l.compare(0, prefix.size(), prefix) == 0) {
      l = trimmed(std::string_view(l).substr(prefix.size()));
      break;
    }
  }
  return l;
}

inline bool isDefaultToken(const std::optional<std::string>& v) {
  return !v.has_value() || v->empty() || *v == "default";
}

}  // namespace detail

inline MicResolution resolveMicEndpoint(const std::vector<EndpointDesc>& endpoints,
                                        const protocol::AudioOptions& audio) {
  MicResolution r;
  const auto byId = [&](const std::string& id) -> std::optional<std::size_t> {
    for (std::size_t i = 0; i < endpoints.size(); ++i) {
      if (endpoints[i].id == id) return i;
    }
    return std::nullopt;
  };

  if (audio.micEndpointId && !audio.micEndpointId->empty()) {
    if (auto i = byId(*audio.micEndpointId)) return {i, MicMatch::EndpointId, false};
  }
  if (!detail::isDefaultToken(audio.mic)) {
    if (auto i = byId(*audio.mic)) return {i, MicMatch::Id, false};
  }
  if (audio.micLabel && !detail::trimmed(*audio.micLabel).empty()) {
    const std::string want = detail::normalizeLabel(*audio.micLabel);
    for (std::size_t i = 0; i < endpoints.size(); ++i) {
      if (detail::normalizeLabel(endpoints[i].friendlyName) == want) return {i, MicMatch::LabelExact, false};
    }
    std::optional<std::size_t> hit;
    int hits = 0;
    for (std::size_t i = 0; i < endpoints.size(); ++i) {
      const std::string have = detail::normalizeLabel(endpoints[i].friendlyName);
      if (have.empty()) continue;
      if (have.find(want) != std::string::npos || want.find(have) != std::string::npos) {
        hit = i;
        ++hits;
      }
    }
    if (hits == 1) return {hit, MicMatch::LabelContains, false};
  }

  // Nothing specific matched (or the default was asked for).
  const bool requestedSpecific = (audio.micEndpointId && !audio.micEndpointId->empty()) ||
                                 !detail::isDefaultToken(audio.mic) ||
                                 (audio.micLabel && !detail::trimmed(*audio.micLabel).empty() &&
                                  detail::normalizeLabel(*audio.micLabel) != "default");
  r.fellBack = requestedSpecific;
  for (std::size_t i = 0; i < endpoints.size(); ++i) {
    if (endpoints[i].isDefault) {
      r.index = i;
      r.match = MicMatch::Default;
      return r;
    }
  }
  r.match = MicMatch::None;
  return r;
}

}  // namespace reelform::audio
