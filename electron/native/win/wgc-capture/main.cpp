// reelform-wgc.exe / reelform-dxgi.exe entry point: stdio protocol loop (§5.5).
// All protocol state changes happen on this thread; capture/audio threads only
// post PipelineEvents into the queue.
// UNVERIFIED: written without a Windows toolchain; not compiled on the authoring machine.
#include <unknwn.h>

#include "../common/win_util.hpp"

#include <mfapi.h>

#include <chrono>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <optional>
#include <thread>

#include <winrt/base.h>

#include "recorder.hpp"
#include "reelform/line_io.hpp"
#include "reelform/protocol.hpp"
#include "reelform/session_state.hpp"

namespace {

using namespace reelform;
using Clock = std::chrono::steady_clock;

struct QueueItem {
  enum class Kind { Line, Eof, Event } kind = Kind::Line;
  std::string line;
  wgc::PipelineEvent event;
};

class Queue {
 public:
  void push(QueueItem item) {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      items_.push_back(std::move(item));
    }
    cv_.notify_one();
  }
  std::optional<QueueItem> popUntil(Clock::time_point deadline) {
    std::unique_lock<std::mutex> lock(mutex_);
    if (!cv_.wait_until(lock, deadline, [this] { return !items_.empty(); })) return std::nullopt;
    QueueItem item = std::move(items_.front());
    items_.pop_front();
    return item;
  }

 private:
  std::mutex mutex_;
  std::condition_variable cv_;
  std::deque<QueueItem> items_;
};

}  // namespace

int wmain() {
  win::initHelperProcess();
  winrt::init_apartment(winrt::apartment_type::multi_threaded);

  io::LineWriter out(win::stdoutSink());
  if (FAILED(::MFStartup(MF_VERSION, MFSTARTUP_FULL))) {
    out.post(protocol::error(protocol::code::Internal, "Media Foundation is unavailable (N/KN edition?)", true));
    out.close();
    return 2;
  }
  out.post(protocol::ready());  // process is up and accepting commands (as on macOS)

  // Intentionally leaked: the detached stdin reader may still reference it while the process exits.
  auto* queue = new Queue();
  std::thread([queue] {
    io::LineSplitter splitter(protocol::kMaxLineBytes);
    std::vector<std::string> lines;
    char buffer[4096];
    for (;;) {
      const int n = _read(_fileno(stdin), buffer, sizeof buffer);
      if (n <= 0) break;
      lines.clear();
      splitter.feed(std::string_view(buffer, static_cast<std::size_t>(n)), lines);
      for (auto& line : lines) {
        if (!line.empty()) queue->push({QueueItem::Kind::Line, std::move(line), {}});
      }
    }
    queue->push({QueueItem::Kind::Eof, {}, {}});
  }).detach();

  wgc::Recorder recorder([queue](wgc::PipelineEvent e) { queue->push({QueueItem::Kind::Event, {}, std::move(e)}); });

  session::State state = session::State::Idle;
  bool startedEmitted = false;
  bool micLost = false;
  std::optional<std::int64_t> startId;
  auto nextStats = Clock::now() + std::chrono::seconds(1);

  const auto finish = [&](bool discard, const std::string& interruptReason, std::optional<std::int64_t> id) {
    wgc::StopResult r = recorder.stop(discard, interruptReason);
    for (const auto& warning : r.warnings) out.post(protocol::error(protocol::code::WriterFailed, warning, false, id));
    if (r.noFrames) {
      out.post(protocol::error(protocol::code::NoFrames, "stopped before the first frame was captured", false, id));
    }
    out.post(protocol::stopped(r.durationMs, r.paths, r.pausedRanges, discard, id));
    state = session::State::Stopped;
  };
  const auto interrupt = [&](const std::string& reason, const std::string& message) {
    if (!session::onEvent(state, session::Event::Interrupted).ok) return;
    out.post(protocol::interrupted(reason, message));
    finish(false, reason, std::nullopt);
  };

  while (state != session::State::Stopped) {
    std::optional<QueueItem> item = queue->popUntil(nextStats);

    if (Clock::now() >= nextStats) {
      nextStats = Clock::now() + std::chrono::seconds(1);
      if (state == session::State::Recording || state == session::State::Paused) {
        out.post(protocol::stats(recorder.stats()));
        if (recorder.diskLow()) {
          // §5.6 disk < 500 MB: stop cleanly and keep everything written.
          interrupt(protocol::reason::DiskLow, "less than 500 MB free on the recording volume");
          continue;
        }
      }
    }
    if (!item) continue;

    switch (item->kind) {
      case QueueItem::Kind::Eof:
        if (state == session::State::Idle) {
          state = session::State::Stopped;
        } else {
          interrupt(protocol::reason::ParentGone, "stdin closed");
        }
        break;

      case QueueItem::Kind::Event: {
        const wgc::PipelineEvent& e = item->event;
        switch (e.type) {
          case wgc::PipelineEventType::FirstFrame:
            if (!startedEmitted) {
              startedEmitted = true;
              out.post(protocol::started(recorder.startedInfo(e.hostNs), startId));
            }
            if (const auto t = session::onEvent(state, session::Event::FirstFrame); t.ok) state = t.next;
            break;
          case wgc::PipelineEventType::SourceClosed:
            interrupt(e.reason.empty() ? protocol::reason::SourceLost : e.reason, e.message);
            break;
          case wgc::PipelineEventType::EncoderFailed:
            interrupt(protocol::reason::WriterFailed, e.message);
            break;
          case wgc::PipelineEventType::DeviceLost:
            // Microphone lost: keep recording video + system audio (as on macOS).
            if (!micLost) {
              micLost = true;
              out.post(protocol::deviceLost(e.reason.empty() ? "default" : e.reason, e.message));
            }
            break;
          case wgc::PipelineEventType::AudioWarning:
            out.post(protocol::error(e.reason.empty() ? protocol::code::StreamFailed : e.reason, e.message, false));
            break;
        }
        break;
      }

      case QueueItem::Kind::Line: {
        const protocol::ParsedCommand parsed = protocol::parseCommand(item->line);
        if (!parsed.ok) {
          out.post(protocol::error(parsed.error));
          break;
        }
        const protocol::Command& cmd = parsed.command;
        const session::Transition t = session::onCommand(state, cmd.type);
        if (!t.ok) {
          out.post(protocol::error(protocol::code::InvalidState,
                                   std::string(protocol::commandName(cmd.type)) + " is not allowed while " +
                                       session::stateName(state),
                                   false, cmd.id));
          break;
        }
        switch (cmd.type) {
          case protocol::CommandType::Ping:
            out.post(protocol::pong(wgc::captureCaps(), cmd.id));
            break;
          case protocol::CommandType::Start:
            state = t.next;
            startId = cmd.id;
            // Success: `ready{id}` now (main's reply to start), `started` on the first frame.
            if (auto err = recorder.start(cmd.start)) {
              out.post(protocol::error(err->code, err->message, false, cmd.id));
              state = session::onEvent(state, session::Event::StartFailed).next;
            } else {
              out.post(protocol::ready(cmd.id));
            }
            break;
          case protocol::CommandType::Pause:
            recorder.pause();
            state = t.next;
            out.post(protocol::paused(cmd.id));
            break;
          case protocol::CommandType::Resume:
            recorder.resume();
            state = t.next;
            out.post(protocol::resumed(cmd.id));
            break;
          case protocol::CommandType::Stop:
          case protocol::CommandType::Discard:
            state = t.next;
            finish(cmd.type == protocol::CommandType::Discard, std::string(), cmd.id);
            break;
        }
        break;
      }
    }
  }

  out.close();
  ::MFShutdown();
  return 0;
}
