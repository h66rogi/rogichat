import Foundation

struct NativeRealtimeOffer: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let scope: RealtimeScope
    let bearer: String
    var description: String { "NativeRealtimeOffer([redacted])" }
    var debugDescription: String { description }
}
protocol NativeRealtimeServing: Sendable {
    func realtimeOffer(scope: UUID) async throws -> NativeRealtimeOffer
}
