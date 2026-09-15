// Small Windows-only utilities shared by the helper executables.
// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>

#include <fcntl.h>
#include <io.h>

#include <cstdint>
#include <cstdio>
#include <iostream>
#include <string>
#include <string_view>

#include "reelform/line_io.hpp"
#include "reelform/timing.hpp"

namespace reelform::win {

inline std::string toUtf8(std::wstring_view w) {
  if (w.empty()) return {};
  const int n = ::WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), nullptr, 0,
                                      nullptr, nullptr);
  std::string out(static_cast<std::size_t>(n > 0 ? n : 0), '\0');
  if (n > 0) {
    ::WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), out.data(), n, nullptr,
                          nullptr);
  }
  return out;
}

inline std::wstring toWide(std::string_view s) {
  if (s.empty()) return {};
  const int n =
      ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
  std::wstring out(static_cast<std::size_t>(n > 0 ? n : 0), L'\0');
  if (n > 0) ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), out.data(), n);
  return out;
}

inline std::string hresultText(HRESULT hr) {
  char buf[16];
  std::snprintf(buf, sizeof buf, "0x%08lX", static_cast<unsigned long>(hr));
  return buf;
}

class Qpc {
 public:
  Qpc() { ::QueryPerformanceFrequency(&freq_); }
  std::int64_t frequency() const { return freq_.QuadPart; }
  std::int64_t nowTicks() const {
    LARGE_INTEGER t;
    ::QueryPerformanceCounter(&t);
    return t.QuadPart;
  }
  std::int64_t nowNs() const { return timing::qpcTicksToNs(nowTicks(), freq_.QuadPart); }
  std::int64_t ticksFromNs(std::int64_t ns) const {
    // inverse of qpcTicksToNs for meta.startQpc
    return (ns / timing::kNsPerSec) * freq_.QuadPart +
           ((ns % timing::kNsPerSec) * freq_.QuadPart) / timing::kNsPerSec;
  }

 private:
  LARGE_INTEGER freq_{};
};

/// Binary stdio (no CRLF translation) + PerMonitorV2 DPI awareness (manifest also sets it).
inline void initHelperProcess() {
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stdin), _O_BINARY);
  ::SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  // Never show Windows Error Reporting / critical-error dialogs from a background helper.
  ::SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);
}

inline io::LineWriter::Sink stdoutSink() {
  return [](const std::string& line) {
    std::fwrite(line.data(), 1, line.size(), stdout);
    std::fflush(stdout);
  };
}

}  // namespace reelform::win
