import Foundation
import ReelformProtocol

// reelform-sck — ScreenCaptureKit recorder (ENGINEERING_SPEC §5.3).
//
//   reelform-sck                        stdio session (§5.5)
//   reelform-sck --permissions          print {"t":"permissions",...} and exit
//   reelform-sck --request-permissions  prompt for screen + mic, print, exit

let arguments = CommandLine.arguments

if arguments.contains("--permissions") || arguments.contains("--request-permissions") {
    let request = arguments.contains("--request-permissions")
    print(Permissions.report(request: request))
    exit(0)
}

setvbuf(stdout, nil, _IONBF, 0)
signal(SIGPIPE, SIG_IGN)

let writer = LineWriter()
let recorder = Recorder(out: writer, clock: SystemHostClock())

readLines(
    onLine: { line in recorder.handle(line: line) },
    onEOF: { recorder.parentGone() }
)

writer.send(SckEvent.ready.encode())
dispatchMain()
