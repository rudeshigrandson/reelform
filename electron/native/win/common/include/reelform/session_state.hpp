// Recording session state machine for the capture helpers.
//
//   Idle --start--> Starting --firstFrame--> Recording <--pause/resume--> Paused
//   Starting|Recording|Paused --stop|discard--> Stopping --finished--> Stopped
//   Starting --startFailed--> Idle   (main may retry with another start)
//
// `ping` is valid in every state and never transitions.
#pragma once

#include "protocol.hpp"

namespace reelform::session {

enum class State { Idle, Starting, Recording, Paused, Stopping, Stopped };

inline const char* stateName(State s) {
  switch (s) {
    case State::Idle: return "idle";
    case State::Starting: return "starting";
    case State::Recording: return "recording";
    case State::Paused: return "paused";
    case State::Stopping: return "stopping";
    case State::Stopped: return "stopped";
  }
  return "unknown";
}

struct Transition {
  bool ok = false;
  State next = State::Idle;
};

/// Command-driven transitions. On `ok == false` the state is unchanged and the
/// helper answers `error{code:"invalidState"}`.
inline Transition onCommand(State s, protocol::CommandType c) {
  using protocol::CommandType;
  switch (c) {
    case CommandType::Ping: return {true, s};
    case CommandType::Start:
      return s == State::Idle ? Transition{true, State::Starting} : Transition{false, s};
    case CommandType::Pause:
      // Pausing before the first frame is allowed: nothing is written until resume.
      return (s == State::Recording || s == State::Starting) ? Transition{true, State::Paused}
                                                              : Transition{false, s};
    case CommandType::Resume:
      return s == State::Paused ? Transition{true, State::Recording} : Transition{false, s};
    case CommandType::Stop:
    case CommandType::Discard:
      return (s == State::Starting || s == State::Recording || s == State::Paused)
                 ? Transition{true, State::Stopping}
                 : Transition{false, s};
  }
  return {false, s};
}

enum class Event { FirstFrame, StartFailed, Interrupted, Finished };

/// Pipeline-driven transitions.
inline Transition onEvent(State s, Event e) {
  switch (e) {
    case Event::FirstFrame:
      // A frame can only anchor while actively recording (Starting); frames
      // while Paused are dropped by the clock.
      return s == State::Starting ? Transition{true, State::Recording} : Transition{false, s};
    case Event::StartFailed:
      return s == State::Starting ? Transition{true, State::Idle} : Transition{false, s};
    case Event::Interrupted:
      return (s == State::Starting || s == State::Recording || s == State::Paused)
                 ? Transition{true, State::Stopping}
                 : Transition{false, s};
    case Event::Finished:
      return s == State::Stopping ? Transition{true, State::Stopped} : Transition{false, s};
  }
  return {false, s};
}

}  // namespace reelform::session
