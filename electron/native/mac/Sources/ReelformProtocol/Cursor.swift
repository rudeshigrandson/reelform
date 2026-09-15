import Foundation

/// Cursor types understood by the renderer's style packs (§6.6 / §9.2).
public enum CursorKind: String, CaseIterable, Sendable {
    case arrow
    case ibeam
    case hand
    case grab
    case resizeEW = "resize-ew"
    case resizeNS = "resize-ns"
    case resizeNESW = "resize-nesw"
    case resizeNWSE = "resize-nwse"
}

public enum MouseButton: String, Sendable {
    case left, middle, right

    /// CGMouseButton / NSEvent.buttonNumber: 0 left, 1 right, 2+ other → middle.
    public static func from(buttonNumber: Int) -> MouseButton {
        switch buttonNumber {
        case 0: return .left
        case 1: return .right
        default: return .middle
        }
    }
}

public enum ClickPhase: String, Sendable { case down, up }

/// Modifier bitmask emitted with key events. Stable across helpers/OSes.
public enum Modifier {
    public static let shift = 1
    public static let control = 2
    public static let option = 4
    public static let command = 8
    public static let function = 16
    public static let capsLock = 32

    // CGEventFlags / NSEvent.ModifierFlags device-independent bits (identical).
    static let cgAlphaShift: UInt64 = 0x0001_0000
    static let cgShift: UInt64 = 0x0002_0000
    static let cgControl: UInt64 = 0x0004_0000
    static let cgAlternate: UInt64 = 0x0008_0000
    static let cgCommand: UInt64 = 0x0010_0000
    static let cgSecondaryFn: UInt64 = 0x0080_0000

    public static func mask(fromEventFlags raw: UInt64) -> Int {
        var m = 0
        if raw & cgShift != 0 { m |= shift }
        if raw & cgControl != 0 { m |= control }
        if raw & cgAlternate != 0 { m |= option }
        if raw & cgCommand != 0 { m |= command }
        if raw & cgSecondaryFn != 0 { m |= function }
        if raw & cgAlphaShift != 0 { m |= capsLock }
        return m
    }
}

/// Identity of a cursor image, cheap to compare every sample.
public struct CursorFingerprint: Hashable, Sendable {
    public var width: Int
    public var height: Int
    public var hotspotX: Int
    public var hotspotY: Int
    public var imageHash: UInt64

    public init(width: Int, height: Int, hotspotX: Int, hotspotY: Int, imageHash: UInt64) {
        self.width = width
        self.height = height
        self.hotspotX = hotspotX
        self.hotspotY = hotspotY
        self.imageHash = imageHash
    }
}

/// FNV-1a 64-bit — deterministic across launches (unlike `Hasher`).
public func fnv1a64(_ bytes: some Sequence<UInt8>) -> UInt64 {
    var h: UInt64 = 0xcbf2_9ce4_8422_2325
    for b in bytes {
        h ^= UInt64(b)
        h = h &* 0x0000_0100_0000_01b3
    }
    return h
}

/// Classifies the current system cursor against fingerprints of known
/// `NSCursor`s. Exact match first; otherwise geometry-only match (same size and
/// hotspot) when unambiguous; otherwise `arrow`.
public struct CursorClassifier: Sendable {
    private var exact: [CursorFingerprint: CursorKind] = [:]
    private var geometry: [String: Set<CursorKind>] = [:]

    public init(known: [(CursorKind, CursorFingerprint)]) {
        for (kind, fp) in known {
            if exact[fp] == nil { exact[fp] = kind }
            geometry[Self.geometryKey(fp), default: []].insert(kind)
        }
    }

    static func geometryKey(_ fp: CursorFingerprint) -> String {
        "\(fp.width)x\(fp.height)@\(fp.hotspotX),\(fp.hotspotY)"
    }

    public func classify(_ fp: CursorFingerprint?) -> CursorKind {
        guard let fp else { return .arrow }
        if let kind = exact[fp] { return kind }
        if let kinds = geometry[Self.geometryKey(fp)], kinds.count == 1, let only = kinds.first {
            return only
        }
        return .arrow
    }
}

/// Cocoa global coordinates (origin bottom-left of the primary display) →
/// CoreGraphics global coordinates (origin top-left of the primary display),
/// the space `SCDisplay.frame` / `CGWindowBounds` use. Points, not pixels.
public func cocoaToGlobalTopLeft(x: Double, y: Double, primaryDisplayHeight: Double) -> (x: Double, y: Double) {
    (x, primaryDisplayHeight - y)
}

/// Emits a move sample only when position or cursor type changed.
public struct MoveDeduper: Sendable {
    private var last: (Double, Double, CursorKind)?
    public init() {}

    public mutating func shouldEmit(x: Double, y: Double, cursor: CursorKind) -> Bool {
        if let l = last, l.0 == x, l.1 == y, l.2 == cursor { return false }
        last = (x, y, cursor)
        return true
    }

    public mutating func reset() { last = nil }
}

/// One exported cursor sprite for the "macOS" style pack.
public struct CursorAsset: Equatable, Sendable {
    public var kind: CursorKind
    public var file: String
    /// Hotspot in @1x points.
    public var hotspotX: Double
    public var hotspotY: Double
    /// Size in @1x points (the PNG is 2× this).
    public var width: Double
    public var height: Double

    public init(kind: CursorKind, hotspotX: Double, hotspotY: Double, width: Double, height: Double) {
        self.kind = kind
        file = "\(kind.rawValue)@2x.png"
        self.hotspotX = hotspotX
        self.hotspotY = hotspotY
        self.width = width
        self.height = height
    }

    public var json: JSONValue {
        .object([
            ("type", .string(kind.rawValue)),
            ("file", .string(file)),
            ("hotspot", .array([.double(hotspotX), .double(hotspotY)])),
            ("size", .array([.double(width), .double(height)])),
        ])
    }
}

/// `pack.json` for `assets/cursors/<pack>/` (§9.2).
public func cursorPackManifest(name: String, assets: [CursorAsset]) -> String {
    let cursors: [(String, JSONValue)] = assets.map { asset in
        (asset.kind.rawValue, .object([
            ("file", .string(asset.file)),
            ("hotspot", .array([.double(asset.hotspotX), .double(asset.hotspotY)])),
            ("size", .array([.double(asset.width), .double(asset.height)])),
        ]))
    }
    return JSONValue.object([
        ("name", .string(name)),
        ("scale", .int(2)),
        ("cursors", .object(cursors)),
    ]).serialized()
}
