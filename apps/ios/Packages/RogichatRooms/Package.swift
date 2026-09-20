// swift-tools-version: 6.1
import PackageDescription
let package = Package(
    name: "RogichatRooms", platforms: [.iOS(.v18), .macOS(.v14)],
    products: [.library(name: "RogichatRooms", targets: ["RogichatRooms"])],
    dependencies: [.package(url: "https://github.com/groue/GRDB.swift.git", exact: "7.11.1")],
    targets: [
        .target(name: "RogichatRooms", dependencies: [.product(name: "GRDB", package: "GRDB.swift")]),
        .testTarget(name: "RogichatRoomsTests", dependencies: ["RogichatRooms", .product(name: "GRDB", package: "GRDB.swift")])
    ], swiftLanguageModes: [.v6])
