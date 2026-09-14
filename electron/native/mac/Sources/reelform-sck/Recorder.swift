import AVFoundation
import CoreMedia
import Foundation
import ReelformProtocol
import ScreenCaptureKit

/// One recording session per process (§5.3). All mutable state lives on
/// `queue`: stdin commands, SCStream samples, mic samples and the stats timer
/// are all funnelled through it.
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private let out: LineWriter
    private let clock: HostClock
    private let queue = DispatchQueue(label: "reelform.sck.session")

    private var state: SessionState = .idle
    private var options: StartOptions?
    private var startId: Int64?

    private var stream: SCStream?
    private var video: Writers.Video?
    private var system: Writers.Audio?
    private var micWriter: Writers.Audio?
    private var mic: MicCapture?
    private var paths: RecordingPaths?

    private var pause = PauseTracker()
    private var fps = FpsWindow()
    private var firstFramePtsNs: Int64?
    private var lastAppendedPtsNs: Int64?
    private var startHostTimeNs: Int64 = 0
    private var size = (width: 0, height: 0, scale: 1.0)
    private var statsTimer: DispatchSourceTimer?

    init(out: LineWriter, clock: HostClock) {
        self.out = out
        self.clock = clock
    }

    // MARK: Commands

    func handle(line: String) {
        queue.async { self.dispatch(line) }
    }

    func parentGone() {
        queue.async {
            switch self.state {
            case .idle, .finished:
                self.exitProcess()
            case .starting, .recording, .paused:
                self.emit(.interrupted(reason: .parentGone, message: "stdin closed"))
                self.stop(id: nil, discard: false)
            case .stopping:
                break
            }
        }
    }

    private func dispatch(_ line: String) {
        let command: SckCommand
        do {
            command = try SckCommand.decode(line)
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
        case let .start(id, opts):
            guard gate("start", id: id) else { return }
            start(id: id, options: opts)
        case let .pause(id):
            guard gate("pause", id: id) else { return }
            pause.pause(atNs: clock.nowNs())
        case let .resume(id):
            guard gate("resume", id: id) else { return }
            pause.resume(atNs: clock.nowNs())
        case let .stop(id):
            guard gate("stop", id: id) else { return }
            stop(id: id, discard: false)
        case let .discard(id):
            guard gate("discard", id: id) else { return }
            stop(id: id, discard: true)
        }
    }

    /// Applies the transition or emits `invalidState`.
    private func gate(_ command: String, id: Int64?) -> Bool {
        guard let next = SessionTransition.next(state, command) else {
            emit(.error(id: id, code: "invalidState", message: "\(command) not allowed while \(state.rawValue)"))
            return false
        }
        state = next
        return true
    }

    private func emit(_ event: SckEvent) { out.send(event.encode()) }

    // MARK: Start

    private func start(id: Int64?, options opts: StartOptions) {
        startId = id
        options = opts
        guard Permissions.screenGranted() else {
            fail(RecorderError.permission("screen recording access not granted"))
            return
        }
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) { content, error in
            self.queue.async {
                guard self.state == .starting else { return }
                guard let content else {
                    self.fail(RecorderError.stream(error?.localizedDescription ?? "shareable content unavailable"))
                    return
                }
                do {
                    try self.configureAndStart(content: content, options: opts)
                } catch {
                    self.fail(error)
                }
            }
        }
    }

    private func configureAndStart(content: SCShareableContent, options opts: StartOptions) throws {
        let filter: SCContentFilter
        switch opts.source {
        case let .display(displayId, excludePids):
            guard let display = content.displays.first(where: { $0.displayID == displayId }) else {
                throw RecorderError.sourceNotFound("display \(displayId) not found")
            }
            let excluded = content.applications.filter { excludePids.contains($0.processID) }
            filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
        case let .window(windowId):
            guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
                throw RecorderError.sourceNotFound("window \(windowId) not found")
            }
            filter = SCContentFilter(desktopIndependentWindow: window)
        }

        let scale = Double(filter.pointPixelScale)
        let config = SCStreamConfiguration()
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = false
        config.capturesAudio = opts.systemAudio
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(opts.fps))
        config.queueDepth = 8
        config.scalesToFit = false
        if let region = opts.region {
            let rect = CGRect(x: region.x, y: region.y, width: region.width, height: region.height)
            let bounds = CGRect(origin: .zero, size: filter.contentRect.size)
            guard bounds.contains(rect) else {
                throw RecorderError.sourceNotFound("region outside display bounds")
            }
            config.sourceRect = rect
            config.width = evenDimension(region.width * scale)
            config.height = evenDimension(region.height * scale)
        } else {
            config.width = evenDimension(Double(filter.contentRect.width) * scale)
            config.height = evenDimension(Double(filter.contentRect.height) * scale)
        }
        size = (config.width, config.height, scale)

        let dir = URL(fileURLWithPath: opts.outputDir, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let screenURL = dir.appendingPathComponent("screen.mp4")
        let systemURL = dir.appendingPathComponent("system.m4a")
        let micURL = dir.appendingPathComponent("mic.m4a")

        video = try Writers.video(url: screenURL, width: config.width, height: config.height, fps: opts.fps)
        if opts.systemAudio {
            system = try Writers.aac(url: systemURL, channels: 2, bitRate: BitrateTable.systemAudioBitsPerSecond)
        }
        if let micId = opts.micDeviceId {
            micWriter = try Writers.aac(url: micURL, channels: 1, bitRate: 128_000)
            mic = try MicCapture(
                deviceId: micId, queue: queue,
                onSample: { [weak self] sb, ns in self?.appendAudio(sb, hostNs: ns, to: self?.micWriter) },
                onRuntimeError: { [weak self] message in
                    self?.queue.async { self?.interrupt(.deviceLost, message) }
                }
            )
        }
        paths = RecordingPaths(
            screen: screenURL.path,
            system: opts.systemAudio ? systemURL.path : nil,
            mic: opts.micDeviceId != nil ? micURL.path : nil
        )

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        if opts.systemAudio {
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        }
        self.stream = stream
        startHostTimeNs = clock.nowNs()
        mic?.start()
        stream.startCapture { error in
            guard let error else { return }
            self.queue.async {
                if self.state == .starting { self.fail(RecorderError.stream(error.localizedDescription)) }
            }
        }
        startStatsTimer()
    }

    /// Start failed: report, release everything, remove partial files, exit.
    private func fail(_ error: Error) {
        let code = (error as? RecorderError)?.code ?? "internal"
        emit(.error(id: startId, code: code, message: "\(error)"))
        teardownCapture()
        video?.writer.cancelWriting()
        system?.writer.cancelWriting()
        micWriter?.writer.cancelWriting()
        removeFiles()
        state = .finished
        exitProcess()
    }

    // MARK: Samples

    func stream(_: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard sampleBuffer.isValid else { return }
        switch type {
        case .screen: appendVideo(sampleBuffer)
        case .audio:
            guard let ns = nanoseconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)) else { return }
            appendAudio(sampleBuffer, hostNs: ns, to: system)
        default: break
        }
    }

    private func appendVideo(_ sb: CMSampleBuffer) {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false)
            as? [[SCStreamFrameInfo: Any]],
            let rawStatus = attachments.first?[.status] as? Int,
            let status = SCFrameStatus(rawValue: rawStatus), status == .complete,
            let pixelBuffer = CMSampleBufferGetImageBuffer(sb),
            let ptsNs = nanoseconds(CMSampleBufferGetPresentationTimeStamp(sb)),
            let video
        else { return }

        if firstFramePtsNs == nil {
            guard state == .starting else { return }
            firstFramePtsNs = ptsNs
            let t = cmTime(ns: ptsNs)
            video.writer.startSession(atSourceTime: t)
            system?.writer.startSession(atSourceTime: t)
            micWriter?.writer.startSession(atSourceTime: t)
            state = SessionTransition.next(state, "started") ?? state
            emit(.started(id: startId, firstFramePtsNs: ptsNs, startHostTimeNs: startHostTimeNs,
                          width: size.width, height: size.height, scaleFactor: size.scale))
        }
        guard state == .recording || state == .paused else { return }
        guard case let .append(outNs) = pause.decide(ptsNs: ptsNs) else { return }
        if let last = lastAppendedPtsNs, outNs <= last { return }
        guard video.input.isReadyForMoreMediaData else {
            fps.recordDrop()
            return
        }
        if video.adaptor.append(pixelBuffer, withPresentationTime: cmTime(ns: outNs)) {
            fps.recordAppend(atNs: ptsNs)
            lastAppendedPtsNs = outNs
        } else if video.writer.status == .failed {
            interrupt(.writerFailed, video.writer.error?.localizedDescription ?? "video writer failed")
        }
    }

    private func appendAudio(_ sb: CMSampleBuffer, hostNs: Int64, to audio: Writers.Audio?) {
        guard let audio, let first = firstFramePtsNs, hostNs >= first,
              state == .recording || state == .paused,
              case let .append(outNs) = pause.decide(ptsNs: hostNs),
              audio.input.isReadyForMoreMediaData,
              let retimed = Writers.retimed(sb, ptsNs: outNs)
        else { return }
        if !audio.input.append(retimed), audio.writer.status == .failed {
            interrupt(.writerFailed, audio.writer.error?.localizedDescription ?? "audio writer failed")
        }
    }

    // MARK: Interruptions

    func stream(_: SCStream, didStopWithError error: Error) {
        let reason: InterruptReason
        if let scError = error as? SCStreamError, scError.code == .userStopped {
            reason = .streamStopped
        } else {
            reason = .sourceLost
        }
        queue.async { self.interrupt(reason, error.localizedDescription) }
    }

    private func interrupt(_ reason: InterruptReason, _ message: String) {
        switch state {
        case .starting:
            fail(RecorderError.stream(message))
        case .recording, .paused:
            emit(.interrupted(reason: reason, message: message))
            state = .stopping
            stop(id: nil, discard: false)
        default:
            break
        }
    }

    // MARK: Stop / discard

    private func stop(id: Int64?, discard: Bool) {
        state = .stopping
        teardownCapture()
        let stopNs = clock.nowNs()

        guard firstFramePtsNs != nil, !discard else {
            video?.writer.cancelWriting()
            system?.writer.cancelWriting()
            micWriter?.writer.cancelWriting()
            removeFiles()
            if !discard {
                emit(.error(id: id, code: "noFrames", message: "stopped before the first frame was captured"))
            }
            finish(id: id, durationMs: 0, paths: nil, discarded: discard)
            return
        }

        // End every session at the same output time so tracks stay aligned and
        // the video is not cut short when the screen was static before stop
        // (SCK delivers no frames for an unchanged screen).
        let endOutNs = max(pause.outputTimeNs(atHostNs: stopNs), lastAppendedPtsNs ?? 0)
        let group = DispatchGroup()
        for writer in [video?.writer, system?.writer, micWriter?.writer].compactMap({ $0 }) {
            // AVAssetWriter raises on finish/endSession unless status is .writing
            // (e.g. after a writer failure that triggered this stop).
            guard writer.status == .writing else { continue }
            writer.endSession(atSourceTime: cmTime(ns: endOutNs))
            for input in writer.inputs { input.markAsFinished() }
            group.enter()
            writer.finishWriting { group.leave() }
        }
        group.notify(queue: queue) {
            let first = self.firstFramePtsNs ?? 0
            let durationNs = self.pause.activeDurationNs(firstNs: first, endNs: stopNs)
            if self.video?.writer.status != .completed {
                self.emit(.error(id: id, code: "writerFailed",
                                 message: self.video?.writer.error?.localizedDescription ?? "finalize failed"))
            }
            // Only report audio files that finalized; the screen path is kept
            // even on failure because fragmented output may still be playable.
            let completed = { (w: Writers.Audio?) in w?.writer.status == .completed }
            let reported = self.paths.map {
                RecordingPaths(screen: $0.screen,
                               system: completed(self.system) ? $0.system : nil,
                               mic: completed(self.micWriter) ? $0.mic : nil)
            }
            self.finish(id: id, durationMs: durationNs / 1_000_000, paths: reported, discarded: false)
        }
    }

    private func finish(id: Int64?, durationMs: Int64, paths: RecordingPaths?, discarded: Bool) {
        var ranges = pause.ranges
        if let open = pause.pausedAtNs { ranges.append(PausedRange(startNs: open, endNs: clock.nowNs())) }
        emit(.stopped(id: id, durationMs: durationMs, paths: paths, pausedRanges: ranges, discarded: discarded))
        state = .finished
        exitProcess()
    }

    private func teardownCapture() {
        statsTimer?.cancel()
        statsTimer = nil
        mic?.stop()
        if let stream {
            stream.stopCapture { _ in }
            self.stream = nil
        }
    }

    private func removeFiles() {
        guard let opts = options else { return }
        let dir = URL(fileURLWithPath: opts.outputDir, isDirectory: true)
        for name in ["screen.mp4", "system.m4a", "mic.m4a"] {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(name))
        }
    }

    private func exitProcess() {
        out.flush()
        exit(0)
    }

    // MARK: Stats

    private func startStatsTimer() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in self?.emitStats() }
        timer.resume()
        statsTimer = timer
    }

    private func emitStats() {
        guard state == .recording || state == .paused else { return }
        let bytes = [paths?.screen, paths?.system, paths?.mic].compactMap { $0 }.reduce(Int64(0)) { sum, path in
            let attrs = try? FileManager.default.attributesOfItem(atPath: path)
            return sum + ((attrs?[.size] as? NSNumber)?.int64Value ?? 0)
        }
        let rate = fps.fps(nowNs: clock.nowNs())
        emit(.stats(fps: rate, droppedFrames: fps.dropped, fileBytes: bytes))
    }
}
