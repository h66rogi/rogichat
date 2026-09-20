import Foundation
import RogichatRooms

// Constructor-injected endpoint adapter follows Meloming's AppClient repository.
struct NativeRoomsRemote: RoomsFetching {
    let session: AppSession
    func discovery(after: String?, scope: RoomsScope) async throws -> DiscoveryPage {
        let data = try await session.roomsData(.discovery(after: after), scope: scope)
        do { return try JSONDecoder().decode(DiscoveryPage.self, from: data) }
        catch { throw RoomsError.invalidResponse }
    }
    func manifest(_ request: ManifestRequest, scope: RoomsScope) async throws -> MembershipPage {
        let data = try await session.roomsData(.manifest(deviceID: request.deviceID, cacheID: request.cacheID, cursor: request.cursor), scope: scope)
        do { return try JSONDecoder().decode(MembershipPage.self, from: data) }
        catch { throw RoomsError.invalidResponse }
    }
    func command(_ intent: RoomCommandIntent) async throws {
        // The closed transport validates the exact join DTO / empty 204 response.
        _ = try await session.roomsCommand(intent)
    }
}
