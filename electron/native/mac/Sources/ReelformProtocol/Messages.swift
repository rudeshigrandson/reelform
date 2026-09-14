import Foundation

/// Helper protocol (§5.5): stdio, UTF-8, one JSON object per line, `{"t": …, "id"?: n, …}`.
/// Mirrored by `electron/native/mac/protocol.ts` (zod) and pinned by
/// `fixtures/protocol-golden.jsonl`, which both sides check.
public enum HelperProtocol {
    public static let version = "1.0.0"
    public static let sckCaps = [
        "display", "window", "excludePids", "region", "systemAudio", "mic", "pause", "fragmentedMp4", "h264",
    ]
    public static let cursorCaps = ["position", "clicks", "keys", "scroll", "cursorType", "cursorAssets"]
}

// MARK: - Field helpers

private func optionalId(_ v: JSONValue) throws -> Int64? {
    guard let raw = v["id"] else { return nil }
    if raw == .null { return nil }
    guard let id = raw.int64Value else { throw ProtocolError.invalidField("id") }
    return id
}

private func requireType(_ v: JSONValue) throws -> String {
    guard case .object = v else { throw ProtocolError.malformed("not an object") }
    guard let t = v["t"]?.stringValue else { throw ProtocolError.invalidField("t") }
    return t
}

private func withId(_ id: Int64?, _ pairs: [(String, JSONValue)], type: String) -> JSONValue {
    var all: [(String, JSONValue)] = [("t", .string(type))]
    if let id { all.append(("id", .int(id))) }
    all.append(contentsOf: pairs)
    return .object(all)
}

/// Best-effort id extraction for error replies to malformed commands.
public func peekId(_ line: String) -> Int64? {
    guard let v = try? JSONValue.parse(line) else { return nil }
    return v["id"]?.int64Value
}

// MARK: - reelform-sck

public struct CaptureRegion: Equatable, Sendable {
    /// Display points, origin top-left of the display.
    public var x, y, width, height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public enum CaptureSource: Equatable, Sendable {
    /// Whole display; windows owned by `excludePids` (Reelform HUD/bubble) are excluded.
    case display(displayId: UInt32, excludePids: [Int32])
    case window(windowId: UInt32)
}

public struct StartOptions: Equatable, Sendable {
    public var outputDir: String
    public var source: CaptureSource
    public var region: CaptureRegion?
    public var fps: Int
    public var systemAudio: Bool
    /// `AVCaptureDevice.uniqueID`; "default" or absent-with-`micEnabled` = system default.
    public var micDeviceId: String?

    public init(outputDir: String, source: CaptureSource, region: CaptureRegion? = nil, fps: Int,
                systemAudio: Bool, micDeviceId: String? = nil) {
        self.outputDir = outputDir
        self.source = source
        self.region = region
        self.fps = fps
        self.systemAudio = systemAudio
        self.micDeviceId = micDeviceId
    }
}

public enum SckCommand: Equatable, Sendable {
    case ping(id: Int64?)
    case start(id: Int64?, options: StartOptions)
    case pause(id: Int64?)
    case resume(id: Int64?)
    case stop(id: Int64?)
    case discard(id: Int64?)

    public var id: Int64? {
        switch self {
        case let .ping(id), let .pause(id), let .resume(id), let .stop(id), let .discard(id): return id
        case let .start(id, _): return id
        }
    }

    public static func decode(_ line: String) throws -> SckCommand {
        let v = try JSONValue.parse(line)
        let t = try requireType(v)
        let id = try optionalId(v)
        switch t {
        case "ping": return .ping(id: id)
        case "pause": return .pause(id: id)
        case "resume": return .resume(id: id)
        case "stop": return .stop(id: id)
        case "discard": return .discard(id: id)
        case "start": return .start(id: id, options: try decodeStart(v))
        default: throw ProtocolError.unknownType(t)
        }
    }

    public func encode() -> String {
        switch self {
        case let .ping(id): return withId(id, [], type: "ping").serialized()
        case let .pause(id): return withId(id, [], type: "pause").serialized()
        case let .resume(id): return withId(id, [], type: "resume").serialized()
        case let .stop(id): return withId(id, [], type: "stop").serialized()
        case let .discard(id): return withId(id, [], type: "discard").serialized()
        case let .start(id, o):
            var pairs: [(String, JSONValue)] = [("outputDir", .string(o.outputDir))]
            switch o.source {
            case let .display(displayId, excludePids):
                pairs.append(("source", .object([
                    ("kind", .string("display")),
                    ("displayId", .int(Int64(displayId))),
                    ("excludePids", .array(excludePids.map { .int(Int64($0)) })),
                ])))
            case let .window(windowId):
                pairs.append(("source", .object([("kind", .string("window")), ("windowId", .int(Int64(windowId)))])))
            }
            if let r = o.region {
                pairs.append(("region", .object([
                    ("x", .double(r.x)), ("y", .double(r.y)), ("width", .double(r.width)), ("height", .double(r.height)),
                ])))
            }
            pairs.append(("fps", .int(Int64(o.fps))))
            var audio: [(String, JSONValue)] = [("system", .bool(o.systemAudio))]
            if let mic = o.micDeviceId { audio.append(("mic", .string(mic))) }
            pairs.append(("audio", .object(audio)))
            return withId(id, pairs, type: "start").serialized()
        }
    }

    private static func decodeStart(_ v: JSONValue) throws -> StartOptions {
        guard let outputDir = v["outputDir"]?.stringValue, !outputDir.isEmpty else {
            throw ProtocolError.invalidField("outputDir")
        }
        guard let src = v["source"], let kind = src["kind"]?.stringValue else {
            throw ProtocolError.invalidField("source")
        }
        let source: CaptureSource
        switch kind {
        case "display":
            guard let d = src["displayId"]?.int64Value, let did = UInt32(exactly: d) else {
                throw ProtocolError.invalidField("source.displayId")
            }
            var pids: [Int32] = []
            if let raw = src["excludePids"] {
                guard let arr = raw.arrayValue else { throw ProtocolError.invalidField("source.excludePids") }
                pids = try arr.map {
                    guard let p = $0.int64Value, let pid = Int32(exactly: p) else {
                        throw ProtocolError.invalidField("source.excludePids")
                    }
                    return pid
                }
            }
            source = .display(displayId: did, excludePids: pids)
        case "window":
            guard let w = src["windowId"]?.int64Value, let wid = UInt32(exactly: w) else {
                throw ProtocolError.invalidField("source.windowId")
            }
            source = .window(windowId: wid)
        default:
            throw ProtocolError.invalidField("source.kind")
        }
        var region: CaptureRegion?
        if let r = v["region"], r != .null {
            guard let x = r["x"]?.doubleValue, let y = r["y"]?.doubleValue,
                  let w = r["width"]?.doubleValue, let h = r["height"]?.doubleValue,
                  x.isFinite, y.isFinite, w > 0, h > 0, w.isFinite, h.isFinite
            else { throw ProtocolError.invalidField("region") }
            if case .window = source { throw ProtocolError.invalidField("region (display sources only)") }
            region = CaptureRegion(x: x, y: y, width: w, height: h)
        }
        guard let fps = v["fps"]?.int64Value, fps == 30 || fps == 60 else {
            throw ProtocolError.invalidField("fps")
        }
        guard let audio = v["audio"], let system = audio["system"]?.boolValue else {
            throw ProtocolError.invalidField("audio.system")
        }
        var mic: String?
        if let m = audio["mic"], m != .null {
            guard let s = m.stringValue, !s.isEmpty else { throw ProtocolError.invalidField("audio.mic") }
            mic = s
        }
        return StartOptions(outputDir: outputDir, source: source, region: region, fps: Int(fps),
                            systemAudio: system, micDeviceId: mic)
    }
}

public struct RecordingPaths: Equatable, Sendable {
    public var screen: String
    public var system: String?
    public var mic: String?
    public init(screen: String, system: String? = nil, mic: String? = nil) {
        self.screen = screen
        self.system = system
        self.mic = mic
    }
}

public enum InterruptReason: String, Sendable, CaseIterable {
    /// SCStream stopped by the system (e.g. user stopped sharing from the menu bar).
    case streamStopped
    /// Captured display disconnected or window closed.
    case sourceLost
    /// Mic device unplugged / capture session runtime error.
    case deviceLost
    /// AVAssetWriter failed (disk full, I/O error).
    case writerFailed
    /// stdin closed: the parent process went away.
    case parentGone
}

public enum SckEvent: Equatable, Sendable {
    case pong(id: Int64?)
    case ready
    case started(id: Int64?, firstFramePtsNs: Int64, startHostTimeNs: Int64, width: Int, height: Int, scaleFactor: Double)
    case stats(fps: Double, droppedFrames: Int, fileBytes: Int64)
    case interrupted(reason: InterruptReason, message: String)
    case stopped(id: Int64?, durationMs: Int64, paths: RecordingPaths?, pausedRanges: [PausedRange], discarded: Bool)
    case error(id: Int64?, code: String, message: String)

    public func encode() -> String { json.serialized() }

    public var json: JSONValue {
        switch self {
        case let .pong(id):
            return withId(id, [
                ("version", .string(HelperProtocol.version)),
                ("caps", .array(HelperProtocol.sckCaps.map { .string($0) })),
            ], type: "pong")
        case .ready:
            return withId(nil, [], type: "ready")
        case let .started(id, first, startHost, w, h, scale):
            return withId(id, [
                ("firstFramePtsNs", .int(first)),
                ("startHostTimeNs", .int(startHost)),
                ("width", .int(Int64(w))),
                ("height", .int(Int64(h))),
                ("scaleFactor", .double(scale)),
            ], type: "started")
        case let .stats(fps, dropped, bytes):
            return withId(nil, [
                ("fps", .double(fps)), ("droppedFrames", .int(Int64(dropped))), ("fileBytes", .int(bytes)),
            ], type: "stats")
        case let .interrupted(reason, message):
            return withId(nil, [("reason", .string(reason.rawValue)), ("message", .string(message))], type: "interrupted")
        case let .stopped(id, durationMs, paths, ranges, discarded):
            var pathPairs: [(String, JSONValue)] = []
            if let paths {
                pathPairs.append(("screen", .string(paths.screen)))
                if let s = paths.system { pathPairs.append(("system", .string(s))) }
                if let m = paths.mic { pathPairs.append(("mic", .string(m))) }
            }
            return withId(id, [
                ("durationMs", .int(durationMs)),
                ("paths", .object(pathPairs)),
                ("pausedRanges", .array(ranges.map { .object([("startNs", .int($0.startNs)), ("endNs", .int($0.endNs))]) })),
                ("discarded", .bool(discarded)),
            ], type: "stopped")
        case let .error(id, code, message):
            return withId(id, [("code", .string(code)), ("message", .string(message))], type: "error")
        }
    }
}

// MARK: - reelform-cursor-monitor

public enum CursorCommand: Equatable, Sendable {
    case ping(id: Int64?)
    case start(id: Int64?)
    case pause(id: Int64?)
    case resume(id: Int64?)
    case stop(id: Int64?)
    /// Export system cursor PNGs @2x + pack.json into `dir`.
    case exportCursors(id: Int64?, dir: String)

    public static func decode(_ line: String) throws -> CursorCommand {
        let v = try JSONValue.parse(line)
        let t = try requireType(v)
        let id = try optionalId(v)
        switch t {
        case "ping": return .ping(id: id)
        case "start": return .start(id: id)
        case "pause": return .pause(id: id)
        case "resume": return .resume(id: id)
        case "stop": return .stop(id: id)
        case "exportCursors":
            guard let dir = v["dir"]?.stringValue, !dir.isEmpty else { throw ProtocolError.invalidField("dir") }
            return .exportCursors(id: id, dir: dir)
        default: throw ProtocolError.unknownType(t)
        }
    }
}

public enum ClickSource: String, Sendable {
    /// CGEventTap listen-only: clicks + keys.
    case eventTap
    /// NSEvent global monitor fallback: clicks only, no keys.
    case globalMonitor
}

public enum CursorEvent: Equatable, Sendable {
    case pong(id: Int64?)
    case ready
    case started(id: Int64?, hostTimeNs: Int64, sampleHz: Int, clickSource: ClickSource, keys: Bool)
    /// Global top-left points (CoreGraphics global space).
    case move(tNs: Int64, x: Double, y: Double, cursor: CursorKind)
    case click(tNs: Int64, x: Double, y: Double, button: MouseButton, phase: ClickPhase)
    /// Virtual key code + modifier mask only; never characters.
    case key(tNs: Int64, keyCode: Int, modifiers: Int)
    case scroll(tNs: Int64, dx: Double, dy: Double)
    case cursorsExported(id: Int64?, dir: String, files: [CursorAsset])
    case stopped(id: Int64?, samples: Int)
    case error(id: Int64?, code: String, message: String)

    public func encode() -> String { json.serialized() }

    public var json: JSONValue {
        switch self {
        case let .pong(id):
            return withId(id, [
                ("version", .string(HelperProtocol.version)),
                ("caps", .array(HelperProtocol.cursorCaps.map { .string($0) })),
            ], type: "pong")
        case .ready:
            return withId(nil, [], type: "ready")
        case let .started(id, host, hz, source, keys):
            return withId(id, [
                ("hostTimeNs", .int(host)), ("sampleHz", .int(Int64(hz))),
                ("clickSource", .string(source.rawValue)), ("keys", .bool(keys)),
            ], type: "started")
        case let .move(t, x, y, cursor):
            return withId(nil, [("tNs", .int(t)), ("x", .double(x)), ("y", .double(y)), ("cursor", .string(cursor.rawValue))], type: "move")
        case let .click(t, x, y, button, phase):
            return withId(nil, [
                ("tNs", .int(t)), ("x", .double(x)), ("y", .double(y)),
                ("button", .string(button.rawValue)), ("phase", .string(phase.rawValue)),
            ], type: "click")
        case let .key(t, code, mods):
            return withId(nil, [("tNs", .int(t)), ("keyCode", .int(Int64(code))), ("modifiers", .int(Int64(mods)))], type: "key")
        case let .scroll(t, dx, dy):
            return withId(nil, [("tNs", .int(t)), ("dx", .double(dx)), ("dy", .double(dy))], type: "scroll")
        case let .cursorsExported(id, dir, files):
            return withId(id, [("dir", .string(dir)), ("files", .array(files.map(\.json)))], type: "cursorsExported")
        case let .stopped(id, samples):
            return withId(id, [("samples", .int(Int64(samples)))], type: "stopped")
        case let .error(id, code, message):
            return withId(id, [("code", .string(code)), ("message", .string(message))], type: "error")
        }
    }
}

// MARK: - Output

/// Serialized, line-atomic writer to stdout (or any sink for tests).
public final class LineWriter: @unchecked Sendable {
    private let queue = DispatchQueue(label: "reelform.stdout")
    private let sink: (Data) -> Void

    public init(sink: @escaping (Data) -> Void = LineWriter.writeStdout) {
        self.sink = sink
    }

    /// POSIX write loop to fd 1. Unlike `FileHandle.write`, which raises an
    /// Objective-C exception on EPIPE, this silently drops output once the
    /// parent has gone (SIGPIPE is ignored), so finalize can still complete.
    public static func writeStdout(_ data: Data) {
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            guard var ptr = raw.baseAddress else { return }
            var left = raw.count
            while left > 0 {
                let n = write(STDOUT_FILENO, ptr, left)
                if n < 0 {
                    if errno == EINTR { continue }
                    return
                }
                ptr += n
                left -= n
            }
        }
    }

    public func send(_ line: String) {
        var data = Data(line.utf8)
        data.append(0x0A)
        queue.async { self.sink(data) }
    }

    /// Blocks until queued lines are flushed (use before exit).
    public func flush() { queue.sync {} }
}

public enum PermissionStatus: String, Sendable {
    case granted, denied, notDetermined, restricted
}

/// One-shot output of `--permissions` / `--request-permissions` CLI modes
/// (not part of the stdio session): `{"t":"permissions", "<name>": "<status>", …}`.
public func permissionsLine(_ entries: [(String, PermissionStatus)]) -> String {
    withId(nil, entries.map { ($0.0, .string($0.1.rawValue)) }, type: "permissions").serialized()
}

/// Reads stdin lines on a background thread; calls `onEOF` once when closed.
public func readLines(onLine: @escaping (String) -> Void, onEOF: @escaping () -> Void) {
    Thread.detachNewThread {
        while let line = readLine(strippingNewline: true) {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { onLine(trimmed) }
        }
        onEOF()
    }
}
