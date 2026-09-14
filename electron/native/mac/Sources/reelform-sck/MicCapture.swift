import AVFoundation
import CoreMedia
import Foundation

/// Microphone capture via `AVCaptureSession` (§5.3). Delivers sample buffers
/// with presentation times converted to the host clock so they share a
/// timebase with ScreenCaptureKit frames.
final class MicCapture: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    private let session = AVCaptureSession()
    private let output = AVCaptureAudioDataOutput()
    private let onSample: (CMSampleBuffer, Int64) -> Void
    private let onRuntimeError: (String) -> Void
    private var observer: NSObjectProtocol?

    /// `deviceId` nil or "default" selects the system default input.
    init(deviceId: String?, queue: DispatchQueue,
         onSample: @escaping (CMSampleBuffer, Int64) -> Void,
         onRuntimeError: @escaping (String) -> Void) throws {
        self.onSample = onSample
        self.onRuntimeError = onRuntimeError
        super.init()

        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            throw RecorderError.permission("microphone access not granted")
        }
        let device: AVCaptureDevice?
        if let deviceId, deviceId != "default" {
            device = AVCaptureDevice(uniqueID: deviceId)
        } else {
            device = AVCaptureDevice.default(for: .audio)
        }
        guard let device else { throw RecorderError.mic("microphone not found: \(deviceId ?? "default")") }
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
