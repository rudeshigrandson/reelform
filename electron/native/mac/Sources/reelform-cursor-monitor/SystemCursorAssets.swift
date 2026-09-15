import AppKit
import Foundation
import ReelformProtocol

/// System cursor extraction for the "macOS" cursor style (§5.3 / §9.2), plus
/// fingerprints used to detect the current cursor type.
enum SystemCursorAssets {
    /// Fingerprints are rendered at this many pixels per point so the same
    /// image yields identical bytes regardless of its backing representations.
    static let fingerprintScale: CGFloat = 2

    /// Every known cursor per kind (first entry is exported as the sprite).
    static func knownCursors() -> [(CursorKind, NSCursor)] {
        var list: [(CursorKind, NSCursor)] = [
            (.arrow, .arrow),
            (.ibeam, .iBeam),
            (.ibeam, .iBeamCursorForVerticalLayout),
            (.hand, .pointingHand),
            (.grab, .openHand),
            (.grab, .closedHand),
            (.resizeEW, .resizeLeftRight),
            (.resizeNS, .resizeUpDown),
        ]
        if #available(macOS 15.0, *) {
            list.append(contentsOf: [
                (.resizeEW, .columnResize),
                (.resizeNS, .rowResize),
                (.resizeNESW, .frameResize(position: .topRight, directions: .all)),
                (.resizeNESW, .frameResize(position: .bottomLeft, directions: .all)),
                (.resizeNWSE, .frameResize(position: .topLeft, directions: .all)),
                (.resizeNWSE, .frameResize(position: .bottomRight, directions: .all)),
            ])
        } else {
            list.append(contentsOf: [
                (.resizeEW, .resizeLeft), (.resizeEW, .resizeRight),
                (.resizeNS, .resizeUp), (.resizeNS, .resizeDown),
            ])
        }
        return list
    }

    static func makeClassifier() -> CursorClassifier {
        CursorClassifier(known: knownCursors().compactMap { kind, cursor in
            fingerprint(cursor).map { (kind, $0) }
        })
    }

    static func fingerprint(_ cursor: NSCursor?) -> CursorFingerprint? {
        guard let cursor else { return nil }
        let size = cursor.image.size
        guard size.width > 0, size.height > 0, let rep = render(cursor.image, scale: fingerprintScale),
              let data = rep.bitmapData
        else { return nil }
        let count = rep.bytesPerRow * rep.pixelsHigh
        let hash = fnv1a64(UnsafeBufferPointer(start: data, count: count))
        return CursorFingerprint(
            width: Int(size.width.rounded()), height: Int(size.height.rounded()),
            hotspotX: Int(cursor.hotSpot.x.rounded()), hotspotY: Int(cursor.hotSpot.y.rounded()),
            imageHash: hash
        )
    }

    static func render(_ image: NSImage, scale: CGFloat) -> NSBitmapImageRep? {
        let size = image.size
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: Int((size.width * scale).rounded()),
            pixelsHigh: Int((size.height * scale).rounded()),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 32
        ) else { return nil }
        rep.size = size
        NSGraphicsContext.saveGraphicsState()
        defer { NSGraphicsContext.restoreGraphicsState() }
        guard let context = NSGraphicsContext(bitmapImageRep: rep) else { return nil }
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        image.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .copy, fraction: 1)
        context.flushGraphics()
        return rep
    }

    /// Writes `<type>@2x.png` for each kind and `pack.json`; returns the assets.
    static func export(to dir: URL) throws -> [CursorAsset] {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var seen = Set<CursorKind>()
        var assets: [CursorAsset] = []
        for (kind, cursor) in knownCursors() where !seen.contains(kind) {
            seen.insert(kind)
            let size = cursor.image.size
            guard let rep = render(cursor.image, scale: 2),
                  let png = rep.representation(using: .png, properties: [:])
            else { continue }
            let asset = CursorAsset(kind: kind, hotspotX: cursor.hotSpot.x, hotspotY: cursor.hotSpot.y,
                                    width: size.width, height: size.height)
            try png.write(to: dir.appendingPathComponent(asset.file), options: .atomic)
            assets.append(asset)
        }
        let manifest = cursorPackManifest(name: "macOS", assets: assets)
        try Data(manifest.utf8).write(to: dir.appendingPathComponent("pack.json"), options: .atomic)
        return assets
    }
}
