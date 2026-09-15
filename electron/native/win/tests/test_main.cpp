// Portable unit tests for the header-only helper core (no Windows deps, no
// test framework). Build via CMake target `reelform-native-tests`, or directly:
//   c++ -std=c++17 -Wall -Wextra -I common/include tests/test_main.cpp -o t && ./t
// `--emit-probe-fixture` prints the sample hw-probe report used by probe.test.ts
// (tests/fixtures/hw-probe-sample.txt).
#include <cstdio>
#include <cstring>
#include <functional>
#include <limits>
#include <string>
#include <vector>

#include "reelform/audio_devices.hpp"
#include "reelform/capture_math.hpp"
#include "reelform/cursor.hpp"
#include "reelform/hw_probe_report.hpp"
#include "reelform/json.hpp"
#include "reelform/line_io.hpp"
#include "reelform/meta.hpp"
#include "reelform/protocol.hpp"
#include "reelform/session_state.hpp"
#include "reelform/timing.hpp"

namespace {

int g_failures = 0;
int g_checks = 0;

struct TestCase {
  const char* name;
  std::function<void()> fn;
};

std::vector<TestCase>& registry() {
  static std::vector<TestCase> tests;
  return tests;
}

struct Registrar {
  Registrar(const char* name, std::function<void()> fn) { registry().push_back({name, std::move(fn)}); }
};

#define TEST(name)                                   \
  static void name();                                \
  static const Registrar name##_registrar(#name, name); \
  static void name()

#define CHECK(expr)                                                         \
  do {                                                                      \
    ++g_checks;                                                             \
    if (!(expr)) {                                                          \
      ++g_failures;                                                         \
      std::fprintf(stderr, "  FAIL %s:%d: %s\n", __FILE__, __LINE__, #expr); \
    }                                                                       \
  } while (0)

#define CHECK_EQ(a, b)                                                                   \
  do {                                                                                   \
    ++g_checks;                                                                          \
    if (!((a) == (b))) {                                                                 \
      ++g_failures;                                                                      \
      std::fprintf(stderr, "  FAIL %s:%d: %s == %s\n", __FILE__, __LINE__, #a, #b);      \
    }                                                                                    \
  } while (0)

using namespace reelform;

// ---------------------------------------------------------------- json

TEST(json_roundtrip_scalars) {
  CHECK_EQ(json::Value().dump(), "null");
  CHECK_EQ(json::Value(true).dump(), "true");
  CHECK_EQ(json::Value(42).dump(), "42");
  CHECK_EQ(json::Value(-7LL).dump(), "-7");
  CHECK_EQ(json::Value(1.5).dump(), "1.5");
  CHECK_EQ(json::Value(0.1).dump(), "0.1");
  CHECK_EQ(json::Value(std::numeric_limits<double>::infinity()).dump(), "null");
  CHECK_EQ(json::Value(std::nan("")).dump(), "null");
}

TEST(json_int64_exact) {
  const std::int64_t big = 9'007'199'254'740'993LL;  // 2^53 + 1, not representable as double
  json::Value v = json::Value::object();
  v.set("ns", big);
  const std::string text = v.dump();
  CHECK_EQ(text, "{\"ns\":9007199254740993}");
  const auto parsed = json::parse(text);
  CHECK(parsed.ok);
  CHECK(parsed.value.find("ns")->isInt());
  CHECK_EQ(parsed.value.find("ns")->asInt(), big);
  const auto mn = json::parse("-9223372036854775808");
  CHECK(mn.ok && mn.value.isInt() && mn.value.asInt() == std::numeric_limits<std::int64_t>::min());
  const auto over = json::parse("9223372036854775808");
  CHECK(over.ok && over.value.type() == json::Type::Double);
}

TEST(json_string_escaping) {
  const std::string raw = std::string("a\"b\\c\n\t\x01") + "\xC3\xA9";
  const std::string text = json::Value(raw).dump();
  CHECK_EQ(text, "\"a\\\"b\\\\c\\n\\t\\u0001\xC3\xA9\"");
  const auto back = json::parse(text);
  CHECK(back.ok && back.value.asString() == raw);
}

TEST(json_unicode_escapes) {
  auto p = json::parse("\"\\u00e9\\ud83d\\ude00\\u002F\"");
  CHECK(p.ok);
  CHECK_EQ(p.value.asString(), std::string("\xC3\xA9\xF0\x9F\x98\x80/"));
  auto lone = json::parse("\"\\ud83dx\"");
  CHECK(lone.ok && lone.value.asString() == std::string("\xEF\xBF\xBDx"));
  auto loneLow = json::parse("\"\\ude00\"");
  CHECK(loneLow.ok && loneLow.value.asString() == std::string("\xEF\xBF\xBD"));
}

TEST(json_rejects_malformed) {
  const char* bad[] = {"",       "{",        "{\"a\":}",   "[1,]",     "01",      "1.",
                       ".5",     "+1",       "tru",        "\"abc",    "{\"a\" 1}", "1 2",
                       "\"\x01\"", "\"\\x\"", "[1 2]",     "{a:1}",    "-",       "1e"};
  for (const char* b : bad) {
    const auto r = json::parse(b);
    if (r.ok) std::fprintf(stderr, "  unexpectedly parsed: %s\n", b);
    CHECK(!r.ok);
  }
  std::string deep(200, '[');
  CHECK(!json::parse(deep).ok);
}

TEST(json_object_order_and_duplicates) {
  const auto r = json::parse(" { \"b\" : 1 , \"a\" : [true, null, 2.5e1], \"b\": 3 } ");
  CHECK(r.ok);
  CHECK_EQ(r.value.dump(), "{\"b\":3,\"a\":[true,null,25]}");
}

// ---------------------------------------------------------------- protocol

TEST(protocol_parses_simple_commands) {
  auto p = protocol::parseCommand("{\"t\":\"ping\"}");
  CHECK(p.ok && p.command.type == protocol::CommandType::Ping && !p.command.id);
  p = protocol::parseCommand("{\"t\":\"pause\",\"id\":7}\r");
  CHECK(p.ok && p.command.type == protocol::CommandType::Pause && p.command.id == 7);
  p = protocol::parseCommand("{\"t\":\"resume\"}");
  CHECK(p.ok && p.command.type == protocol::CommandType::Resume);
  p = protocol::parseCommand("{\"t\":\"stop\"}");
  CHECK(p.ok && p.command.type == protocol::CommandType::Stop);
  p = protocol::parseCommand("{\"t\":\"discard\"}");
  CHECK(p.ok && p.command.type == protocol::CommandType::Discard);
}

TEST(protocol_errors) {
  auto p = protocol::parseCommand("not json");
  CHECK(!p.ok && p.error.code == "badRequest");
  p = protocol::parseCommand("[1]");
  CHECK(!p.ok && p.error.code == "badRequest");
  p = protocol::parseCommand("{\"id\":3}");
  CHECK(!p.ok && p.error.code == "badRequest" && p.error.id == 3);
  p = protocol::parseCommand("{\"t\":\"explode\",\"id\":4}");
  CHECK(!p.ok && p.error.code == "unknownCommand" && p.error.id == 4);
  CHECK_EQ(protocol::error(p.error),
           "{\"t\":\"error\",\"id\":4,\"code\":\"unknownCommand\",\"message\":\"unknown command \\\"explode\\\"\",\"fatal\":false}");
  // Non-integer ids are not echoed.
  p = protocol::parseCommand("{\"t\":\"explode\",\"id\":1.5}");
  CHECK(!p.ok && !p.error.id.has_value());
  p = protocol::parseCommand(std::string(protocol::kMaxLineBytes + 1, ' '));
  CHECK(!p.ok && p.error.code == "badRequest");
}

// Inbound lines copied verbatim from electron/native/mac/fixtures/protocol-golden.json:
// the Windows helper must accept the mac start shape.
TEST(protocol_accepts_mac_golden_inbound) {
  auto p = protocol::parseCommand(
      R"({"t":"start","id":2,"outputDir":"/tmp/rec","source":{"kind":"display","displayId":69734208,"excludePids":[123,456]},"region":{"x":10,"y":20.5,"width":800,"height":600},"fps":60,"audio":{"system":true,"mic":"BuiltInMicrophoneDevice"}})");
  CHECK(p.ok);
  CHECK(p.command.id == 2);
  CHECK(p.command.start.source.kind == protocol::SourceKind::Display);
  CHECK_EQ(p.command.start.source.id, std::string("69734208"));
  CHECK(p.command.start.region && p.command.start.region->y == 21 && p.command.start.region->width == 800);
  CHECK(p.command.start.audio.system && p.command.start.audio.mic == std::string("BuiltInMicrophoneDevice"));
  CHECK(p.command.start.hideCursor);
  p = protocol::parseCommand(
      R"({"t":"start","outputDir":"/r","source":{"kind":"window","windowId":99},"fps":30,"audio":{"system":false}})");
  CHECK(p.ok && p.command.start.source.kind == protocol::SourceKind::Window);
  CHECK_EQ(p.command.start.source.id, std::string("99"));
  CHECK(!p.command.start.audio.mic.has_value() && p.command.start.fps == 30);
  for (const char* line : {R"({"t":"ping","id":1})", R"({"t":"pause","id":3})", R"({"t":"resume","id":4})",
                           R"({"t":"stop","id":5})", R"({"t":"discard"})"}) {
    CHECK(protocol::parseCommand(line).ok);
  }
  // Absurd rect values are rejected instead of overflowing the int64 cast.
  p = protocol::parseCommand(
      R"({"t":"start","source":{"kind":"display"},"region":{"x":1e300,"y":0,"width":10,"height":10},"outputDir":"x"})");
  CHECK(!p.ok && p.error.code == "badRequest");
}

TEST(protocol_start_full) {
  const auto p = protocol::parseCommand(
      R"({"t":"start","id":1,"source":{"type":"display","id":"\\\\.\\DISPLAY2","bounds":{"x":-1920,"y":0,"width":1920,"height":1080}},)"
      R"("region":{"x":10.4,"y":20.6,"width":1280,"height":719.5},"fps":30,"audio":{"system":true,"mic":"{0.0.1.00000000}.{abc}"},)"
      R"("hideCursor":false,"outputDir":"C:\\Users\\me\\rec"})");
  CHECK(p.ok);
  const auto& o = p.command.start;
  CHECK(o.source.kind == protocol::SourceKind::Display);
  CHECK_EQ(o.source.id, std::string("\\\\.\\DISPLAY2"));
  CHECK(o.source.bounds && o.source.bounds->x == -1920 && o.source.bounds->width == 1920);
  CHECK(o.region && o.region->x == 10 && o.region->y == 21 && o.region->height == 720);
  CHECK_EQ(o.fps, 30);
  CHECK(o.audio.system);
  CHECK(o.audio.mic && *o.audio.mic == "{0.0.1.00000000}.{abc}");
  CHECK(!o.hideCursor);
  CHECK_EQ(o.outputDir, std::string("C:\\Users\\me\\rec"));
}

TEST(protocol_start_defaults_and_validation) {
  auto p = protocol::parseCommand(R"({"t":"start","source":{"type":"window","id":132456},"outputDir":"x"})");
  CHECK(p.ok);
  CHECK(p.command.start.source.kind == protocol::SourceKind::Window);
  CHECK_EQ(p.command.start.source.id, std::string("132456"));
  CHECK_EQ(p.command.start.fps, 60);
  CHECK(p.command.start.hideCursor);
  CHECK(!p.command.start.audio.system && !p.command.start.audio.mic);

  const char* bad[] = {
      R"({"t":"start","outputDir":"x"})",
      R"({"t":"start","source":{"type":"tab"},"outputDir":"x"})",
      R"({"t":"start","source":{"type":"window"},"outputDir":"x"})",
      R"({"t":"start","source":{"type":"display"},"fps":24,"outputDir":"x"})",
      R"({"t":"start","source":{"type":"display"}})",
      R"({"t":"start","source":{"type":"display"},"outputDir":""})",
      R"({"t":"start","source":{"type":"display"},"region":{"x":0,"y":0,"width":0,"height":10},"outputDir":"x"})",
      R"({"t":"start","source":{"type":"window","id":"5"},"region":{"x":0,"y":0,"width":10,"height":10},"outputDir":"x"})",
  };
  for (const char* b : bad) {
    const auto r = protocol::parseCommand(b);
    if (r.ok) std::fprintf(stderr, "  unexpectedly accepted: %s\n", b);
    CHECK(!r.ok && r.error.code == "badRequest");
  }
}

TEST(protocol_bare_start_for_cursor_monitor) {
  auto p = protocol::parseCommand("{\"t\":\"start\",\"id\":2}", false);
  CHECK(p.ok && p.command.type == protocol::CommandType::Start && p.command.id == 2);
  p = protocol::parseCommand("{\"t\":\"start\",\"id\":2}");
  CHECK(!p.ok && p.error.code == "badRequest");
  p = protocol::parseCommand("{\"t\":\"bogus\"}", false);
  CHECK(!p.ok && p.error.code == "unknownCommand");
}

TEST(protocol_outbound_lines) {
  CHECK_EQ(protocol::pong({"display", "window"}, 9),
           "{\"t\":\"pong\",\"id\":9,\"version\":\"1.0.0\",\"caps\":[\"display\",\"window\"]}");
  CHECK_EQ(protocol::ready(), "{\"t\":\"ready\"}");
  protocol::StartedInfo info{123456789012345LL, 123456700000000LL, 1920, 1080, 1.5};
  CHECK_EQ(protocol::started(info, 2),
           "{\"t\":\"started\",\"id\":2,\"firstFramePtsNs\":123456789012345,\"startHostTimeNs\":123456700000000,"
           "\"width\":1920,\"height\":1080,\"scaleFactor\":1.5}");
  info.scaleFactor = 0.0;  // unknown DPI never emits a non-positive scale
  CHECK(protocol::started(info).find("\"scaleFactor\":1") != std::string::npos);
  protocol::Stats s;
  s.fps = 59.5;
  s.droppedFrames = 2;
  s.fileBytes = 1024;
  CHECK_EQ(protocol::stats(s), "{\"t\":\"stats\",\"fps\":59.5,\"droppedFrames\":2,\"fileBytes\":1024}");
  s.micLevel = -12.25;
  CHECK(protocol::stats(s).find("\"micLevel\":-12.25") != std::string::npos);
  CHECK_EQ(protocol::interrupted(protocol::reason::ParentGone, "stdin closed"),
           "{\"t\":\"interrupted\",\"reason\":\"parentGone\",\"message\":\"stdin closed\"}");
  CHECK_EQ(protocol::interrupted(protocol::reason::SourceLost, ""),
           "{\"t\":\"interrupted\",\"reason\":\"sourceLost\",\"message\":\"\"}");
  protocol::StoppedPaths paths;
  paths.screen = "C:\\r\\screen.mp4";
  paths.meta = "C:\\r\\meta.json";
  CHECK_EQ(protocol::stopped(3000, paths, {{1000, 3000}}, false, 5),
           "{\"t\":\"stopped\",\"id\":5,\"durationMs\":3000,\"paths\":{\"screen\":\"C:\\\\r\\\\screen.mp4\",\"meta\":\"C:\\\\r\\\\meta.json\"},"
           "\"pausedRanges\":[{\"startNs\":1000,\"endNs\":3000}],\"discarded\":false}");
  CHECK_EQ(protocol::stopped(-4, {}, {}, true),
           "{\"t\":\"stopped\",\"durationMs\":0,\"paths\":{},\"pausedRanges\":[],\"discarded\":true}");
  // Every outbound line must itself be valid single-line JSON.
  for (const std::string& line : {protocol::pong({}), protocol::stats(s), protocol::stopped(1, paths, {}, true),
                                  protocol::error("x", "multi\nline", true)}) {
    CHECK(line.find('\n') == std::string::npos);
    CHECK(json::parse(line).ok);
  }
}

// Shape electron/capture/helperBackend.ts sends, plus the Windows mic mapping fields.
TEST(protocol_host_backend_start_shape) {
  auto p = protocol::parseCommand(
      R"j({"t":"start","id":4,"sessionId":"s","outDir":"C:\\rec","source":{"kind":"display","id":"2528732444",)j"
      R"j("bounds":{"x":-1920,"y":0,"width":1920,"height":1080}},"audio":{"system":true,"mic":"f00dhash",)j"
      R"j("micLabel":"Default - Microphone (USB Audio)","micEndpointId":"{0.0.1.00000000}.{abc}"},"fps":60,"hideCursor":true})j");
  CHECK(p.ok);
  CHECK_EQ(p.command.start.outputDir, std::string("C:\\rec"));
  CHECK_EQ(p.command.start.source.id, std::string("2528732444"));
  CHECK(p.command.start.source.bounds && p.command.start.source.bounds->x == -1920);
  CHECK(p.command.start.audio.micEndpointId == std::string("{0.0.1.00000000}.{abc}"));
  CHECK(p.command.start.audio.micLabel == std::string("Default - Microphone (USB Audio)"));
  CHECK(p.command.start.audio.wantsMic());
  p = protocol::parseCommand(
      R"({"t":"start","outDir":"x","source":{"kind":"display"},"audio":{"system":false,"micLabel":"","micEndpointId":7}})");
  CHECK(p.ok && !p.command.start.audio.micLabel && !p.command.start.audio.micEndpointId);
  CHECK(!p.command.start.audio.wantsMic());
  p = protocol::parseCommand(R"({"t":"start","outputDir":"a","outDir":"b","source":{"kind":"display"}})");
  CHECK(p.ok && p.command.start.outputDir == "a");
  p = protocol::parseCommand(R"({"t":"start","outDir":"","source":{"kind":"display"}})");
  CHECK(!p.ok && p.error.code == "badRequest");
}

TEST(protocol_acks_device_lost_disk_low) {
  CHECK_EQ(protocol::ready(2), "{\"t\":\"ready\",\"id\":2}");
  CHECK_EQ(protocol::paused(3), "{\"t\":\"paused\",\"id\":3}");
  CHECK_EQ(protocol::resumed(), "{\"t\":\"resumed\"}");
  CHECK_EQ(protocol::deviceLost("mic-1", "gone \"now\""),
           "{\"t\":\"deviceLost\",\"device\":\"mic-1\",\"message\":\"gone \\\"now\\\"\"}");
  CHECK_EQ(protocol::interrupted(protocol::reason::DiskLow, "x"),
           "{\"t\":\"interrupted\",\"reason\":\"diskLow\",\"message\":\"x\"}");
}

TEST(audio_resolve_mic_endpoint) {
  using audio::MicMatch;
  const std::vector<audio::EndpointDesc> eps = {
      {"{0.0.1.00000000}.{aaa}", "Microphone (Realtek(R) Audio)", true},
      {"{0.0.1.00000000}.{bbb}", "Microphone (USB Audio Device)", false},
      {"{0.0.1.00000000}.{ccc}", "Headset Microphone (Jabra Link 380)", false},
  };
  const auto resolve = [&](const protocol::AudioOptions& a) { return audio::resolveMicEndpoint(eps, a); };
  protocol::AudioOptions a;
  a.mic = "default";
  auto r = resolve(a);
  CHECK(r.index == std::size_t{0} && r.match == MicMatch::Default && !r.fellBack);

  a = {};
  a.mic = "{0.0.1.00000000}.{bbb}";
  r = resolve(a);
  CHECK(r.index == std::size_t{1} && r.match == MicMatch::Id);

  a = {};
  a.micEndpointId = "{0.0.1.00000000}.{ccc}";
  a.mic = "{0.0.1.00000000}.{bbb}";
  r = resolve(a);
  CHECK(r.index == std::size_t{2} && r.match == MicMatch::EndpointId);

  a = {};
  a.mic = "3f9ac0ffee";  // Chromium hash: never an endpoint id
  a.micLabel = "Default - Microphone (USB Audio Device)";
  r = resolve(a);
  CHECK(r.index == std::size_t{1} && r.match == MicMatch::LabelExact && !r.fellBack);

  a = {};
  a.micLabel = "  communications - HEADSET MICROPHONE (JABRA LINK 380) ";
  r = resolve(a);
  CHECK(r.index == std::size_t{2} && r.match == MicMatch::LabelExact);

  a = {};
  a.micLabel = "Jabra Link 380";
  r = resolve(a);
  CHECK(r.index == std::size_t{2} && r.match == MicMatch::LabelContains);

  a = {};
  a.micLabel = "Microphone";  // ambiguous: every endpoint contains it
  r = resolve(a);
  CHECK(r.index == std::size_t{0} && r.match == MicMatch::Default && r.fellBack);

  a = {};
  a.mic = "3f9ac0ffee";
  r = resolve(a);
  CHECK(r.index == std::size_t{0} && r.match == MicMatch::Default && r.fellBack);

  a = {};
  a.micEndpointId = "{gone}";
  r = audio::resolveMicEndpoint({}, a);
  CHECK(!r.index && r.match == MicMatch::None && r.fellBack);

  a = {};
  a.mic = "default";
  r = audio::resolveMicEndpoint({{"x", "Mic", false}}, a);
  CHECK(!r.index && r.match == MicMatch::None && !r.fellBack);

  a = {};
  a.micLabel = "Default";  // bare label is not a prefix; means the default device
  r = resolve(a);
  CHECK(r.index == std::size_t{0} && r.match == MicMatch::Default && !r.fellBack);
}

TEST(capture_resolve_monitor_dip_bounds) {
  // Primary 2560x1440 at 150% with a 1920x1080 100% monitor to its right. Electron
  // reports DIP bounds {1707,0,1920,1080} for the second; the larger overlap still wins.
  std::vector<capture::MonitorDesc> mons = {
      {"\\\\.\\DISPLAY1", {0, 0, 2560, 1440}, true},
      {"\\\\.\\DISPLAY2", {2560, 0, 1920, 1080}, false},
  };
  protocol::Source s;
  s.id = "2779098405";
  s.bounds = protocol::Rect{1707, 0, 1920, 1080};
  CHECK(capture::resolveMonitor(mons, s) == std::size_t{1});
  s.bounds = protocol::Rect{0, 0, 1707, 960};  // primary in DIP
  CHECK(capture::resolveMonitor(mons, s) == std::size_t{0});
}

// ---------------------------------------------------------------- session state

TEST(session_happy_path) {
  using protocol::CommandType;
  using session::State;
  State s = State::Idle;
  auto t = session::onCommand(s, CommandType::Start);
  CHECK(t.ok && t.next == State::Starting);
  s = t.next;
  t = session::onEvent(s, session::Event::FirstFrame);
  CHECK(t.ok && t.next == State::Recording);
  s = t.next;
  t = session::onCommand(s, CommandType::Pause);
  CHECK(t.ok && t.next == State::Paused);
  s = t.next;
  t = session::onCommand(s, CommandType::Resume);
  CHECK(t.ok && t.next == State::Recording);
  s = t.next;
  t = session::onCommand(s, CommandType::Stop);
  CHECK(t.ok && t.next == State::Stopping);
  s = t.next;
  t = session::onEvent(s, session::Event::Finished);
  CHECK(t.ok && t.next == State::Stopped);
}

TEST(session_rejects_invalid) {
  using protocol::CommandType;
  using session::State;
  CHECK(!session::onCommand(State::Idle, CommandType::Stop).ok);
  CHECK(!session::onCommand(State::Idle, CommandType::Pause).ok);
  CHECK(!session::onCommand(State::Recording, CommandType::Start).ok);
  CHECK(!session::onCommand(State::Recording, CommandType::Resume).ok);
  CHECK(!session::onCommand(State::Paused, CommandType::Pause).ok);
  CHECK(!session::onCommand(State::Stopping, CommandType::Stop).ok);
  CHECK(!session::onCommand(State::Stopped, CommandType::Discard).ok);
  CHECK(!session::onEvent(State::Paused, session::Event::FirstFrame).ok);
  CHECK(session::onCommand(State::Starting, CommandType::Pause).ok);
  CHECK(session::onEvent(State::Starting, session::Event::StartFailed).next == State::Idle);
  CHECK(session::onEvent(State::Paused, session::Event::Interrupted).next == State::Stopping);
  // ping never transitions, in every state
  for (State st : {State::Idle, State::Starting, State::Recording, State::Paused, State::Stopping, State::Stopped}) {
    auto t = session::onCommand(st, CommandType::Ping);
    CHECK(t.ok && t.next == st);
  }
}

// ---------------------------------------------------------------- timing

TEST(timing_qpc_conversion) {
  CHECK_EQ(timing::qpcTicksToNs(10'000'000, 10'000'000), 1'000'000'000LL);
  CHECK_EQ(timing::qpcTicksToNs(15'000'001, 10'000'000), 1'500'000'100LL);
  // 200 days of uptime at 10 MHz does not overflow.
  const std::int64_t ticks = 200LL * 86400LL * 10'000'000LL + 3;
  CHECK_EQ(timing::qpcTicksToNs(ticks, 10'000'000), 200LL * 86400LL * 1'000'000'000LL + 300);
  // Odd frequency (TSC-less hardware)
  CHECK_EQ(timing::qpcTicksToNs(3'579'545, 3'579'545), 1'000'000'000LL);
  CHECK_EQ(timing::qpcTicksToNs(123, 0), 0);
  CHECK_EQ(timing::hnsToNs(166'667), 16'666'700LL);
}

TEST(timing_media_clock_anchor_and_pause) {
  timing::MediaClock c;
  CHECK(!c.toMediaNs(5).has_value());
  auto m = c.onVideoFrame(1'000);
  CHECK(m && *m == 0);
  CHECK(c.anchorNs() == 1'000);
  CHECK(!c.toMediaNs(999).has_value());  // before anchor
  m = c.onVideoFrame(2'000);
  CHECK(m && *m == 1'000);

  CHECK(c.pause(3'000));
  CHECK(!c.pause(3'100));  // double pause rejected
  CHECK(c.onVideoFrame(2'900) == 1'900LL);  // captured before pause, delivered late: kept
  CHECK(!c.onVideoFrame(3'500).has_value());
  CHECK(c.resume(10'000));
  CHECK(!c.resume(10'001));
  CHECK_EQ(c.pausedTotalNs(), 7'000LL);
  CHECK(!c.toMediaNs(5'000).has_value());  // inside paused range
  m = c.onVideoFrame(10'000);
  CHECK(m && *m == 2'000);  // continuous: 3000 - 1000
  m = c.onVideoFrame(11'000);
  CHECK(m && *m == 3'000);
  CHECK_EQ(c.pausedRanges().size(), std::size_t{1});
}

TEST(timing_media_clock_pause_before_first_frame) {
  timing::MediaClock c;
  CHECK(c.pause(100));
  CHECK(!c.onVideoFrame(200).has_value());  // paused: does not anchor
  CHECK(!c.anchored());
  CHECK(c.resume(300));
  CHECK(c.pausedRanges().empty());
  auto m = c.onVideoFrame(400);
  CHECK(m && *m == 0);
}

TEST(timing_media_clock_property_monotonic) {
  // Pseudo-random (fixed-seed LCG) pause/resume/frame sequences: media time is
  // non-decreasing for increasing host time and never exceeds host elapsed.
  std::uint64_t seed = 0x9E3779B97F4A7C15ULL;
  auto next = [&seed]() {
    seed = seed * 6364136223846793005ULL + 1442695040888963407ULL;
    return static_cast<std::uint32_t>(seed >> 33);
  };
  for (int run = 0; run < 200; ++run) {
    timing::MediaClock c;
    std::int64_t host = next() % 1000;
    std::int64_t lastMedia = -1;
    std::int64_t first = -1;
    for (int step = 0; step < 300; ++step) {
      host += 1 + next() % 50'000;
      const std::uint32_t op = next() % 10;
      if (op == 0) c.pause(host);
      else if (op == 1) c.resume(host);
      else if (auto m = c.onVideoFrame(host)) {
        if (first < 0) first = host;
        CHECK(*m >= lastMedia);
        CHECK(*m <= host - first);
        CHECK(*m == host - first - c.pausedTotalNs());
        lastMedia = *m;
      }
    }
  }
}

TEST(timing_monotonic_pts) {
  timing::MonotonicPts m;
  CHECK(m.accept(0));
  CHECK(!m.accept(0));
  CHECK(m.accept(166'666));
  CHECK(!m.accept(100));
  CHECK(m.last() == 166'666);
}

TEST(timing_fps_meter) {
  timing::FpsMeter f;
  for (int i = 0; i < 120; ++i) f.onFrame(static_cast<std::int64_t>(i) * 16'666'667LL);
  CHECK_EQ(f.fps(1'983'333'373LL), 60.0);
  CHECK_EQ(f.fps(10'000'000'000LL), 0.0);
}

TEST(timing_audio_aligner_continuous) {
  timing::MediaClock c;
  c.onVideoFrame(1'000'000'000);
  timing::AudioAligner a(48'000);
  // 10ms packets exactly on time
  for (int i = 0; i < 100; ++i) {
    const auto p = a.place(c, 1'000'000'000 + i * 10'000'000LL, 480);
    CHECK(p.silenceFrames == 0 && p.skipFrames == 0 && p.writeFrames == 480);
  }
  CHECK_EQ(a.framesWritten(), 48'000LL);
  CHECK_EQ(a.nextSampleTimeHns(), 10'000'000LL);
  // 5ms jitter is within tolerance: no correction
  const auto j = a.place(c, 2'005'000'000LL, 480);
  CHECK(j.silenceFrames == 0 && j.skipFrames == 0 && j.writeFrames == 480);
}

TEST(timing_audio_aligner_gap_overlap_and_anchor) {
  timing::MediaClock c;
  timing::AudioAligner a(48'000);
  // No anchor yet: dropped
  auto p = a.place(c, 500, 480);
  CHECK(p.writeFrames == 0 && p.silenceFrames == 0);
  c.onVideoFrame(1'000'000'000);
  // Packet starting 5ms before the anchor: first 240 frames skipped
  p = a.place(c, 995'000'000, 480);
  CHECK(p.skipFrames == 240 && p.writeFrames == 240 && p.silenceFrames == 0);
  // Loopback silence: next packet 1s later -> silence inserted
  p = a.place(c, 2'000'000'000, 480);
  CHECK_EQ(p.silenceFrames, 48'000LL - 240LL);
  CHECK(p.writeFrames == 480);
  CHECK_EQ(a.framesWritten(), 48'480LL);
  // Overlapping (device clock ran ahead): 100ms back -> overlap skipped
  p = a.place(c, 1'920'000'000, 9'600);
  CHECK(p.silenceFrames == 0);
  CHECK_EQ(p.skipFrames, 48'480LL - 44'160LL);
  CHECK_EQ(a.framesWritten(), 48'480LL + (9'600 - (48'480 - 44'160)));
  // Pad to 3s of media
  const std::int64_t written = a.framesWritten();
  CHECK_EQ(a.padTo(3'000'000'000LL), 144'000LL - written);
  CHECK_EQ(a.padTo(1'000), 0LL);
}

TEST(timing_audio_aligner_pause) {
  timing::MediaClock c;
  timing::AudioAligner a(48'000);
  c.onVideoFrame(0);
  a.place(c, 0, 48'000);  // 1s
  c.pause(1'000'000'000);
  auto p = a.place(c, 1'500'000'000, 480);
  CHECK(p.writeFrames == 0);
  c.resume(5'000'000'000);
  p = a.place(c, 5'000'000'000, 480);  // media time 1s: continuous, no silence
  CHECK(p.silenceFrames == 0 && p.skipFrames == 0 && p.writeFrames == 480);
}

TEST(timing_rms) {
  std::vector<std::int16_t> silence(480, 0);
  CHECK_EQ(timing::rmsDbfs(silence.data(), silence.size()), -100.0);
  std::vector<std::int16_t> full(480, 32767);
  CHECK(timing::rmsDbfs(full.data(), full.size()) > -0.01);
  std::vector<std::int16_t> half(480, 16384);
  const double h = timing::rmsDbfs(half.data(), half.size());
  CHECK(h > -6.03 && h < -6.01);
  CHECK_EQ(timing::rmsDbfs(nullptr, 0), -100.0);
}

TEST(timing_tick_schedule) {
  timing::TickSchedule s{1'000, 8'333'333};
  CHECK_EQ(s.nextTickNs(0), 1'000LL);
  CHECK_EQ(s.nextTickNs(1'000), 1'000LL + 8'333'333LL);
  CHECK_EQ(s.nextTickNs(1'000 + 8'333'332), 1'000LL + 8'333'333LL);
  // oversleep by 3.5 periods: skips to the next future tick, no drift
  CHECK_EQ(s.nextTickNs(1'000 + 8'333'333LL * 7 / 2), 1'000LL + 8'333'333LL * 4);
}

// ---------------------------------------------------------------- capture math

TEST(capture_normalize_region) {
  auto r = capture::normalizeRegion(std::nullopt, 2561, 1441);
  CHECK(r && r->width == 2560 && r->height == 1440 && r->x == 0);
  r = capture::normalizeRegion(protocol::Rect{-100, -50, 501, 301}, 1920, 1080);
  CHECK(r && r->x == 0 && r->y == 0 && r->width == 400 && r->height == 250);
  r = capture::normalizeRegion(protocol::Rect{1800, 1000, 400, 400}, 1920, 1080);
  CHECK(r && r->width == 120 && r->height == 80);
  CHECK(!capture::normalizeRegion(protocol::Rect{5000, 0, 10, 10}, 1920, 1080));
  CHECK(!capture::normalizeRegion(protocol::Rect{0, 0, 1, 1}, 1920, 1080));
  CHECK(!capture::normalizeRegion(std::nullopt, 0, 1080));
}

TEST(capture_plan_copy) {
  auto p = capture::planCopy(1920, 1080, protocol::Rect{100, 200, 1280, 720}, 1280, 720);
  CHECK(!p.empty && p.left == 100 && p.top == 200 && p.right == 1380 && p.bottom == 920 && !p.needsClear);
  // Window shrank below encoder size: copy what exists, clear the rest.
  p = capture::planCopy(800, 600, std::nullopt, 1280, 720);
  CHECK(!p.empty && p.right == 800 && p.bottom == 600 && p.needsClear);
  // Window grew: clip to encoder size.
  p = capture::planCopy(2000, 1200, std::nullopt, 1280, 720);
  CHECK(p.right == 1280 && p.bottom == 720 && !p.needsClear);
  // Crop outside content
  CHECK(capture::planCopy(100, 100, protocol::Rect{200, 200, 10, 10}, 10, 10).empty);
  CHECK(capture::planCopy(0, 100, std::nullopt, 10, 10).empty);
}

TEST(capture_bitrate_table) {
  CHECK_EQ(capture::recordBitrate(1920, 1080, 30), 18'000'000LL);
  CHECK_EQ(capture::recordBitrate(1280, 720, 30), 18'000'000LL);
  CHECK_EQ(capture::recordBitrate(2560, 1440, 30), 28'000'000LL);
  CHECK_EQ(capture::recordBitrate(3840, 2160, 30), 45'000'000LL);
  CHECK_EQ(capture::recordBitrate(1920, 1080, 60), 30'600'000LL);
  CHECK_EQ(capture::recordBitrate(3840, 2160, 60), 76'500'000LL);
  CHECK_EQ(capture::recordBitrate(-5, 10, 30), 18'000'000LL);
}

TEST(capture_resolve_monitor) {
  std::vector<capture::MonitorDesc> mons = {
      {"\\\\.\\DISPLAY1", {0, 0, 2560, 1440}, true},
      {"\\\\.\\DISPLAY2", {-1920, 200, 1920, 1080}, false},
  };
  protocol::Source s;
  CHECK(capture::resolveMonitor(mons, s) == std::size_t{0});
  s.id = "\\\\.\\DISPLAY2";
  CHECK(capture::resolveMonitor(mons, s) == std::size_t{1});
  s.id = "2528732444";  // Electron numeric id: no name match -> bounds
  s.bounds = protocol::Rect{-1900, 250, 1920, 1080};
  CHECK(capture::resolveMonitor(mons, s) == std::size_t{1});
  s.bounds = protocol::Rect{10000, 0, 10, 10};
  CHECK(capture::resolveMonitor(mons, s) == std::size_t{0});
  CHECK(!capture::resolveMonitor({}, s));
}

TEST(capture_parse_window_handle) {
  CHECK(capture::parseWindowHandle("132456") == 132456ULL);
  CHECK(capture::parseWindowHandle("0x1F2a") == 0x1F2AULL);
  CHECK(!capture::parseWindowHandle(""));
  CHECK(!capture::parseWindowHandle("0"));
  CHECK(!capture::parseWindowHandle("12ab"));
  CHECK(!capture::parseWindowHandle("99999999999999999999999"));
}

// ---------------------------------------------------------------- meta / cursor / probe

TEST(meta_json_shape) {
  meta::RecordingMeta m;
  m.backend = "wgc";
  m.startQpc = 123'456'789;
  m.qpcFrequency = 10'000'000;
  m.firstFramePtsNs = 12'345'678'900;
  m.width = 1920;
  m.height = 1080;
  m.fps = 60;
  m.sourceKind = "display";
  m.region = protocol::Rect{0, 0, 1920, 1080};
  m.encoder = {"NVIDIA H.264 Encoder MFT", true};
  m.pausedRanges.push_back({1, 2});
  m.video = "screen.mp4";
  const std::string text = meta::toJson(m).dump();
  const auto p = json::parse(text);
  CHECK(p.ok);
  CHECK_EQ(p.value.find("startQpc")->asInt(), 123'456'789LL);
  CHECK_EQ(p.value.find("encoder")->find("hardware")->asBool(), true);
  CHECK_EQ(p.value.find("pausedRanges")->size(), std::size_t{1});
  CHECK(p.value.find("files")->find("mic") == nullptr);
  CHECK(p.value.find("interruptReason") == nullptr);
}

TEST(cursor_key_state) {
  cursor::KeyState k;
  CHECK(k.down(0x41));
  CHECK(!k.down(0x41));  // auto-repeat
  k.up(0x41);
  CHECK(k.down(0x41));
  CHECK_EQ(k.modifiers(), 0U);
  k.down(cursor::vk::LControl);
  k.down(cursor::vk::RShift);
  CHECK_EQ(k.modifiers(), static_cast<std::uint32_t>(cursor::kCtrl | cursor::kShift));
  k.down(cursor::vk::LWin);
  k.down(cursor::vk::RMenu);
  CHECK_EQ(k.modifiers(), 15U);
  k.clear();
  CHECK_EQ(k.modifiers(), 0U);
  CHECK(!k.down(300));
  CHECK(cursor::KeyState::isModifier(cursor::vk::LMenu));
  CHECK(!cursor::KeyState::isModifier(0x41));
}

TEST(cursor_lines) {
  CHECK_EQ(cursor::moveLine(5, -10, 20, cursor::CursorType::ResizeNWSE),
           "{\"t\":\"move\",\"tNs\":5,\"x\":-10,\"y\":20,\"cursor\":\"resize-nwse\"}");
  CHECK_EQ(cursor::clickLine(6, 1, 2, cursor::MouseButton::Right, false),
           "{\"t\":\"click\",\"tNs\":6,\"x\":1,\"y\":2,\"button\":\"right\",\"phase\":\"up\"}");
  CHECK_EQ(cursor::keyLine(7, 0x41, 2), "{\"t\":\"key\",\"tNs\":7,\"keyCode\":65,\"modifiers\":2}");
  CHECK_EQ(cursor::scrollLine(8, 0, 120), "{\"t\":\"scroll\",\"tNs\":8,\"dx\":0,\"dy\":-1}");
  CHECK_EQ(cursor::scrollLine(8, 60, -240), "{\"t\":\"scroll\",\"tNs\":8,\"dx\":0.5,\"dy\":2}");
  CHECK_EQ(cursor::scrollLine(8, 0, std::numeric_limits<std::int32_t>::min()).find("-"), std::string::npos);
  CHECK_EQ(cursor::startedLine(1, 99, true),
           "{\"t\":\"started\",\"id\":1,\"hostTimeNs\":99,\"sampleHz\":120,\"clickSource\":\"eventTap\",\"keys\":true}");
  CHECK_EQ(cursor::stoppedLine(3, 7200), "{\"t\":\"stopped\",\"id\":3,\"samples\":7200}");
  CHECK_EQ(cursor::stoppedLine(std::nullopt, -1), "{\"t\":\"stopped\",\"samples\":0}");
  // Shapes without a style-pack sprite fall back to the arrow (mac CURSOR_KINDS).
  for (auto t : {cursor::CursorType::Move, cursor::CursorType::Wait, cursor::CursorType::Crosshair,
                 cursor::CursorType::NotAllowed, cursor::CursorType::Hidden, cursor::CursorType::Other}) {
    CHECK_EQ(std::string(cursor::cursorKindName(t)), std::string("arrow"));
  }
  CHECK_EQ(cursor::keyLine(1, 0x1FFFF, 0xFF), "{\"t\":\"key\",\"tNs\":1,\"keyCode\":65535,\"modifiers\":63}");
}

TEST(hwprobe_fourcc_and_report) {
  CHECK_EQ(hwprobe::fourccText(0x34363248), std::string("H264"));
  CHECK_EQ(std::string(hwprobe::codecForFourcc(0x34363248)), std::string("h264"));
  CHECK_EQ(std::string(hwprobe::codecForFourcc(0x43564548)), std::string("hevc"));
  CHECK_EQ(std::string(hwprobe::codecForFourcc(0x31305641)), std::string("av1"));
  CHECK_EQ(std::string(hwprobe::codecForFourcc(0x30395056)), std::string("vp9"));
  CHECK_EQ(std::string(hwprobe::codecForFourcc(0x33504D4D)), std::string("other"));
  CHECK_EQ(hwprobe::fourccText(0x00000001), std::string("????"));
  const std::string text = hwprobe::toJson(hwprobe::sampleReport()).dump();
  const auto p = json::parse(text);
  CHECK(p.ok);
  CHECK_EQ(p.value.find("encoders")->size(), std::size_t{7});
  CHECK_EQ(p.value.find("adapters")->at(0).find("vendorId")->asInt(), 0x10DELL);
}

// ---------------------------------------------------------------- line io

TEST(line_writer_orders_and_flushes) {
  std::string out;
  std::mutex m;
  {
    io::LineWriter w([&](const std::string& l) {
      std::lock_guard<std::mutex> lock(m);
      out += l;
    });
    for (int i = 0; i < 1000; ++i) CHECK(w.post(std::to_string(i)));
    w.flush();
    std::lock_guard<std::mutex> lock(m);
    CHECK(out.size() > 0 && out.substr(0, 4) == "0\n1\n");
  }
  std::string expected;
  for (int i = 0; i < 1000; ++i) expected += std::to_string(i) + "\n";
  CHECK_EQ(out, expected);
}

TEST(line_writer_bounded_queue_and_close) {
  std::mutex gate;
  gate.lock();
  std::string out;
  io::LineWriter w(
      [&](const std::string& l) {
        std::lock_guard<std::mutex> lock(gate);  // blocks the writer thread until released
        out += l;
      },
      4);
  int accepted = 0;
  for (int i = 0; i < 50; ++i) accepted += w.post("x") ? 1 : 0;
  CHECK(accepted <= 5 + 4);  // at most one in-flight batch + queue cap
  CHECK(w.dropped() >= 41);
  gate.unlock();
  w.close();
  CHECK(!w.post("late"));
  w.close();  // idempotent
}

TEST(line_splitter) {
  io::LineSplitter s(8);
  std::vector<std::string> lines;
  s.feed("{\"t\":1}\r\n{\"t", lines);
  CHECK(lines.size() == 1 && lines[0] == "{\"t\":1}");
  s.feed("\":2}\n", lines);
  CHECK(lines.size() == 2 && lines[1] == "{\"t\":2}");
  s.feed("0123456789abcdef\nok\n", lines);
  CHECK(lines.size() == 3 && lines[2] == "ok");
  CHECK_EQ(s.overflowCount(), std::size_t{1});
  s.feed("\n", lines);
  CHECK(lines.size() == 4 && lines[3].empty());
}

/// One `{"helper":"sck"|"cursor","line":"<outbound line>"}` per line; validated by
/// protocol-compat.test.ts against the mac zod schemas.
void emitProtocolFixture() {
  std::vector<std::pair<const char*, std::string>> lines;
  lines.emplace_back("sck", protocol::pong({"capture", "display", "window", "region", "pause", "systemAudio", "mic", "h264"}, 1));
  lines.emplace_back("sck", protocol::ready());
  lines.emplace_back("sck", protocol::ready(2));
  lines.emplace_back("sck", protocol::paused(3));
  lines.emplace_back("sck", protocol::resumed(4));
  lines.emplace_back("sck", protocol::deviceLost("{0.0.1.00000000}.{abc}", "microphone was disconnected"));
  lines.emplace_back("sck", protocol::started({123456789012345LL, 123456700000000LL, 2560, 1440, 1.25}, 2));
  protocol::Stats s{59.94, 3, 10'485'760, -18.5};
  lines.emplace_back("sck", protocol::stats(s));
  for (const char* r : {protocol::reason::StreamStopped, protocol::reason::SourceLost, protocol::reason::DeviceLost,
                        protocol::reason::WriterFailed, protocol::reason::ParentGone,
                        protocol::reason::DiskLow}) {
    lines.emplace_back("sck", protocol::interrupted(r, "message"));
  }
  protocol::StoppedPaths paths{"C:\\rec\\screen.mp4", "C:\\rec\\system.m4a", "C:\\rec\\mic.m4a", "C:\\rec\\meta.json"};
  lines.emplace_back("sck", protocol::stopped(12'345, paths, {{1000, 3000}}, false, 5));
  lines.emplace_back("sck", protocol::stopped(0, {}, {}, true));
  for (const char* c : {protocol::code::BadRequest, protocol::code::UnknownCommand, protocol::code::InvalidState,
                        protocol::code::PermissionDenied, protocol::code::SourceNotFound, protocol::code::WriterFailed,
                        protocol::code::StreamFailed, protocol::code::MicUnavailable, protocol::code::NoFrames,
                        protocol::code::Internal}) {
    lines.emplace_back("sck", protocol::error(c, "message", false, 7));
  }
  lines.emplace_back("cursor", protocol::pong({"position", "clicks", "keys", "scroll", "cursorType"}));
  lines.emplace_back("cursor", protocol::ready());
  lines.emplace_back("cursor", cursor::startedLine(1, 123456000000000LL, true));
  for (auto t : {cursor::CursorType::Arrow, cursor::CursorType::IBeam, cursor::CursorType::Hand,
                 cursor::CursorType::ResizeEW, cursor::CursorType::ResizeNS, cursor::CursorType::ResizeNESW,
                 cursor::CursorType::ResizeNWSE, cursor::CursorType::Move, cursor::CursorType::Hidden,
                 cursor::CursorType::Other}) {
    lines.emplace_back("cursor", cursor::moveLine(123456789000000LL, -1920, 40, t));
  }
  for (auto b : {cursor::MouseButton::Left, cursor::MouseButton::Middle, cursor::MouseButton::Right}) {
    lines.emplace_back("cursor", cursor::clickLine(123456790000000LL, 812, 300, b, true));
    lines.emplace_back("cursor", cursor::clickLine(123456790000001LL, 812, 300, b, false));
  }
  lines.emplace_back("cursor", cursor::keyLine(123456791000000LL, 0x41, cursor::kCtrl | cursor::kShift));
  lines.emplace_back("cursor", cursor::scrollLine(123456792000000LL, 60, -240));
  lines.emplace_back("cursor", cursor::stoppedLine(3, 7200));
  lines.emplace_back("cursor", protocol::error(protocol::code::InvalidState, "stop while idle", false));
  for (const auto& [helper, line] : lines) {
    json::Value v = json::Value::object();
    v.set("helper", helper).set("line", line);
    std::printf("%s\n", v.dump().c_str());
  }
}

}  // namespace

int main(int argc, char** argv) {
  if (argc > 1 && std::strcmp(argv[1], "--emit-probe-fixture") == 0) {
    std::printf("%s\n", hwprobe::toJson(hwprobe::sampleReport()).dump().c_str());
    return 0;
  }
  if (argc > 1 && std::strcmp(argv[1], "--emit-protocol-fixture") == 0) {
    emitProtocolFixture();
    return 0;
  }
  int failedTests = 0;
  for (const TestCase& t : registry()) {
    const int before = g_failures;
    t.fn();
    const bool ok = g_failures == before;
    if (!ok) ++failedTests;
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", t.name);
  }
  std::printf("\n%zu tests, %d failed, %d checks, %d check failures\n", registry().size(), failedTests,
              g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
