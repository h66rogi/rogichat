import Foundation
import RogichatRooms

// Constructor-injected endpoint adapter follows Meloming's AppClient repository.
struct NativeRoomsRemote: RoomsFetching, ConversationFetching {
    let session: AppSession
    func fetchConversation(_ query: ConversationQuery, scope: ConversationScope) async throws -> Data {
        try await session.conversationData(.read(query), scope: scope)
    }
    func sendText(_ command: TextCommand, scope: ConversationScope) async throws -> SendReceipt {
        let data = try await session.conversationData(.send(command), scope: scope)
        do { return try JSONDecoder().decode(SendReceipt.self, from: data) }
        catch { throw ConversationError.invalidResponse }
    }
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
