import Foundation
import CoreFoundation

enum ReportReason: String, Codable, CaseIterable, Sendable {
    case spam, harassment, sexual, violence, other
    var label: String { switch self { case .spam: "스팸"; case .harassment: "괴롭힘"; case .sexual: "성적인 내용"; case .violence: "폭력"; case .other: "기타" } }
}
struct ReportReceipt: Equatable, Sendable { let reportId: String; let status: String; let createdAt: String }
/// Moderation v1 checked source; release mounting requires corresponding backend deployment.
enum ModerationWire {
    static func mutation(_ record: ActionRecord) throws -> ActionRequest {
        let selected = record.selection
        switch record.action {
        case .report:
            guard let reason = record.reportReason else { throw MessageActionError.invalidResponse }
            return ActionRequest(method: "POST", path: "rooms/\(selected.scope.roomId)/messages/\(selected.messageId)/reports",
                body: try JSONSerialization.data(withJSONObject: ["idempotencyKey": record.id, "reason": reason.rawValue]), successStatus: 200)
        case .blockActor:
            guard !selected.anonymous, let actor = selected.visibleActorId, actionID(actor), actor != selected.scope.actorId else { throw MessageActionError.unavailable }
            return ActionRequest(method: "PUT", path: "rooms/\(selected.scope.roomId)/blocks/\(actor)", body: Data("{}".utf8), successStatus: 200)
        default: throw MessageActionError.invalidResponse
        }
    }
    static func recoverReport(_ record: ActionRecord) throws -> ActionRequest {
        guard record.action == .report, actionID(record.id) else { throw MessageActionError.invalidResponse }
        return ActionRequest(method: "GET", path: "report-receipts/\(record.id)", body: nil, successStatus: 200)
    }
    static func receipt(_ data: Data) throws -> ReportReceipt {
        let root = try ActionJSON.object(data)
        guard Set(root.keys) == ["reportId", "status", "createdAt"], let id = root["reportId"] as? String, actionID(id),
              let status = root["status"] as? String, ["received", "resolved", "dismissed"].contains(status), let date = root["createdAt"] as? String else { throw MessageActionError.invalidResponse }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard formatter.date(from: date) != nil || ISO8601DateFormatter().date(from: date) != nil else { throw MessageActionError.invalidResponse }
        return ReportReceipt(reportId: id, status: status, createdAt: date)
    }
    static func blockReceipt(_ data: Data) throws -> String {
        let root = try ActionJSON.object(data)
        guard Set(root.keys) == ["actorId", "blocked", "resetRequired"], let id = root["actorId"] as? String, actionID(id) else { throw MessageActionError.invalidResponse }
        for key in ["blocked", "resetRequired"] {
            guard let value = root[key] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID(), value.boolValue else { throw MessageActionError.invalidResponse }
        }
        return id
    }
}
