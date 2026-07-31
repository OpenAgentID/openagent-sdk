// swift-tools-version: 6.0
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "OpenAgentSDK",
    platforms: [
        .macOS(.v14),
        .iOS(.v17),
        .macCatalyst(.v17),
        .tvOS(.v17),
        .watchOS(.v10),
    ],
    products: [
        .library(name: "OpenAgentSDK", targets: ["OpenAgentSDK"])
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-crypto.git", from: "3.5.0")
    ],
    targets: [
        .target(
            name: "OpenAgentSDK",
            dependencies: [
                .product(name: "Crypto", package: "swift-crypto")
            ],
            path: "Sources/OpenAgentSDK"
        ),
        .testTarget(
            name: "OpenAgentSDKTests",
            dependencies: ["OpenAgentSDK"],
            path: "Tests/OpenAgentSDKTests"
        ),
    ]
)
