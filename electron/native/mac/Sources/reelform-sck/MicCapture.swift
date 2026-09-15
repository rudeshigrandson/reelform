import AVFoundation
import CoreMedia
import Foundation
import ReelformProtocol

/// Microphone capture via `AVCaptureSession` (§5.3). Delivers sample buffers
/// with presentation times converted to the host clock so they share a
/// timebase with ScreenCaptureKit frames.
final class MicCapture: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    private let session = AVCaptureSession()
    private let output = AVCaptureAudioDataOutput()
    private let onSample: (CMSampleBuffer, Int64) -> Void
    private let onRuntimeError: (String) -> Void
    private var observer: NSObjectProtocol?

    /// `deviceId` (uniqueID, or a Chromium deviceId that never matches) and `label`
    /// are resolved by `MicSelection`; nothing matching selects the system default input.
    init(deviceId: String?, label: String? = nil, queue: DispatchQueue,
         onSample: @escaping (CMSampleBuffer, Int64) -> Void,
         onRuntimeError: @escaping (String) -> Void) throws {
        self.onSample = onSample
        self.onRuntimeError = onRuntimeError
        super.init()

        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            throw RecorderError.permission("microphone access not granted")
        }
        let device = Self.resolveDevice(deviceId: deviceId, label: label)
        guard let device else { throw RecorderError.mic("microphone not found: \(label ?? deviceId ?? "default")") }
        let input: AVCaptureDeviceInput
        do {
            input = try AVCaptureDeviceInput(device: device)
        } catch {
            throw RecorderError.mic(error.localizedDescription)
        }
        session.beginConfiguration()
        guard session.canAddInput(input), session.canAddOutput(output) else {
            session.commitConfiguration()
            throw RecorderError.mic("cannot configure capture session")
        }
        session.addInput(input)
        session.addOutput(output)
        session.commitConfiguration()
        output.setSampleBufferDelegate(self, queue: queue)

        observer = NotificationCenter.default.addObserver(
            forName: .AVCaptureSessionRuntimeError, object: session, queue: nil
        ) { [weak self] note in
            let err = note.userInfo?[AVCaptureSessionErrorKey] as? Error
            self?.onRuntimeError(err?.localizedDescription ?? "capture session runtime error")
        }
    }

    private static func resolveDevice(deviceId: String?, label: String?) -> AVCaptureDevice? {
        let discovered = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified
        ).devices
        let fallback = AVCaptureDevice.default(for: .audio)
        let descs = discovered.map {
            MicDeviceDesc(uniqueID: $0.uniqueID, name: $0.localizedName, isDefault: $0.uniqueID == fallback?.uniqueID)
        }
        let pick = MicSelection.resolve(devices: descs, requestedId: deviceId, label: label)
        if pick.fellBack {
            FileHandle.standardError.write(Data("[mic] \(label ?? deviceId ?? "?") not found; using the default input\n".utf8))
        }
        if let i = pick.index, discovered.indices.contains(i) { return discovered[i] }
        return fallback
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    func start() { session.startRunning() }

    func stop() {
        output.setSampleBufferDelegate(nil, queue: nil)
        if session.isRunning { session.stopRunning() }
    }

    func captureOutput(_: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from _: AVCaptureConnection) {
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let host = CMClockGetHostTimeClock()
        let converted = session.synchronizationClock.map { CMSyncConvertTime(pts, from: $0, to: host) } ?? pts
        guard let ns = nanoseconds(converted) else { return }
        onSample(sampleBuffer, ns)
    }
}
