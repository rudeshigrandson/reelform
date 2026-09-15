import Foundation

// Pure pieces of `listSources` (§5.1 `listSources`, §5.3) and start-message
// compatibility with `electron/capture/helperBackend.ts`. Everything here is
// deterministic so the self-check can cover it without screen permission.

/// Global CoreGraphics points, origin top-left of the primary display (the
/// space Electron's `Display.bounds` and the cursor monitor use on macOS).
public struct SourceRect: Equatable, Sendable {
    public var x, y, width, height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public var json: JSONValue {
        .object([("x", .double(x)), ("y", .double(y)), ("width", .double(width)), ("height", .double(height))])
    }

    public func intersectionArea(_ o: SourceRect) -> Double {
        let w = min(x + width, o.x + o.width) - max(x, o.x)
        let h = min(y + height, o.y + o.height) - max(y, o.y)
        return w > 0 && h > 0 ? w * h : 0
    }
}

public struct ListedDisplay: Equatable, Sendable {
    public var id: UInt32
    public var name: String
    public var bounds: SourceRect
    public var scaleFactor: Double
    /// `data:image/png;base64,…`
    public var thumbnail: String?

    public init(id: UInt32, name: String, bounds: SourceRect, scaleFactor: Double, thumbnail: String? = nil) {
        self.id = id
        self.name = name
        self.bounds = bounds
        self.scaleFactor = scaleFactor
        self.thumbnail = thumbnail
    }

    public var json: JSONValue {
        var pairs: [(String, JSONValue)] = [
            ("id", .string(String(id))),
            ("name", .string(name)),
            ("bounds", bounds.json),
            ("scaleFactor", .double(scaleFactor > 0 ? scaleFactor : 1)),
        ]
        if let thumbnail { pairs.append(("thumbnail", .string(thumbnail))) }
        return .object(pairs)
    }
}

public struct ListedWindow: Equatable, Sendable {
    public var id: UInt32
    public var title: String
    public var appName: String?
    public var bundleId: String?
    public var pid: Int32?
    public var bounds: SourceRect
    public var displayId: UInt32?
    public var thumbnail: String?

    public init(id: UInt32, title: String, appName: String? = nil, bundleId: String? = nil, pid: Int32? = nil,
                bounds: SourceRect, displayId: UInt32? = nil, thumbnail: String? = nil) {
        self.id = id
        self.title = title
        self.appName = appName
        self.bundleId = bundleId
        self.pid = pid
        self.bounds = bounds
        self.displayId = displayId
        self.thumbnail = thumbnail
    }

    public var json: JSONValue {
        var pairs: [(String, JSONValue)] = [("id", .string(String(id))), ("title", .string(title))]
        if let appName { pairs.append(("appName", .string(appName))) }
        if let bundleId { pairs.append(("bundleId", .string(bundleId))) }
        if let pid { pairs.append(("pid", .int(Int64(pid)))) }
        pairs.append(("bounds", bounds.json))
        if let displayId { pairs.append(("displayId", .string(String(displayId)))) }
        if let thumbnail { pairs.append(("thumbnail", .string(thumbnail))) }
        return .object(pairs)
    }
}

public enum SourceListing {
    /// Thumbnails are this many pixels wide (§5.2 uses 320 for the Electron backend).
    public static let defaultThumbnailWidth = 320
    public static let maxThumbnailWidth = 1920
    /// Windows smaller than this (points) are toolbars/status items, not capture targets.
    public static let minWindowSide: Double = 50

    /// Normal app windows only: layer 0, on screen, big enough, not owned by
    /// `excludedPids` (the helper and its parent — Reelform's own windows).
    public static func includeWindow(layer: Int, isOnScreen: Bool, frame: SourceRect, ownerPid: Int32?,
                                     excludedPids: Set<Int32>) -> Bool {
        guard layer == 0, isOnScreen else { return false }
        guard frame.width.isFinite, frame.height.isFinite,
              frame.width >= minWindowSide, frame.height >= minWindowSide else { return false }
        if let ownerPid, excludedPids.contains(ownerPid) { return false }
        return true
    }

    /// Display with the largest overlap; the first display when the window is off every display.
    public static func displayFor(window: SourceRect, displays: [(id: UInt32, frame: SourceRect)]) -> UInt32? {
        var best: (UInt32, Double)?
        for d in displays {
            let area = window.intersectionArea(d.frame)
            if area > 0, area > (best?.1 ?? 0) { best = (d.id, area) }
        }
        return best?.0 ?? displays.first?.id
    }

    /// Pixel size of a thumbnail `maxWidth` wide preserving aspect; both sides ≥ 1.
    public static func thumbnailSize(width: Double, height: Double, maxWidth: Int) -> (width: Int, height: Int) {
        let w = max(1, min(maxWidth, maxThumbnailWidth))
        guard width > 0, height > 0, width.isFinite, height.isFinite else { return (w, max(1, w * 10 / 16)) }
        let h = Int((Double(w) * height / width).rounded())
        return (w, max(1, h))
    }

    /// Window title shown in the picker: the title, else the app name, else a placeholder.
    public static func displayTitle(title: String?, appName: String?) -> String {
        if let t = title?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty { return t }
        if let a = appName?.trimmingCharacters(in: .whitespacesAndNewlines), !a.isEmpty { return a }
        return "Untitled window"
    }

    public static func dataURL(png: Data) -> String {
        "data:image/png;base64," + png.base64EncodedString()
    }
}

/// Parses a source id sent by main: a JSON integer, a decimal string, or
/// Electron `desktopCapturer` form `screen:<id>:<n>` / `window:<id>:<n>`.
public func parseSourceId(_ value: JSONValue?) -> UInt32? {
    guard let value else { return nil }
    if let i = value.int64Value { return UInt32(exactly: i) }
    guard var s = value.stringValue?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
    for prefix in ["screen:", "window:"] where s.hasPrefix(prefix) {
        s = String(s.dropFirst(prefix.count))
        if let colon = s.firstIndex(of: ":") { s = String(s[..<colon]) }
    }
    guard s.allSatisfy(\.isASCII), s.allSatisfy(\.isNumber) else { return nil }
    return UInt32(s)
}

/// §5.6: recordings stop cleanly when the volume drops below 500 MB free.
public enum DiskGuard {
    public static let minFreeBytes: Int64 = 500 * 1024 * 1024
    public static func isLow(availableBytes: Int64?) -> Bool {
        guard let availableBytes else { return false }
        return availableBytes < minFreeBytes
    }
}

/// An audio capture device as `AVCaptureDevice` reports it.
public struct MicDeviceDesc: Equatable, Sendable {
    public var uniqueID: String
    public var name: String
    public var isDefault: Bool
    public init(uniqueID: String, name: String, isDefault: Bool = false) {
        self.uniqueID = uniqueID
        self.name = name
        self.isDefault = isDefault
    }
}

/// Microphone selection for `start` (§5.3). Main forwards the renderer's
/// getUserMedia choice: `audio.mic` is a Chromium deviceId (a per-origin hash
/// that never equals `AVCaptureDevice.uniqueID`, except the literal "default"),
/// and `audio.micLabel` is `MediaDeviceInfo.label`, which Chromium derives from
/// `localizedName` (optionally prefixed "Default - " and suffixed " (vid:pid)").
/// Mirrors `win/common/include/reelform/audio_devices.hpp`.
public enum MicSelection {
    public struct Resolution: Equatable, Sendable {
        /// Index into the device list; nil = ask AVFoundation for the default device.
        public var index: Int?
        /// A specific device was requested but not found, so the default is used.
        public var fellBack: Bool
        public init(index: Int?, fellBack: Bool) {
            self.index = index
            self.fellBack = fellBack
        }
    }

    public static func normalizeLabel(_ label: String) -> String {
        var l = label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for prefix in ["default - ", "communications - "] where l.hasPrefix(prefix) && l.count > prefix.count {
            l = String(l.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
            break
        }
        // Chromium appends " (046d:0825)" for USB devices.
        if let open = l.lastIndex(of: "("), l.hasSuffix(")") {
            let inner = l[l.index(after: open)..<l.index(before: l.endIndex)]
            let parts = inner.split(separator: ":", omittingEmptySubsequences: false)
            if parts.count == 2, parts.allSatisfy({ $0.count == 4 && $0.allSatisfy(\.isHexDigit) }) {
                l = String(l[..<open]).trimmingCharacters(in: .whitespaces)
            }
        }
        return l
    }

    static func isDefaultToken(_ id: String?) -> Bool {
        guard let id else { return true }
        return id.isEmpty || id == "default"
    }

    public static func resolve(devices: [MicDeviceDesc], requestedId: String?, label: String?) -> Resolution {
        if !isDefaultToken(requestedId), let i = devices.firstIndex(where: { $0.uniqueID == requestedId }) {
            return Resolution(index: i, fellBack: false)
        }
        let wanted = label.map(normalizeLabel) ?? ""
        if !wanted.isEmpty {
            if let i = devices.firstIndex(where: { normalizeLabel($0.name) == wanted }) {
                return Resolution(index: i, fellBack: false)
            }
            let hits = devices.indices.filter { i in
                let have = normalizeLabel(devices[i].name)
                return !have.isEmpty && (have.contains(wanted) || wanted.contains(have))
            }
            if hits.count == 1, let i = hits.first { return Resolution(index: i, fellBack: false) }
        }
        let requestedSpecific = !isDefaultToken(requestedId) || (!wanted.isEmpty && wanted != "default")
        return Resolution(index: devices.firstIndex(where: \.isDefault), fellBack: requestedSpecific)
    }
}
