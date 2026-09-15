// swift-tools-version:5.9
// Reelform macOS native helpers (ENGINEERING_SPEC §5.3 / §5.5).
//
// Two stand-alone executables speaking line-delimited JSON over stdio, plus a
// pure shared target holding the protocol, bitrate table, pause/PTS math,
// modifier mapping and cursor classification. Helpers produce files +
// telemetry only; no business logic the editor depends on lives here.
import PackageDescription

let package = Package(
    name: "ReelformNativeMac",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "reelform-sck", targets: ["reelform-sck"]),
        .executable(name: "reelform-cursor-monitor", targets: ["reelform-cursor-monitor"]),
    ],
    targets: [
        .target(name: "ReelformProtocol", path: "Sources/ReelformProtocol"),
        .executableTarget(
            name: "reelform-sck",
            dependencies: ["ReelformProtocol"],
            path: "Sources/reelform-sck"
        ),
        .executableTarget(
            name: "reelform-cursor-monitor",
            dependencies: ["ReelformProtocol"],
            path: "Sources/reelform-cursor-monitor"
        ),
        // XCTest-free self-check: `swift run reelform-protocol-selfcheck`.
        .executableTarget(
            name: "reelform-protocol-selfcheck",
            dependencies: ["ReelformProtocol"],
            path: "Sources/reelform-protocol-selfcheck"
        ),
    ]
)
