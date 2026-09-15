import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ReelformProtocol
import ScreenCaptureKit
import UniformTypeIdentifiers

/// `listSources` (§5.1): displays + normal app windows via `SCShareableContent`,
/// with PNG thumbnails from `SCScreenshotManager`. Thumbnails are best effort —
/// a capture that fails or misses the deadline is simply omitted, so the picker
/// always gets the list within main's request timeout.
enum SourceLister {
    struct Listing {
        var displays: [ListedDisplay]
        var windows: [ListedWindow]
    }

    /// Main's request timeout is 10s; leave headroom for listing + encoding.
    static let thumbnailDeadline: TimeInterval = 6
    static let maxWindowThumbnails = 60
    static let concurrentCaptures = 4

    static func list(thumbnailWidth: Int, completion: @escaping (Result<Listing, RecorderError>) -> Void) {
        guard Permissions.screenGranted() else {
            completion(.failure(.permission("screen recording access not granted")))
            return
        }
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, error in
            guard let content else {
                completion(.failure(RecorderError.from(shareableContentError: error)))
                return
            }
            DispatchQueue.global(qos: .userInitiated).async {
                completion(.success(build(content: content, thumbnailWidth: thumbnailWidth)))
            }
        }
    }

    private static func build(content: SCShareableContent, thumbnailWidth: Int) -> Listing {
        let names = displayNames()
        let displayFrames = content.displays.map { (id: $0.displayID, frame: rect($0.frame)) }
        var displays: [ListedDisplay] = content.displays.enumerated().map { index, d in
            let filter = SCContentFilter(display: d, excludingWindows: [])
            return ListedDisplay(
                id: d.displayID,
                name: names[d.displayID] ?? "Display \(index + 1)",
                bounds: rect(d.frame),
                scaleFactor: Double(filter.pointPixelScale)
            )
        }

        let excluded: Set<Int32> = [getpid(), getppid()]
        let scWindows = content.windows.filter { w in
            SourceListing.includeWindow(layer: w.windowLayer, isOnScreen: w.isOnScreen, frame: rect(w.frame),
                                        ownerPid: w.owningApplication?.processID, excludedPids: excluded)
        }
        var windows: [ListedWindow] = scWindows.map { w in
            let app = w.owningApplication
            return ListedWindow(
                id: w.windowID,
                title: SourceListing.displayTitle(title: w.title, appName: app?.applicationName),
                appName: app.flatMap { $0.applicationName.isEmpty ? nil : $0.applicationName },
                bundleId: app.flatMap { $0.bundleIdentifier.isEmpty ? nil : $0.bundleIdentifier },
                pid: app?.processID,
                bounds: rect(w.frame),
                displayId: SourceListing.displayFor(window: rect(w.frame), displays: displayFrames)
            )
        }

        guard thumbnailWidth > 0 else { return Listing(displays: displays, windows: windows) }

        var jobs: [(key: String, filter: SCContentFilter, frame: CGRect, scale: Double)] = []
        for (d, listed) in zip(content.displays, displays) {
            jobs.append(("d\(d.displayID)", SCContentFilter(display: d, excludingWindows: []), d.frame, listed.scaleFactor))
        }
        for w in scWindows.prefix(maxWindowThumbnails) {
            jobs.append(("w\(w.windowID)", SCContentFilter(desktopIndependentWindow: w), w.frame, 1))
        }
        let thumbs = captureThumbnails(jobs, width: thumbnailWidth)
        for i in displays.indices { displays[i].thumbnail = thumbs["d\(displays[i].id)"] }
        for i in windows.indices { windows[i].thumbnail = thumbs["w\(windows[i].id)"] }
        return Listing(displays: displays, windows: windows)
    }

    /// Results written by capture callbacks; closed once the deadline passes so
    /// late completions cannot race the snapshot.
    private final class ThumbnailResults: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [String: String] = [:]
        private var closed = false

        func set(_ key: String, _ value: String) {
            lock.lock()
            defer { lock.unlock() }
            if !closed { values[key] = value }
        }

        func close() -> [String: String] {
            lock.lock()
            defer { lock.unlock() }
            closed = true
            return values
        }
    }

    private static func captureThumbnails(_ jobs: [(key: String, filter: SCContentFilter, frame: CGRect, scale: Double)],
                                          width: Int) -> [String: String] {
        let results = ThumbnailResults()
        let group = DispatchGroup()
        let slots = DispatchSemaphore(value: concurrentCaptures)
        let deadline = DispatchTime.now() + thumbnailDeadline

        for job in jobs {
            guard slots.wait(timeout: deadline) == .success else { break }
            group.enter()
            let size = SourceListing.thumbnailSize(width: job.frame.width, height: job.frame.height, maxWidth: width)
            let config = SCStreamConfiguration()
            config.width = size.width
            config.height = size.height
            config.showsCursor = false
            config.scalesToFit = true
            config.capturesAudio = false
            SCScreenshotManager.captureImage(contentFilter: job.filter, configuration: config) { image, _ in
                defer {
                    slots.signal()
                    group.leave()
                }
                guard let image, let png = pngData(image) else { return }
                results.set(job.key, SourceListing.dataURL(png: png))
            }
        }
        _ = group.wait(timeout: deadline)
        return results.close()
    }

    static func pngData(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(dest, image, nil)
        return CGImageDestinationFinalize(dest) ? data as Data : nil
    }

    private static func rect(_ r: CGRect) -> SourceRect {
        SourceRect(x: Double(r.origin.x), y: Double(r.origin.y), width: Double(r.width), height: Double(r.height))
    }

    /// `NSScreen.localizedName` by CGDirectDisplayID (AppKit on the main queue).
    private static func displayNames() -> [UInt32: String] {
        let read = { () -> [UInt32: String] in
            var names: [UInt32: String] = [:]
            for screen in NSScreen.screens {
                let key = NSDeviceDescriptionKey("NSScreenNumber")
                if let number = screen.deviceDescription[key] as? NSNumber {
                    names[number.uint32Value] = screen.localizedName
                }
            }
            return names
        }
        return Thread.isMainThread ? read() : DispatchQueue.main.sync(execute: read)
    }
}
