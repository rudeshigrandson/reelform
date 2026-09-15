import Foundation

/// Video bitrate table shared with the Electron backend (§5.2): 1080p 18 Mbps,
/// 1440p 28, 4K 45, ×1.7 at 60fps. Tiers are chosen by pixel area so odd
/// window/region sizes land on the nearest tier at or above them.
public enum BitrateTable {
    public static let area1080p = 1920 * 1080
    public static let area1440p = 2560 * 1440

    public static func mbps(width: Int, height: Int, fps: Int) -> Double {
        let area = max(0, width) * max(0, height)
        let base: Double
        if area <= area1080p {
            base = 18
        } else if area <= area1440p {
            base = 28
        } else {
            base = 45
        }
        return fps > 30 ? base * 1.7 : base
    }

    public static func bitsPerSecond(width: Int, height: Int, fps: Int) -> Int {
        Int((mbps(width: width, height: height, fps: fps) * 1_000_000).rounded())
    }

    /// Keyframe every 2s (§5.3).
    public static let keyframeIntervalSeconds = 2
    public static func keyframeIntervalFrames(fps: Int) -> Int { max(1, fps) * keyframeIntervalSeconds }

    /// System audio AAC bitrate (§5.3).
    public static let systemAudioBitsPerSecond = 192_000
}

/// Encoded frame size must be even for H.264 4:2:0; clamp to ≥ 2.
public func evenDimension(_ v: Double) -> Int {
    let i = Int(v.rounded(.down))
    return max(2, i - (i % 2))
}

/// A closed-open paused range in host-clock nanoseconds.
public struct PausedRange: Equatable, Sendable {
    public var startNs: Int64
    public var endNs: Int64
    public init(startNs: Int64, endNs: Int64) {
        self.startNs = startNs
        self.endNs = endNs
    }
}

/// What to do with one captured sample.
public enum SampleDecision: Equatable, Sendable {
    case drop
    /// Append with this presentation time (host ns minus accumulated pause).
    case append(Int64)
}

/// Pause/resume by PTS offset tracking (§5.3). One tracker is shared by every
/// writer so video, system audio and mic stay aligned.
///
/// Samples with host PTS in a paused range `[pauseNs, resumeNs)` are dropped;
/// later samples are shifted back by the total paused duration, so the file is
/// continuous and output PTS is monotonic when input PTS is. Samples stamped
/// before the pause instant but delivered late (queue latency) are kept.
public struct PauseTracker: Sendable {
    public private(set) var ranges: [PausedRange] = []
    public private(set) var pausedAtNs: Int64?

    public init() {}

    public var isPaused: Bool { pausedAtNs != nil }

    /// Total paused duration of all completed ranges.
    public var offsetNs: Int64 { ranges.reduce(0) { $0 + ($1.endNs - $1.startNs) } }

    /// Returns false when already paused.
    @discardableResult
    public mutating func pause(atNs: Int64) -> Bool {
        guard pausedAtNs == nil else { return false }
        let floor = ranges.last?.endNs ?? Int64.min
        pausedAtNs = max(atNs, floor)
        return true
    }

    /// Returns false when not paused.
    @discardableResult
    public mutating func resume(atNs: Int64) -> Bool {
        guard let start = pausedAtNs else { return false }
        ranges.append(PausedRange(startNs: start, endNs: max(start, atNs)))
        pausedAtNs = nil
        return true
    }

    public func decide(ptsNs: Int64) -> SampleDecision {
        if let start = pausedAtNs, ptsNs >= start { return .drop }
        var shift: Int64 = 0
        for range in ranges {
            if ptsNs >= range.endNs {
                shift += range.endNs - range.startNs
            } else if ptsNs >= range.startNs {
                return .drop
            } else {
                break
            }
        }
        return .append(ptsNs - shift)
    }

    /// Output (file) time for a host instant: `hostNs` minus all paused time
    /// before it, with a still-open pause counted up to `hostNs`. Equals
    /// `decide(ptsNs:)`'s appended value for every sample that is not dropped;
    /// used for `endSession(atSourceTime:)` so a static screen at stop does not
    /// shorten the video track.
    public func outputTimeNs(atHostNs hostNs: Int64) -> Int64 {
        var paused: Int64 = 0
        var all = ranges
        if let open = pausedAtNs { all.append(PausedRange(startNs: open, endNs: max(open, hostNs))) }
        for r in all where r.startNs < hostNs {
            paused += min(r.endNs, hostNs) - r.startNs
        }
        return hostNs - paused
    }

    /// Output duration between the first frame and the last appended sample,
    /// excluding paused time; a still-open pause is closed at `endNs`.
    public func activeDurationNs(firstNs: Int64, endNs: Int64) -> Int64 {
        guard endNs > firstNs else { return 0 }
        var paused: Int64 = 0
        var all = ranges
        if let open = pausedAtNs { all.append(PausedRange(startNs: open, endNs: max(open, endNs))) }
        for r in all {
            let s = max(r.startNs, firstNs)
            let e = min(r.endNs, endNs)
            if e > s { paused += e - s }
        }
        return max(0, endNs - firstNs - paused)
    }
}

/// Rolling frames-per-second over the last second of appended frame PTS.
public struct FpsWindow: Sendable {
    private var stamps: [Int64] = []
    public private(set) var appended: Int = 0
    public private(set) var dropped: Int = 0
    public let windowNs: Int64

    public init(windowNs: Int64 = 1_000_000_000) {
        self.windowNs = windowNs
    }

    public mutating func recordAppend(atNs: Int64) {
        appended += 1
        stamps.append(atNs)
    }

    public mutating func recordDrop() { dropped += 1 }

    /// Frames whose timestamp is within `(nowNs - windowNs, nowNs]`.
    public mutating func fps(nowNs: Int64) -> Double {
        let cutoff = nowNs - windowNs
        stamps.removeAll { $0 <= cutoff }
        let n = stamps.filter { $0 <= nowNs }.count
        return Double(n) * 1_000_000_000 / Double(windowNs)
    }
}

/// Session state machine for `reelform-sck`. Pure so the command gate is
/// testable; the recorder consults it before acting.
public enum SessionState: String, Sendable {
    case idle, starting, recording, paused, stopping, finished
}

public enum SessionTransition {
    /// Returns the next state for a command, or nil when not allowed.
    public static func next(_ state: SessionState, _ command: String) -> SessionState? {
        switch (state, command) {
        case (.idle, "start"): return .starting
        case (.starting, "started"): return .recording
        case (.recording, "pause"): return .paused
        case (.paused, "resume"): return .recording
        case (.starting, "stop"), (.recording, "stop"), (.paused, "stop"),
             (.starting, "discard"), (.recording, "discard"), (.paused, "discard"):
            return .stopping
        case (.stopping, "stopped"): return .finished
        default: return nil
        }
    }
}

/// Host clock in nanoseconds (mach absolute time ≡ `CMClockGetHostTimeClock`).
public protocol HostClock: Sendable {
    func nowNs() -> Int64
}

public struct SystemHostClock: HostClock {
    public init() {}
    public func nowNs() -> Int64 { Int64(clamping: clock_gettime_nsec_np(CLOCK_UPTIME_RAW)) }
}
