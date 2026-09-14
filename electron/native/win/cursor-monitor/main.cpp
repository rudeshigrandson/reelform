// reelform-cursor-monitor.exe (§5.4): cursor position at 120 Hz via GetCursorPos,
// clicks and key codes via low-level hooks, scroll via raw input (WM_INPUT).
// Hooks are installed only while recording; keys are virtual-key codes only (§13).
// Timestamps: QPC ns, same clock as the capture helper's firstFramePtsNs.
//
// Protocol (see common/include/reelform/cursor.hpp for event lines; matches the
// macOS cursor monitor's CursorEvent):
//   in:  ping | start | pause | resume | stop | discard   (start needs no payload)
//   out: ready (at launch) | pong | started | move | click | key | scroll | stopped | error
//
// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#include "../common/win_util.hpp"

// timeBeginPeriod/timeEndPeriod: WIN32_LEAN_AND_MEAN drops mmsystem.h from windows.h.
#include <mmsystem.h>

#include <algorithm>
#include <atomic>
#include <future>
#include <thread>

#include "reelform/cursor.hpp"
#include "reelform/line_io.hpp"
#include "reelform/protocol.hpp"
#include "reelform/session_state.hpp"
#include "reelform/timing.hpp"

namespace {

using namespace reelform;

constexpr UINT kMsgEnableHooks = WM_APP + 1;
constexpr UINT kMsgDisableHooks = WM_APP + 2;
constexpr std::int64_t kSamplePeriodNs = timing::kNsPerSec / 120;

io::LineWriter* g_out = nullptr;
const win::Qpc* g_qpc = nullptr;
std::atomic<bool> g_recording{false};
std::atomic<std::int64_t> g_samples{0};  // move lines since the last start
HHOOK g_mouseHook = nullptr;     // hook thread only
HHOOK g_keyboardHook = nullptr;  // hook thread only
cursor::KeyState g_keys;         // hook thread only

struct SystemCursors {
  HCURSOR arrow, ibeam, hand, sizeWE, sizeNS, sizeNESW, sizeNWSE, sizeAll, wait, appStarting, cross, no;
};
SystemCursors g_cursors{};

void loadSystemCursors() {
  const auto load = [](LPCWSTR id) { return ::LoadCursorW(nullptr, id); };
  g_cursors = {load(IDC_ARROW),    load(IDC_IBEAM),  load(IDC_HAND),     load(IDC_SIZEWE),
               load(IDC_SIZENS),   load(IDC_SIZENESW), load(IDC_SIZENWSE), load(IDC_SIZEALL),
               load(IDC_WAIT),     load(IDC_APPSTARTING), load(IDC_CROSS), load(IDC_NO)};
}

cursor::CursorType classify(const CURSORINFO& info) {
  using cursor::CursorType;
  if ((info.flags & CURSOR_SHOWING) == 0) return CursorType::Hidden;
  const HCURSOR h = info.hCursor;
  if (h == g_cursors.arrow) return CursorType::Arrow;
  if (h == g_cursors.ibeam) return CursorType::IBeam;
  if (h == g_cursors.hand) return CursorType::Hand;
  if (h == g_cursors.sizeWE) return CursorType::ResizeEW;
  if (h == g_cursors.sizeNS) return CursorType::ResizeNS;
  if (h == g_cursors.sizeNESW) return CursorType::ResizeNESW;
  if (h == g_cursors.sizeNWSE) return CursorType::ResizeNWSE;
  if (h == g_cursors.sizeAll) return CursorType::Move;
  if (h == g_cursors.wait || h == g_cursors.appStarting) return CursorType::Wait;
  if (h == g_cursors.cross) return CursorType::Crosshair;
  if (h == g_cursors.no) return CursorType::NotAllowed;
  return CursorType::Other;
}

// Hook procedures must return quickly (LowLevelHooksTimeout): they only format
// a line and enqueue it; LineWriter's thread does the I/O.
LRESULT CALLBACK mouseProc(int code, WPARAM wParam, LPARAM lParam) {
  if (code == HC_ACTION && g_recording.load(std::memory_order_relaxed)) {
    const auto* m = reinterpret_cast<const MSLLHOOKSTRUCT*>(lParam);
    std::optional<cursor::MouseButton> button;
    bool down = false;
    switch (wParam) {
      case WM_LBUTTONDOWN: button = cursor::MouseButton::Left; down = true; break;
      case WM_LBUTTONUP: button = cursor::MouseButton::Left; break;
      case WM_RBUTTONDOWN: button = cursor::MouseButton::Right; down = true; break;
      case WM_RBUTTONUP: button = cursor::MouseButton::Right; break;
      case WM_MBUTTONDOWN: button = cursor::MouseButton::Middle; down = true; break;
      case WM_MBUTTONUP: button = cursor::MouseButton::Middle; break;
      default: break;  // X buttons have no telemetry field; moves and wheel handled elsewhere
    }
    if (button.has_value()) {
      g_out->post(cursor::clickLine(g_qpc->nowNs(), m->pt.x, m->pt.y, *button, down));
    }
  }
  return ::CallNextHookEx(nullptr, code, wParam, lParam);
}

LRESULT CALLBACK keyboardProc(int code, WPARAM wParam, LPARAM lParam) {
  if (code == HC_ACTION && g_recording.load(std::memory_order_relaxed)) {
    const auto* k = reinterpret_cast<const KBDLLHOOKSTRUCT*>(lParam);
    if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) {
      if (g_keys.down(k->vkCode)) g_out->post(cursor::keyLine(g_qpc->nowNs(), k->vkCode, g_keys.modifiers()));
    } else if (wParam == WM_KEYUP || wParam == WM_SYSKEYUP) {
      g_keys.up(k->vkCode);
    }
  }
  return ::CallNextHookEx(nullptr, code, wParam, lParam);
}

void removeHooks() {
  if (g_mouseHook != nullptr) ::UnhookWindowsHookEx(g_mouseHook);
  if (g_keyboardHook != nullptr) ::UnhookWindowsHookEx(g_keyboardHook);
  g_mouseHook = nullptr;
  g_keyboardHook = nullptr;
  g_keys.clear();
}

LRESULT CALLBACK windowProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  switch (msg) {
    case kMsgEnableHooks: {
      const HINSTANCE module = ::GetModuleHandleW(nullptr);
      if (g_mouseHook == nullptr) g_mouseHook = ::SetWindowsHookExW(WH_MOUSE_LL, mouseProc, module, 0);
      if (g_keyboardHook == nullptr) g_keyboardHook = ::SetWindowsHookExW(WH_KEYBOARD_LL, keyboardProc, module, 0);
      if (g_mouseHook == nullptr || g_keyboardHook == nullptr) {
        g_out->post(protocol::error(protocol::code::Internal,
                                    "SetWindowsHookEx failed " + win::hresultText(HRESULT_FROM_WIN32(::GetLastError())),
                                    false));
      }
      return 0;
    }
    case kMsgDisableHooks:
      removeHooks();
      return 0;
    case WM_INPUT: {
      if (g_recording.load(std::memory_order_relaxed)) {
        RAWINPUT raw{};
        UINT size = sizeof(raw);
        if (::GetRawInputData(reinterpret_cast<HRAWINPUT>(lParam), RID_INPUT, &raw, &size, sizeof(RAWINPUTHEADER)) !=
                static_cast<UINT>(-1) &&
            raw.header.dwType == RIM_TYPEMOUSE) {
          const USHORT flags = raw.data.mouse.usButtonFlags;
          const auto delta = static_cast<std::int32_t>(static_cast<short>(raw.data.mouse.usButtonData));
          if ((flags & RI_MOUSE_WHEEL) != 0) g_out->post(cursor::scrollLine(g_qpc->nowNs(), 0, delta));
          if ((flags & RI_MOUSE_HWHEEL) != 0) g_out->post(cursor::scrollLine(g_qpc->nowNs(), delta, 0));
        }
      }
      return ::DefWindowProcW(hwnd, msg, wParam, lParam);  // required cleanup for RIM_INPUT
    }
    case WM_CLOSE:
      removeHooks();
      ::DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY:
      ::PostQuitMessage(0);
      return 0;
    default:
      return ::DefWindowProcW(hwnd, msg, wParam, lParam);
  }
}

/// Owns the message-only window, raw input registration and the LL hooks
/// (hook callbacks run on the installing thread's message loop).
void hookThread(std::promise<HWND>* ready) {
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = windowProc;
  wc.hInstance = ::GetModuleHandleW(nullptr);
  wc.lpszClassName = L"ReelformCursorMonitor";
  ::RegisterClassExW(&wc);
  const HWND hwnd = ::CreateWindowExW(0, wc.lpszClassName, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, wc.hInstance, nullptr);
  if (hwnd != nullptr) {
    RAWINPUTDEVICE device{};
    device.usUsagePage = 0x01;  // generic desktop
    device.usUsage = 0x02;      // mouse
    device.dwFlags = RIDEV_INPUTSINK;
    device.hwndTarget = hwnd;
    ::RegisterRawInputDevices(&device, 1, sizeof(device));
  }
  ready->set_value(hwnd);
  if (hwnd == nullptr) return;
  MSG msg;
  while (::GetMessageW(&msg, nullptr, 0, 0) > 0) ::DispatchMessageW(&msg);
}

/// 120 Hz position sampler on a drift-free schedule (TickSchedule).
void samplerThread(HANDLE stopEvent) {
  HANDLE timer = ::CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  bool coarseTimer = false;
  if (timer == nullptr) {  // < Windows 10 1803
    timer = ::CreateWaitableTimerExW(nullptr, nullptr, 0, TIMER_ALL_ACCESS);
    ::timeBeginPeriod(1);
    coarseTimer = true;
  }
  if (timer == nullptr) return;

  const timing::TickSchedule schedule{g_qpc->nowNs(), kSamplePeriodNs};
  const HANDLE handles[2] = {stopEvent, timer};
  std::int64_t target = schedule.nextTickNs(g_qpc->nowNs());
  for (;;) {
    const std::int64_t now = g_qpc->nowNs();
    if (now < target) {
      LARGE_INTEGER due{};
      due.QuadPart = -std::max<std::int64_t>(1, (target - now) / timing::kNsPerHns);  // relative, 100 ns
      ::SetWaitableTimer(timer, &due, 0, nullptr, nullptr, FALSE);
      if (::WaitForMultipleObjects(2, handles, FALSE, INFINITE) == WAIT_OBJECT_0) break;
      continue;  // re-check: woke early or on time
    }
    target = schedule.nextTickNs(now);
    if (!g_recording.load(std::memory_order_relaxed)) continue;
    POINT pt{};
    if (!::GetCursorPos(&pt)) continue;  // e.g. secure desktop
    CURSORINFO info{};
    info.cbSize = sizeof(info);
    const cursor::CursorType type = ::GetCursorInfo(&info) ? classify(info) : cursor::CursorType::Other;
    if (g_out->post(cursor::moveLine(g_qpc->nowNs(), pt.x, pt.y, type))) ++g_samples;
  }
  if (coarseTimer) ::timeEndPeriod(1);
  ::CloseHandle(timer);
}

}  // namespace

int wmain() {
  win::initHelperProcess();
  static const win::Qpc qpc;
  g_qpc = &qpc;
  // Intentionally leaked: hook/sampler threads may still post while the process exits.
  g_out = new io::LineWriter(win::stdoutSink());
  loadSystemCursors();

  std::promise<HWND> ready;
  std::future<HWND> readyFuture = ready.get_future();
  std::thread hooks([&ready] { hookThread(&ready); });
  const HWND hwnd = readyFuture.get();
  if (hwnd == nullptr) {
    g_out->post(protocol::error(protocol::code::Internal, "could not create message window", true));
    g_out->flush();
    hooks.join();
    return 2;
  }
  const HANDLE stopEvent = ::CreateEventW(nullptr, TRUE, FALSE, nullptr);
  std::thread sampler([stopEvent] { samplerThread(stopEvent); });
  g_out->post(protocol::ready());  // process is up (as on macOS)

  static const std::vector<std::string> kCaps = {"position", "clicks", "keys", "scroll", "cursorType"};
  const auto setRecording = [hwnd](bool on) {
    g_recording = on;
    ::PostMessageW(hwnd, on ? kMsgEnableHooks : kMsgDisableHooks, 0, 0);
  };

  session::State state = session::State::Idle;
  io::LineSplitter splitter(protocol::kMaxLineBytes);
  std::vector<std::string> lines;
  char buffer[4096];
  bool done = false;
  while (!done) {
    const int n = _read(_fileno(stdin), buffer, sizeof buffer);
    if (n <= 0) break;  // parent went away
    lines.clear();
    splitter.feed(std::string_view(buffer, static_cast<std::size_t>(n)), lines);
    for (const std::string& line : lines) {
      if (line.empty()) continue;
      const protocol::ParsedCommand parsed = protocol::parseCommand(line, /*requireStartOptions=*/false);
      if (!parsed.ok) {
        g_out->post(protocol::error(parsed.error));
        continue;
      }
      const protocol::Command& cmd = parsed.command;
      const session::Transition t = session::onCommand(state, cmd.type);
      if (!t.ok) {
        g_out->post(protocol::error(protocol::code::InvalidState,
                                    std::string(protocol::commandName(cmd.type)) + " is not allowed while " +
                                        session::stateName(state),
                                    false, cmd.id));
        continue;
      }
      switch (cmd.type) {
        case protocol::CommandType::Ping:
          g_out->post(protocol::pong(kCaps, cmd.id));
          break;
        case protocol::CommandType::Start:
          g_samples = 0;
          setRecording(true);
          state = session::onEvent(t.next, session::Event::FirstFrame).next;  // live immediately
          g_out->post(cursor::startedLine(cmd.id, g_qpc->nowNs(), /*keys=*/true));
          break;
        case protocol::CommandType::Pause:
          setRecording(false);
          state = t.next;
          break;
        case protocol::CommandType::Resume:
          setRecording(true);
          state = t.next;
          break;
        case protocol::CommandType::Stop:
        case protocol::CommandType::Discard:
          setRecording(false);
          g_out->post(cursor::stoppedLine(cmd.id, g_samples.load()));
          state = session::State::Stopped;
          done = true;
          break;
      }
      if (done) break;
    }
  }

  g_recording = false;
  ::SetEvent(stopEvent);
  sampler.join();
  ::PostMessageW(hwnd, WM_CLOSE, 0, 0);
  hooks.join();
  ::CloseHandle(stopEvent);
  g_out->flush();
  return 0;
}
