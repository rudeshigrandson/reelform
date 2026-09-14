import AVFoundation
import CoreGraphics
import Foundation
import ReelformProtocol

/// Screen recording + microphone permission preflight/request (§5.3).
enum Permissions {
    static func screenGranted() -> Bool { CGPreflightScreenCaptureAccess() }

    static func microphoneStatus() -> PermissionStatus {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .granted
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        @unknown default: return .denied
        }
    }

    /// Builds the `permissions` line. With `request`, prompts first: the screen
    /// prompt returns immediately (the grant applies after relaunch); the mic
    /// prompt is awaited.
    static func report(request: Bool) -> String {
        if request {
            if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
            if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
                let done = DispatchSemaphore(value: 0)
                AVCaptureDevice.requestAccess(for: .audio) { _ in done.signal() }
                _ = done.wait(timeout: .now() + 120)
            }
        }
        return permissionsLine([
            ("screen", screenGranted() ? .granted : .denied),
            ("microphone", microphoneStatus()),
        ])
    }
}
