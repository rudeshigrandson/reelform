import AppKit
import CoreGraphics
import Foundation
import ReelformProtocol

/// Samples cursor position at 120Hz and listens for clicks/keys/scrolls while
/// recording (§5.3). Main-thread only (AppKit + run-loop event tap).
///
/// Coordinates are CoreGraphics global points (origin top-left of the primary
/// display); timestamps are host-clock ns so main can rebase against the
/// capture helper's `firstFramePtsNs`. Keys carry virtual key codes and
/// modifier masks only — never characters — and only between start and stop.
final class CursorMonitor {
    static let defaultHz = 120
    /// Cursor-type detection costs a small bitmap render; do it every Nth tick.
    static let cursorTypeEveryTicks = 4

    private let out: LineWriter
    private let clock: HostClock
    private var running = false
    private var paused = false
    private var samples = 0
    private var tick = 0

    private var timer: DispatchSourceTimer?
    private var deduper = MoveDeduper()
    private var currentCursor: CursorKind = .arrow
    private lazy var classifier = SystemCursorAssets.makeClassifier()

    private var tap: CFMachPort?
    private var tapSource: CFRunLoopSource?
    private var globalMonitor: Any?

    init(out: LineWriter, clock: HostClock) {
        self.out = out
        self.clock = clock
    }

    private func emit(_ event: CursorEvent) { out.send(event.encode()) }

    func handle(line: String) {
        let command: CursorCommand
        do {
            command = try CursorCommand.decode(line)
        } catch let error as ProtocolError {
            emit(.error(id: peekId(line), code: error.code, message: error.description))
            return
        } catch {
            emit(.error(id: peekId(line), code: "badRequest", message: "\(error)"))
            return
        }
        switch command {
        case let .ping(id):
            emit(.pong(id: id))
        case let .start(id):
            guard !running else { return invalid(id, "start while running") }
            start(id: id)
        case let .pause(id):
            guard running, !paused else { return invalid(id, "pause while not recording") }
            paused = true
        case let .resume(id):
            guard running, paused else { return invalid(id, "resume while not paused") }
            paused = false
            deduper.reset()
        case let .stop(id):
            guard running else { return invalid(id, "stop while not running") }
            stop(id: id)
        case let .exportCursors(id, dir):
            do {
                let files = try SystemCursorAssets.export(to: URL(fileURLWithPath: dir, isDirectory: true))
                emit(.cursorsExported(id: id, dir: dir, files: files))
            } catch {
                emit(.error(id: id, code: "exportFailed", message: "\(error)"))
            }
        }
    }

    func parentGone() {
        if running { teardown() }
        out.flush()
        exit(0)
    }

    private func invalid(_ id: Int64?, _ message: String) {
        emit(.error(id: id, code: "invalidState", message: message))
    }

    // MARK: Lifecycle

    private func start(id: Int64?) {
        running = true
        paused = false
        samples = 0
        deduper.reset()
        let source = installEventTap() ? ClickSource.eventTap : installGlobalMonitor()
        emit(.started(id: id, hostTimeNs: clock.nowNs(), sampleHz: Self.defaultHz,
                      clickSource: source, keys: source == .eventTap))

        let timer = DispatchSource.makeTimerSource(flags: .strict, queue: .main)
        let interval = DispatchTimeInterval.nanoseconds(1_000_000_000 / Self.defaultHz)
        timer.schedule(deadline: .now(), repeating: interval, leeway: .nanoseconds(0))
        timer.setEventHandler { [weak self] in self?.sample() }
        timer.resume()
        self.timer = timer
    }

    private func stop(id: Int64?) {
        teardown()
        emit(.stopped(id: id, samples: samples))
        out.flush()
        exit(0)
    }

    private func teardown() {
        running = false
        timer?.cancel()
        timer = nil
        if let tap {
            CGEvent.tapEnable(tap: tap, enable: false)
            CFMachPortInvalidate(tap)
        }
        if let tapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), tapSource, .commonModes) }
        tap = nil
        tapSource = nil
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        globalMonitor = nil
    }

    // MARK: Sampling

    private func primaryHeight() -> Double {
        Double(CGDisplayBounds(CGMainDisplayID()).height)
    }

    private func sample() {
        guard running, !paused else { return }
        let t = clock.nowNs()
        if tick % Self.cursorTypeEveryTicks == 0 {
            currentCursor = classifier.classify(SystemCursorAssets.fingerprint(NSCursor.currentSystem))
        }
        tick &+= 1
        let loc = NSEvent.mouseLocation
        let p = cocoaToGlobalTopLeft(x: loc.x, y: loc.y, primaryDisplayHeight: primaryHeight())
        guard deduper.shouldEmit(x: p.x, y: p.y, cursor: currentCursor) else { return }
        samples += 1
        emit(.move(tNs: t, x: p.x, y: p.y, cursor: currentCursor))
    }

    // MARK: Event tap (clicks + keys + scroll)

    private func installEventTap() -> Bool {
        let types: [CGEventType] = [
            .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
            .otherMouseDown, .otherMouseUp, .keyDown, .scrollWheel,
        ]
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        let callback: CGEventTapCallBack = { _, type, event, userInfo in
            if let userInfo {
                let monitor = Unmanaged<CursorMonitor>.fromOpaque(userInfo).takeUnretainedValue()
                monitor.onTapEvent(type: type, event: event)
            }
            return Unmanaged.passUnretained(event)
        }
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
            eventsOfInterest: mask, callback: callback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else { return false }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        self.tap = tap
        tapSource = source
        return true
    }

    private func onTapEvent(type: CGEventType, event: CGEvent) {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return
        default:
            break
        }
        guard running, !paused else { return }
        let t = clock.nowNs()
        let loc = event.location
        switch type {
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            let button = MouseButton.from(buttonNumber: Int(event.getIntegerValueField(.mouseEventButtonNumber)))
            emit(.click(tNs: t, x: loc.x, y: loc.y, button: button, phase: .down))
        case .leftMouseUp, .rightMouseUp, .otherMouseUp:
            let button = MouseButton.from(buttonNumber: Int(event.getIntegerValueField(.mouseEventButtonNumber)))
            emit(.click(tNs: t, x: loc.x, y: loc.y, button: button, phase: .up))
        case .keyDown:
            guard event.getIntegerValueField(.keyboardEventAutorepeat) == 0 else { return }
            let code = Int(event.getIntegerValueField(.keyboardEventKeycode))
            emit(.key(tNs: t, keyCode: code, modifiers: Modifier.mask(fromEventFlags: event.flags.rawValue)))
        case .scrollWheel:
            let dy = Double(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1))
            let dx = Double(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis2))
            emit(.scroll(tNs: t, dx: dx, dy: dy))
        default:
            break
        }
    }

    // MARK: Fallback (no Input Monitoring permission): clicks + scroll, no keys

    private func installGlobalMonitor() -> ClickSource {
        let mask: NSEvent.EventTypeMask = [
            .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
            .otherMouseDown, .otherMouseUp, .scrollWheel,
        ]
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] event in
            self?.onGlobalEvent(event)
        }
        return .globalMonitor
    }

    private func onGlobalEvent(_ event: NSEvent) {
        guard running, !paused else { return }
        let t = clock.nowNs()
        let loc = NSEvent.mouseLocation
        let p = cocoaToGlobalTopLeft(x: loc.x, y: loc.y, primaryDisplayHeight: primaryHeight())
        switch event.type {
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            emit(.click(tNs: t, x: p.x, y: p.y, button: MouseButton.from(buttonNumber: event.buttonNumber), phase: .down))
        case .leftMouseUp, .rightMouseUp, .otherMouseUp:
            emit(.click(tNs: t, x: p.x, y: p.y, button: MouseButton.from(buttonNumber: event.buttonNumber), phase: .up))
        case .scrollWheel:
            emit(.scroll(tNs: t, dx: Double(event.scrollingDeltaX), dy: Double(event.scrollingDeltaY)))
        default:
            break
        }
    }
}
