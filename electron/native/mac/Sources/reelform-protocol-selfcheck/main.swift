import Foundation
import ReelformProtocol

// XCTest-free self-check for the shared protocol target.
//
//   swift run reelform-protocol-selfcheck                  run checks + compare golden fixture
//   swift run reelform-protocol-selfcheck --write-golden   regenerate fixtures/protocol-golden.json
//
// The golden fixture is also consumed by `protocol.test.ts`, pinning Swift
// encoding ⇄ zod validation.

var failures = 0
var passes = 0

func check(_ condition: @autoclosure () -> Bool, _ name: String, file: StaticString = #fileID, line: UInt = #line) {
    if condition() {
        passes += 1
    } else {
        failures += 1
        FileHandle.standardError.write(Data("FAIL \(name) (\(file):\(line))\n".utf8))
    }
}

func expectThrows(_ name: String, _ body: () throws -> Void) {
    do {
        try body()
        check(false, "\(name) should throw")
    } catch {
        check(true, name)
    }
}

/// Deterministic PRNG (SplitMix64) for property-style loops.
struct SplitMix64 {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    mutating func int(_ range: ClosedRange<Int64>) -> Int64 {
        let span = UInt64(range.upperBound - range.lowerBound) &+ 1
        return range.lowerBound + Int64(next() % span)
    }
}

// MARK: - JSON

check(JSONValue.object([("t", .string("a\"b\n\u{1}"))]).serialized() == "{\"t\":\"a\\\"b\\n\\u0001\"}", "string escaping")
check(JSONValue.double(59.94).serialized() == "59.94", "double decimals")
check(JSONValue.double(60).serialized() == "60", "integral double")
check(JSONValue.double(.nan).serialized() == "0", "nan → 0")
check(JSONValue.int(9_007_199_254_740_993).serialized() == "9007199254740993", "int64 exact")
check((try? JSONValue.parse(#"{"id":3.0}"#))?["id"]?.int64Value == 3, "integral double id")
check((try? JSONValue.parse(#"{"b":true}"#))?["b"]?.boolValue == true, "bool parse")
check((try? JSONValue.parse(#"{"b":1}"#))?["b"]?.boolValue == nil, "1 is not bool")
expectThrows("invalid JSON") { _ = try JSONValue.parse("{nope") }

// MARK: - SCK commands

check((try? SckCommand.decode(#"{"t":"ping","id":7}"#)) == .ping(id: 7), "ping decode")
check((try? SckCommand.decode(#"{"t":"stop"}"#)) == .stop(id: nil), "stop without id")
expectThrows("unknown type") { _ = try SckCommand.decode(#"{"t":"explode"}"#) }
expectThrows("missing t") { _ = try SckCommand.decode(#"{"id":1}"#) }
expectThrows("array root") { _ = try SckCommand.decode("[1]") }
expectThrows("fractional id") { _ = try SckCommand.decode(#"{"t":"ping","id":1.5}"#) }
expectThrows("fps 24") {
    _ = try SckCommand.decode(#"{"t":"start","outputDir":"/x","source":{"kind":"display","displayId":1},"fps":24,"audio":{"system":true}}"#)
}
expectThrows("region with window") {
    _ = try SckCommand.decode(#"{"t":"start","outputDir":"/x","source":{"kind":"window","windowId":1},"region":{"x":0,"y":0,"width":10,"height":10},"fps":30,"audio":{"system":false}}"#)
}
expectThrows("zero-size region") {
    _ = try SckCommand.decode(#"{"t":"start","outputDir":"/x","source":{"kind":"display","displayId":1},"region":{"x":0,"y":0,"width":0,"height":10},"fps":30,"audio":{"system":false}}"#)
}
expectThrows("negative displayId") {
    _ = try SckCommand.decode(#"{"t":"start","outputDir":"/x","source":{"kind":"display","displayId":-1},"fps":30,"audio":{"system":false}}"#)
}
expectThrows("empty outputDir") {
    _ = try SckCommand.decode(#"{"t":"start","outputDir":"","source":{"kind":"display","displayId":1},"fps":30,"audio":{"system":false}}"#)
}
check(peekId(#"{"t":"bogus","id":42}"#) == 42, "peekId")
check(ProtocolError.unknownType("x").code == "unknownCommand", "error code mapping")

// Round trip of every command through encode → decode.
let startSample = StartOptions(
    outputDir: "/tmp/rec", source: .display(displayId: 69_734_208, excludePids: [123, 456]),
    region: CaptureRegion(x: 10, y: 20.5, width: 800, height: 600), fps: 60, systemAudio: true, micDeviceId: "BuiltInMicrophoneDevice"
)
let commands: [SckCommand] = [
    .ping(id: 1), .start(id: 2, options: startSample),
    .start(id: nil, options: StartOptions(outputDir: "/r", source: .window(windowId: 99), fps: 30, systemAudio: false)),
    .pause(id: 3), .resume(id: nil), .stop(id: 4), .discard(id: 5),
]
for c in commands {
    check((try? SckCommand.decode(c.encode())) == c, "round trip \(c.encode())")
}

// MARK: - State machine

check(SessionTransition.next(.idle, "start") == .starting, "idle→starting")
check(SessionTransition.next(.idle, "pause") == nil, "idle pause rejected")
check(SessionTransition.next(.recording, "start") == nil, "double start rejected")
check(SessionTransition.next(.paused, "pause") == nil, "double pause rejected")
check(SessionTransition.next(.recording, "resume") == nil, "resume while recording rejected")
check(SessionTransition.next(.starting, "discard") == .stopping, "discard while starting")
check(SessionTransition.next(.stopping, "stop") == nil, "stop while stopping rejected")
check(SessionTransition.next(.finished, "start") == nil, "no restart")

// MARK: - Bitrate table

check(BitrateTable.mbps(width: 1920, height: 1080, fps: 30) == 18, "1080p30")
check(BitrateTable.mbps(width: 2560, height: 1440, fps: 30) == 28, "1440p30")
check(BitrateTable.mbps(width: 3840, height: 2160, fps: 30) == 45, "4K30")
check(abs(BitrateTable.mbps(width: 1920, height: 1080, fps: 60) - 30.6) < 1e-9, "1080p60 ×1.7")
check(BitrateTable.mbps(width: 1921, height: 1080, fps: 30) == 28, "just above 1080p area")
check(BitrateTable.mbps(width: 0, height: 0, fps: 30) == 18, "degenerate size")
check(BitrateTable.bitsPerSecond(width: 3840, height: 2160, fps: 60) == 76_500_000, "4K60 bps")
check(BitrateTable.keyframeIntervalFrames(fps: 60) == 120, "keyframe 2s @60")
check(evenDimension(1001.7) == 1000, "even floor")
check(evenDimension(1) == 2, "even min")

// MARK: - Pause tracker

do {
    var p = PauseTracker()
    check(p.decide(ptsNs: 100) == .append(100), "no pause passthrough")
    check(p.pause(atNs: 1_000), "pause ok")
    check(!p.pause(atNs: 1_100), "double pause")
    check(p.decide(ptsNs: 999) == .append(999), "late pre-pause sample kept")
    check(p.decide(ptsNs: 1_000) == .drop, "sample at pause dropped")
    check(p.resume(atNs: 3_000), "resume ok")
    check(!p.resume(atNs: 3_100), "double resume")
    check(p.decide(ptsNs: 2_999) == .drop, "sample inside range dropped")
    check(p.decide(ptsNs: 3_000) == .append(1_000), "resume boundary shifts")
    check(p.offsetNs == 2_000, "offset")
    p.pause(atNs: 5_000)
    p.resume(atNs: 5_500)
    check(p.decide(ptsNs: 6_000) == .append(3_500), "two ranges shift")
    check(p.decide(ptsNs: 4_000) == .append(2_000), "between ranges")
    check(p.activeDurationNs(firstNs: 0, endNs: 10_000) == 7_500, "active duration")
    p.pause(atNs: 8_000)
    check(p.activeDurationNs(firstNs: 0, endNs: 10_000) == 5_500, "open pause counted")
    check(p.activeDurationNs(firstNs: 10_000, endNs: 5_000) == 0, "inverted duration")
    check(p.outputTimeNs(atHostNs: 9_000) == 5_500, "output time with open pause")
    check(p.outputTimeNs(atHostNs: 4_000) == 2_000, "output time between ranges")
    check(p.outputTimeNs(atHostNs: 2_000) == 1_000, "output time inside a closed range")
    var q = PauseTracker()
    q.pause(atNs: 100)
    q.resume(atNs: 50)
    check(q.ranges == [PausedRange(startNs: 100, endNs: 100)], "resume before pause clamps")
}

// Property: for random pause schedules and increasing input PTS, appended output
// PTS is strictly increasing, never exceeds input, and equals input minus paused
// time before it.
do {
    var rng = SplitMix64(state: 0xC0FFEE)
    for trial in 0 ..< 500 {
        var tracker = PauseTracker()
        var t: Int64 = rng.int(0 ... 1_000_000)
        var lastOut: Int64 = .min
        var ok = true
        for _ in 0 ..< 200 {
            t += rng.int(1 ... 40_000)
            switch rng.next() % 10 {
            case 0: tracker.pause(atNs: t)
            case 1: tracker.resume(atNs: t)
            default: break
            }
            t += rng.int(1 ... 40_000)
            if case let .append(o) = tracker.decide(ptsNs: t) {
                let pausedBefore = tracker.ranges.filter { $0.endNs <= t }.reduce(Int64(0)) { $0 + $1.endNs - $1.startNs }
                if o <= lastOut || o > t || o != t - pausedBefore { ok = false }
                if o != tracker.outputTimeNs(atHostNs: t) { ok = false }
                lastOut = o
            }
        }
        check(ok, "pause property trial \(trial)")
    }
}

// MARK: - FPS window

do {
    var w = FpsWindow()
    for i in 0 ..< 90 { w.recordAppend(atNs: Int64(i) * 16_666_667) }
    let rate = w.fps(nowNs: 89 * 16_666_667)
    check(rate >= 59 && rate <= 61, "fps ≈ 60 (\(rate))")
    w.recordDrop()
    check(w.dropped == 1 && w.appended == 90, "drop counters")
    check(w.fps(nowNs: 100_000_000_000) == 0, "fps decays to 0")
}

// MARK: - Cursor logic

check(Modifier.mask(fromEventFlags: 0x0002_0000 | 0x0010_0000) == (Modifier.shift | Modifier.command), "shift+cmd")
check(Modifier.mask(fromEventFlags: 0) == 0, "no modifiers")
check(Modifier.mask(fromEventFlags: 0x0001_0000 | 0x0080_0000 | 0x0004_0000 | 0x0008_0000) == 2 | 4 | 16 | 32, "caps+fn+ctrl+opt")
check(Modifier.mask(fromEventFlags: 0x0000_0100) == 0, "device-dependent bits ignored")
check(MouseButton.from(buttonNumber: 0) == .left && MouseButton.from(buttonNumber: 1) == .right
    && MouseButton.from(buttonNumber: 2) == .middle && MouseButton.from(buttonNumber: 7) == .middle, "buttons")
let flipped = cocoaToGlobalTopLeft(x: 10, y: 1000, primaryDisplayHeight: 1117)
check(flipped.x == 10 && flipped.y == 117, "cocoa → top-left")
check(cocoaToGlobalTopLeft(x: -50, y: 1500, primaryDisplayHeight: 1117).y == -383, "secondary display above primary")

do {
    let arrow = CursorFingerprint(width: 17, height: 23, hotspotX: 4, hotspotY: 4, imageHash: 1)
    let ibeam = CursorFingerprint(width: 9, height: 18, hotspotX: 4, hotspotY: 9, imageHash: 2)
    let open = CursorFingerprint(width: 32, height: 32, hotspotX: 16, hotspotY: 16, imageHash: 3)
    let closed = CursorFingerprint(width: 32, height: 32, hotspotX: 16, hotspotY: 16, imageHash: 4)
    let ew = CursorFingerprint(width: 24, height: 24, hotspotX: 12, hotspotY: 12, imageHash: 5)
    let ns = CursorFingerprint(width: 24, height: 24, hotspotX: 12, hotspotY: 12, imageHash: 6)
    let c = CursorClassifier(known: [(.arrow, arrow), (.ibeam, ibeam), (.grab, open), (.grab, closed), (.resizeEW, ew), (.resizeNS, ns)])
    check(c.classify(ibeam) == .ibeam, "exact match")
    check(c.classify(nil) == .arrow, "nil → arrow")
    var retina = ibeam
    retina.imageHash = 99
    check(c.classify(retina) == .ibeam, "geometry fallback unique")
    var grabVariant = open
    grabVariant.imageHash = 77
    check(c.classify(grabVariant) == .grab, "geometry fallback same kind")
    var ambiguous = ew
    ambiguous.imageHash = 88
    check(c.classify(ambiguous) == .arrow, "ambiguous geometry → arrow")
    check(c.classify(CursorFingerprint(width: 1, height: 1, hotspotX: 0, hotspotY: 0, imageHash: 0)) == .arrow, "unknown → arrow")
}

check(fnv1a64([UInt8]()) == 0xcbf2_9ce4_8422_2325, "fnv offset basis")
check(fnv1a64(Array("a".utf8)) == 0xaf63_dc4c_8601_ec8c, "fnv 'a'")

do {
    var d = MoveDeduper()
    check(d.shouldEmit(x: 1, y: 2, cursor: .arrow), "first move")
    check(!d.shouldEmit(x: 1, y: 2, cursor: .arrow), "duplicate suppressed")
    check(d.shouldEmit(x: 1, y: 2, cursor: .hand), "cursor change emits")
    d.reset()
    check(d.shouldEmit(x: 1, y: 2, cursor: .hand), "reset emits")
}

do {
    expectThrows("exportCursors without dir") { _ = try CursorCommand.decode(#"{"t":"exportCursors"}"#) }
    check((try? CursorCommand.decode(#"{"t":"exportCursors","id":1,"dir":"/c"}"#)) == .exportCursors(id: 1, dir: "/c"), "exportCursors")
    check(CursorKind.allCases.map(\.rawValue) == ["arrow", "ibeam", "hand", "grab", "resize-ew", "resize-ns", "resize-nesw", "resize-nwse"], "cursor kinds")
    let manifest = cursorPackManifest(name: "macOS", assets: [CursorAsset(kind: .arrow, hotspotX: 4, hotspotY: 4.5, width: 17, height: 23)])
    check(manifest == #"{"name":"macOS","scale":2,"cursors":{"arrow":{"file":"arrow@2x.png","hotspot":[4,4.5],"size":[17,23]}}}"#, "pack.json")
}

// MARK: - Microphone selection

do {
    let devices = [
        MicDeviceDesc(uniqueID: "BuiltInMicrophoneDevice", name: "MacBook Pro Microphone", isDefault: true),
        MicDeviceDesc(uniqueID: "AppleUSBAudioEngine:Logitech:1", name: "Logitech BRIO"),
        MicDeviceDesc(uniqueID: "iPhoneMic", name: "Michi's iPhone Microphone"),
    ]
    typealias R = MicSelection.Resolution
    check(MicSelection.resolve(devices: devices, requestedId: "AppleUSBAudioEngine:Logitech:1", label: nil) == R(index: 1, fellBack: false), "uniqueID match")
    check(MicSelection.resolve(devices: devices, requestedId: "3a1f9c…hash", label: "Logitech BRIO (046d:085e)") == R(index: 1, fellBack: false), "Chromium hash + label with vid:pid")
    check(MicSelection.resolve(devices: devices, requestedId: "default", label: "Default - MacBook Pro Microphone") == R(index: 0, fellBack: false), "default label prefix")
    check(MicSelection.resolve(devices: devices, requestedId: "hash", label: "iphone") == R(index: 2, fellBack: false), "unique partial label")
    check(MicSelection.resolve(devices: devices, requestedId: "hash", label: "microphone") == R(index: 0, fellBack: true), "ambiguous partial label falls back")
    check(MicSelection.resolve(devices: devices, requestedId: "hash", label: nil) == R(index: 0, fellBack: true), "unknown hash falls back to default")
    check(MicSelection.resolve(devices: devices, requestedId: nil, label: nil) == R(index: 0, fellBack: false), "no request → default")
    check(MicSelection.resolve(devices: devices, requestedId: "default", label: "") == R(index: 0, fellBack: false), "explicit default")
    check(MicSelection.resolve(devices: [], requestedId: "hash", label: "x") == R(index: nil, fellBack: true), "no devices")
    check(MicSelection.resolve(devices: [devices[1]], requestedId: nil, label: nil) == R(index: nil, fellBack: false), "no default flagged → AVFoundation default")
    check(MicSelection.normalizeLabel("  USB Audio (Pro) ") == "usb audio (pro)", "non vid:pid parens kept")
    check(MicSelection.normalizeLabel("Default - ") == "default -", "bare prefix is not stripped to empty")
}

// MARK: - Start compatibility with main's helperBackend

do {
    // Exactly what electron/capture/helperBackend.ts sends.
    let host = #"{"t":"start","id":2,"sessionId":"s1","outDir":"/tmp/rec","source":{"kind":"display","id":"69734208"},"audio":{"system":true,"mic":"default"},"fps":60,"hideCursor":true}"#
    let decoded = try? SckCommand.decode(host)
    check(decoded == .start(id: 2, options: StartOptions(outputDir: "/tmp/rec", source: .display(displayId: 69_734_208, excludePids: []),
                                                         fps: 60, systemAudio: true, micDeviceId: "default")), "host start shape decodes")
    let hostWindow = #"{"t":"start","id":3,"outDir":"/r","source":{"kind":"window","id":"window:99:0"},"audio":{"system":false},"fps":30,"hideCursor":false}"#
    check((try? SckCommand.decode(hostWindow)) == .start(id: 3, options: StartOptions(outputDir: "/r", source: .window(windowId: 99), fps: 30, systemAudio: false)), "desktopCapturer window id")
    let labelled = #"{"t":"start","id":4,"outDir":"/r","source":{"kind":"display","id":"1"},"audio":{"system":false,"mic":"9f86d081884c7d65","micLabel":"Default - MacBook Pro Microphone"},"fps":30}"#
    check((try? SckCommand.decode(labelled)) == .start(id: 4, options: StartOptions(outputDir: "/r", source: .display(displayId: 1, excludePids: []), fps: 30, systemAudio: false, micDeviceId: "9f86d081884c7d65", micLabel: "Default - MacBook Pro Microphone")), "host start with micLabel")
    let labelOnly = #"{"t":"start","outDir":"/r","source":{"kind":"display","id":"1"},"audio":{"system":false,"micLabel":"USB Mic"},"fps":30}"#
    check((try? SckCommand.decode(labelOnly)) == .start(id: nil, options: StartOptions(outputDir: "/r", source: .display(displayId: 1, excludePids: []), fps: 30, systemAudio: false, micDeviceId: "default", micLabel: "USB Mic")), "micLabel alone requests a mic")
    let blankLabel = #"{"t":"start","outDir":"/r","source":{"kind":"display","id":"1"},"audio":{"system":false,"micLabel":"  "},"fps":30}"#
    check((try? SckCommand.decode(blankLabel)) == .start(id: nil, options: StartOptions(outputDir: "/r", source: .display(displayId: 1, excludePids: []), fps: 30, systemAudio: false)), "blank micLabel ignored")
    expectThrows("non-string micLabel") { _ = try SckCommand.decode(#"{"t":"start","outDir":"/r","source":{"kind":"display","id":"1"},"audio":{"system":false,"micLabel":3},"fps":30}"#) }
    check(parseSourceId(.string("screen:5:0")) == 5, "screen:N:M id")
    check(parseSourceId(.int(7)) == 7, "numeric id")
    check(parseSourceId(.string("12ab")) == nil, "garbage id")
    check(parseSourceId(.string("-1")) == nil, "negative id string")
    check(parseSourceId(.string("4294967296")) == nil, "id beyond UInt32")
    check(parseSourceId(.string("")) == nil, "empty id")
    check(parseSourceId(nil) == nil, "missing id")
    expectThrows("host start without id") {
        _ = try SckCommand.decode(#"{"t":"start","outDir":"/r","source":{"kind":"display"},"audio":{"system":false},"fps":30}"#)
    }
    expectThrows("outDir empty") {
        _ = try SckCommand.decode(#"{"t":"start","outDir":"","source":{"kind":"display","id":"1"},"audio":{"system":false},"fps":30}"#)
    }
}

// MARK: - listSources

do {
    check((try? SckCommand.decode(#"{"t":"listSources","id":4}"#)) == .listSources(id: 4, thumbnailWidth: 320), "listSources default width")
    check((try? SckCommand.decode(#"{"t":"listSources","thumbnails":false,"thumbnailWidth":640}"#)) == .listSources(id: nil, thumbnailWidth: 0), "thumbnails off wins")
    check((try? SckCommand.decode(#"{"t":"listSources","thumbnailWidth":640}"#)) == .listSources(id: nil, thumbnailWidth: 640), "custom width")
    expectThrows("width too small") { _ = try SckCommand.decode(#"{"t":"listSources","thumbnailWidth":2}"#) }
    expectThrows("width too large") { _ = try SckCommand.decode(#"{"t":"listSources","thumbnailWidth":5000}"#) }
    expectThrows("thumbnails not bool") { _ = try SckCommand.decode(#"{"t":"listSources","thumbnails":1}"#) }
    for c in [SckCommand.listSources(id: 6, thumbnailWidth: 320), .listSources(id: nil, thumbnailWidth: 0)] {
        check((try? SckCommand.decode(c.encode())) == c, "listSources round trip \(c.encode())")
    }

    let frame = SourceRect(x: 0, y: 0, width: 800, height: 600)
    check(SourceListing.includeWindow(layer: 0, isOnScreen: true, frame: frame, ownerPid: 10, excludedPids: [1, 2]), "normal window")
    check(!SourceListing.includeWindow(layer: 25, isOnScreen: true, frame: frame, ownerPid: 10, excludedPids: []), "menu bar layer")
    check(!SourceListing.includeWindow(layer: 0, isOnScreen: false, frame: frame, ownerPid: 10, excludedPids: []), "off screen")
    check(!SourceListing.includeWindow(layer: 0, isOnScreen: true, frame: SourceRect(x: 0, y: 0, width: 49, height: 600), ownerPid: 10, excludedPids: []), "too narrow")
    check(!SourceListing.includeWindow(layer: 0, isOnScreen: true, frame: frame, ownerPid: 2, excludedPids: [1, 2]), "own / parent window")
    check(SourceListing.includeWindow(layer: 0, isOnScreen: true, frame: frame, ownerPid: nil, excludedPids: [1]), "unknown owner kept")

    let displaysFrames: [(id: UInt32, frame: SourceRect)] = [
        (1, SourceRect(x: 0, y: 0, width: 1512, height: 982)),
        (2, SourceRect(x: 1512, y: -200, width: 2560, height: 1440)),
    ]
    check(SourceListing.displayFor(window: SourceRect(x: 1400, y: 100, width: 400, height: 300), displays: displaysFrames) == 2, "largest overlap wins")
    check(SourceListing.displayFor(window: SourceRect(x: 100, y: 100, width: 400, height: 300), displays: displaysFrames) == 1, "inside primary")
    check(SourceListing.displayFor(window: SourceRect(x: -9000, y: 0, width: 10, height: 10), displays: displaysFrames) == 1, "off-display → first")
    check(SourceListing.displayFor(window: frame, displays: []) == nil, "no displays")

    check(SourceListing.thumbnailSize(width: 1512, height: 982, maxWidth: 320) == (320, 208), "aspect kept")
    check(SourceListing.thumbnailSize(width: 100, height: 4000, maxWidth: 320).height == 12_800, "tall window")
    check(SourceListing.thumbnailSize(width: 0, height: 0, maxWidth: 320) == (320, 200), "degenerate size")
    check(SourceListing.thumbnailSize(width: 10_000, height: 1, maxWidth: 320).height == 1, "height floor 1")
    check(SourceListing.thumbnailSize(width: 100, height: 100, maxWidth: 99_999).width == SourceListing.maxThumbnailWidth, "width clamp")
    check(SourceListing.displayTitle(title: "  ", appName: "Safari") == "Safari", "blank title → app")
    check(SourceListing.displayTitle(title: nil, appName: nil) == "Untitled window", "placeholder title")
    check(SourceListing.dataURL(png: Data([1, 2, 3])) == "data:image/png;base64,AQID", "data URL")
    check(DiskGuard.isLow(availableBytes: 499 * 1024 * 1024), "disk low")
    check(!DiskGuard.isLow(availableBytes: 500 * 1024 * 1024), "disk at threshold ok")
    check(!DiskGuard.isLow(availableBytes: nil), "unknown capacity is not low")

    let d = ListedDisplay(id: 1, name: "Built-in \"Retina\"", bounds: displaysFrames[0].frame, scaleFactor: 0)
    check(d.json.serialized() == #"{"id":"1","name":"Built-in \"Retina\"","bounds":{"x":0,"y":0,"width":1512,"height":982},"scaleFactor":1}"#, "display json, scale floor")
}

// MARK: - New outbound events

check(SckEvent.ready(id: nil).encode() == #"{"t":"ready"}"#, "launch ready has no id")
check(SckEvent.ready(id: 2).encode() == #"{"t":"ready","id":2}"#, "start ready echoes id")
check(SckEvent.paused(id: 3).encode() == #"{"t":"paused","id":3}"#, "paused ack")
check(SckEvent.resumed(id: nil).encode() == #"{"t":"resumed"}"#, "resumed ack")
check(InterruptReason.allCases.map(\.rawValue) == ["streamStopped", "sourceLost", "deviceLost", "writerFailed", "parentGone", "diskLow"], "interrupt reasons")
check(HelperProtocol.sckCaps.prefix(2) == ["capture", "listSources"], "caps main requires")

// MARK: - Golden fixture

struct GoldenEntry {
    let helper: String
    let direction: String
    let line: String
}

let arrowAsset = CursorAsset(kind: .arrow, hotspotX: 4, hotspotY: 4, width: 17, height: 23)
let golden: [GoldenEntry] = [
    GoldenEntry(helper: "sck", direction: "in", line: SckCommand.ping(id: 1).encode()),
    GoldenEntry(helper: "sck", direction: "in", line: SckCommand.start(id: 2, options: startSample).encode()),
    GoldenEntry(helper: "sck", direction: "in", line: SckCommand.start(id: nil, options: StartOptions(outputDir: "/r", source: .window(windowId: 99), fps: 30, systemAudio: false)).encode()),
    GoldenEntry(helper: "sck", direction: "in", line: SckCommand.pause(id: 3).encode()),
    GoldenEntry(helper: "sck", direction: "in", line: SckCommand.resume(id: 4).encode()),
    GoldenEntry(helper: "sck", direction: "in", line: SckCommand.stop(id: 5).encode()),
    GoldenEntry(helper: "sck", direction: "in", line: SckCommand.discard(id: nil).encode()),
    GoldenEntry(helper: "sck", direction: "in", line: SckCommand.listSources(id: 6, thumbnailWidth: 320).encode()),
    GoldenEntry(helper: "sck", direction: "in", line: SckCommand.listSources(id: 7, thumbnailWidth: 0).encode()),
    // Shape main's helperBackend sends (aliases), accepted but not canonical.
    GoldenEntry(helper: "sck", direction: "inHost", line: #"{"t":"start","id":2,"sessionId":"s1","outDir":"/tmp/rec","source":{"kind":"display","id":"69734208"},"region":{"x":10,"y":20.5,"width":800,"height":600},"audio":{"system":true,"mic":"default"},"fps":60,"hideCursor":true}"#),
    GoldenEntry(helper: "sck", direction: "inHost", line: #"{"t":"start","id":3,"sessionId":"s2","outDir":"/r","source":{"kind":"window","id":"99"},"audio":{"system":false},"fps":30,"hideCursor":false}"#),
    GoldenEntry(helper: "sck", direction: "inHost", line: #"{"t":"start","id":4,"sessionId":"s3","outDir":"/r","source":{"kind":"display","id":"1"},"audio":{"system":false,"mic":"9f86d081884c7d65","micLabel":"Default - MacBook Pro Microphone"},"fps":30,"hideCursor":false}"#),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.pong(id: 1).encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.ready(id: nil).encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.ready(id: 2).encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.paused(id: 3).encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.resumed(id: 4).encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.deviceLost(device: "BuiltInMicrophoneDevice", message: "microphone disconnected").encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.interrupted(reason: .diskLow, message: "less than 500 MB free on the recording volume").encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.sources(
        id: 6,
        displays: [
            ListedDisplay(id: 1, name: "Built-in Retina Display", bounds: SourceRect(x: 0, y: 0, width: 1512, height: 982),
                          scaleFactor: 2, thumbnail: "data:image/png;base64,iVBORw0KGgo="),
            ListedDisplay(id: 3, name: "DELL U2723QE", bounds: SourceRect(x: -2560, y: -300, width: 2560, height: 1440), scaleFactor: 1),
        ],
        windows: [
            ListedWindow(id: 4242, title: "README.md", appName: "Xcode", bundleId: "com.apple.dt.Xcode", pid: 501,
                         bounds: SourceRect(x: 40, y: 60, width: 1200, height: 800.5), displayId: 1,
                         thumbnail: "data:image/png;base64,iVBORw0KGgo="),
            ListedWindow(id: 7, title: "Untitled window", bounds: SourceRect(x: -2000, y: 0, width: 640, height: 480), displayId: 3),
        ]
    ).encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.started(id: 2, firstFramePtsNs: 123_456_789_012_345, startHostTimeNs: 123_456_700_000_000, width: 2940, height: 1912, scaleFactor: 2).encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.stats(fps: 59.94, droppedFrames: 3, fileBytes: 10_485_760).encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.interrupted(reason: .sourceLost, message: "display disconnected").encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.stopped(id: 5, durationMs: 12_345, paths: RecordingPaths(screen: "/tmp/rec/screen.mp4", system: "/tmp/rec/system.m4a", mic: "/tmp/rec/mic.m4a"), pausedRanges: [PausedRange(startNs: 1_000, endNs: 3_000)], discarded: false).encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.stopped(id: nil, durationMs: 0, paths: nil, pausedRanges: [], discarded: true).encode()),
    GoldenEntry(helper: "sck", direction: "out", line: SckEvent.error(id: 2, code: "permissionDenied", message: "screen recording access not granted").encode()),
    GoldenEntry(helper: "sck", direction: "out", line: permissionsLine([("screen", .granted), ("microphone", .notDetermined)])),
    GoldenEntry(helper: "cursor", direction: "in", line: #"{"t":"start","id":1}"#),
    GoldenEntry(helper: "cursor", direction: "in", line: #"{"t":"exportCursors","id":2,"dir":"/tmp/cursors"}"#),
    GoldenEntry(helper: "cursor", direction: "out", line: CursorEvent.pong(id: nil).encode()),
    GoldenEntry(helper: "cursor", direction: "out", line: CursorEvent.ready.encode()),
    GoldenEntry(helper: "cursor", direction: "out", line: CursorEvent.started(id: 1, hostTimeNs: 123_456_000_000_000, sampleHz: 120, clickSource: .eventTap, keys: true).encode()),
    GoldenEntry(helper: "cursor", direction: "out", line: CursorEvent.move(tNs: 123_456_789_000_000, x: 812.5, y: -40, cursor: .ibeam).encode()),
    GoldenEntry(helper: "cursor", direction: "out", line: CursorEvent.click(tNs: 123_456_790_000_000, x: 812.5, y: 300, button: .left, phase: .down).encode()),
    GoldenEntry(helper: "cursor", direction: "out", line: CursorEvent.key(tNs: 123_456_791_000_000, keyCode: 36, modifiers: Modifier.command | Modifier.shift).encode()),
    GoldenEntry(helper: "cursor", direction: "out", line: CursorEvent.scroll(tNs: 123_456_792_000_000, dx: 0, dy: -12).encode()),
    GoldenEntry(helper: "cursor", direction: "out", line: CursorEvent.cursorsExported(id: 2, dir: "/tmp/cursors", files: [arrowAsset]).encode()),
    GoldenEntry(helper: "cursor", direction: "out", line: CursorEvent.stopped(id: 3, samples: 7200).encode()),
    GoldenEntry(helper: "cursor", direction: "out", line: CursorEvent.error(id: nil, code: "invalidState", message: "stop while not running").encode()),
    GoldenEntry(helper: "cursor", direction: "out", line: permissionsLine([("inputMonitoring", .denied), ("accessibility", .granted)])),
]

// Golden inbound sck lines (canonical and host-shaped) must decode.
for entry in golden where entry.helper == "sck" && entry.direction != "out" && !entry.line.hasPrefix(#"{"t":"permissions""#) {
    check((try? SckCommand.decode(entry.line)) != nil, "golden sck command decodes: \(entry.line)")
}

// Golden inbound cursor lines must decode.
for entry in golden where entry.helper == "cursor" && entry.direction == "in" {
    check((try? CursorCommand.decode(entry.line)) != nil, "golden cursor command decodes: \(entry.line)")
}

func goldenDocument() -> String {
    let items = golden.map { entry in
        JSONValue.object([("helper", .string(entry.helper)), ("direction", .string(entry.direction)), ("line", .string(entry.line))]).serialized()
    }
    return "[\n  " + items.joined(separator: ",\n  ") + "\n]\n"
}

let fixtureURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("fixtures/protocol-golden.json")

if CommandLine.arguments.contains("--write-golden") {
    try Data(goldenDocument().utf8).write(to: fixtureURL, options: .atomic)
    print("wrote \(fixtureURL.path)")
} else {
    // Compare entries, not bytes: the repo formatter (Biome) re-indents the
    // JSON file, which must not break the check. Each `line` string is still
    // compared byte for byte.
    let existing = (try? Data(contentsOf: fixtureURL))
        .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: String]] } ?? []
    let expected = golden.map { ["helper": $0.helper, "direction": $0.direction, "line": $0.line] }
    check(existing == expected, "golden fixture up to date (run with --write-golden)")
}

print("selfcheck: \(passes) passed, \(failures) failed")
exit(failures == 0 ? 0 : 1)
