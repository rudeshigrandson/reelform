// Line-oriented stdio plumbing shared by the helpers. No platform dependencies.
//
// LineWriter: producers (capture callbacks, low-level input hooks) must never
// block on a full stdout pipe — a WH_*_LL hook that takes longer than
// LowLevelHooksTimeout is silently removed by Windows. `post()` only appends to
// an in-memory queue; a dedicated thread drains it into the injected sink.
//
// LineSplitter: incremental '\n' framing for inbound bytes with a per-line cap.
#pragma once

#include <condition_variable>
#include <cstddef>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

namespace reelform::io {

class LineWriter {
 public:
  using Sink = std::function<void(const std::string& lineWithNewline)>;

  explicit LineWriter(Sink sink, std::size_t maxQueued = 100'000)
      : sink_(std::move(sink)), maxQueued_(maxQueued), thread_([this] { run(); }) {}

  LineWriter(const LineWriter&) = delete;
  LineWriter& operator=(const LineWriter&) = delete;

  ~LineWriter() { close(); }

  /// Enqueue one line ('\n' appended). Returns false when the queue is full
  /// (the line is dropped) or the writer is closed. Never blocks on I/O.
  bool post(std::string line) {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (closed_ || queue_.size() >= maxQueued_) {
        ++dropped_;
        return false;
      }
      line.push_back('\n');
      queue_.push_back(std::move(line));
    }
    cv_.notify_one();
    return true;
  }

  /// Block until everything posted so far has reached the sink.
  void flush() {
    std::unique_lock<std::mutex> lock(mutex_);
    idle_.wait(lock, [this] { return queue_.empty() && !writing_; });
  }

  /// Drain remaining lines and stop the writer thread. Idempotent.
  void close() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      closed_ = true;
    }
    cv_.notify_all();
    if (thread_.joinable()) thread_.join();
  }

  std::size_t dropped() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return dropped_;
  }

 private:
  void run() {
    std::unique_lock<std::mutex> lock(mutex_);
    for (;;) {
      cv_.wait(lock, [this] { return closed_ || !queue_.empty(); });
      if (queue_.empty() && closed_) break;
      std::deque<std::string> batch;
      batch.swap(queue_);
      writing_ = true;
      lock.unlock();
      for (const auto& l : batch) sink_(l);
      lock.lock();
      writing_ = false;
      if (queue_.empty()) idle_.notify_all();
    }
    idle_.notify_all();
  }

  Sink sink_;
  const std::size_t maxQueued_;
  mutable std::mutex mutex_;
  std::condition_variable cv_;
  std::condition_variable idle_;
  std::deque<std::string> queue_;
  bool closed_ = false;
  bool writing_ = false;
  std::size_t dropped_ = 0;
  std::thread thread_;  // declared last: starts after all members are initialized
};

class LineSplitter {
 public:
  explicit LineSplitter(std::size_t maxLine = 1U << 20) : maxLine_(maxLine) {}

  /// Feed bytes; complete lines (without '\n' / trailing '\r') are appended to `out`.
  /// Over-long lines are discarded up to their newline and reported as "" + overflow flag.
  void feed(std::string_view bytes, std::vector<std::string>& out) {
    for (char c : bytes) {
      if (c == '\n') {
        if (overflow_) {
          ++overflowCount_;
          overflow_ = false;
        } else {
          if (!buf_.empty() && buf_.back() == '\r') buf_.pop_back();
          out.push_back(std::move(buf_));
        }
        buf_.clear();
        continue;
      }
      if (overflow_) continue;
      if (buf_.size() >= maxLine_) {
        overflow_ = true;
        buf_.clear();
        continue;
      }
      buf_.push_back(c);
    }
  }

  /// Number of lines discarded for exceeding the cap.
  std::size_t overflowCount() const { return overflowCount_; }

 private:
  std::size_t maxLine_;
  std::string buf_;
  bool overflow_ = false;
  std::size_t overflowCount_ = 0;
};

}  // namespace reelform::io
