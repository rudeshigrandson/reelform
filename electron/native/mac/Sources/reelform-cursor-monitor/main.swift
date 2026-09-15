import AppKit
import Foundation
import ReelformProtocol

// reelform-cursor-monitor — cursor/click/key telemetry (ENGINEERING_SPEC §5.3).
//
//   reelform-cursor-monitor                          stdio session (§5.5)
//   reelform-cursor-monitor --export-cursors <dir>   write cursor PNGs @2x + pack.json, print result, exit
//   reelform-cursor-monitor --permissions            print {"t":"permissions",...} and exit
//   reelform-cursor-monitor --request-permissions    prompt for Input Monitoring, print, exit

setvbuf(stdout, nil, _IONBF, 0)
signal(SIGPIPE, SIG_IGN)

let arguments = CommandLine.arguments
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

if arguments.contains("--permissions") || arguments.contains("--request-permissions") {
    if arguments.contains("--request-permissions") { _ = CGRequestListenEventAccess() }
    print(permissionsLine([
        ("inputMonitoring", CGPreflightListenEventAccess() ? .granted : .denied),
        ("accessibility", AXIsProcessTrusted() ? .granted : .denied),
    ]))
    exit(0)
}

if let flag = arguments.firstIndex(of: "--export-cursors") {
    guard arguments.indices.contains(flag + 1) else {
        print(CursorEvent.error(id: nil, code: "badRequest", message: "--export-cursors needs a directory").encode())
        exit(2)
    }
    let dir = arguments[flag + 1]
    do {
        let files = try SystemCursorAssets.export(to: URL(fileURLWithPath: dir, isDirectory: true))
        print(CursorEvent.cursorsExported(id: nil, dir: dir, files: files).encode())
        exit(0)
    } catch {
        print(CursorEvent.error(id: nil, code: "exportFailed", message: "\(error)").encode())
        exit(1)
    }
}

let writer = LineWriter()
let monitor = CursorMonitor(out: writer, clock: SystemHostClock())

readLines(
    onLine: { line in DispatchQueue.main.async { monitor.handle(line: line) } },
    onEOF: { DispatchQueue.main.async { monitor.parentGone() } }
)

writer.send(CursorEvent.ready.encode())
app.run()
