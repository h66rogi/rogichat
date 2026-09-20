enum NotificationAuthorization: Sendable { case notRequested, denied, allowed, quiet, temporary, unknown }
struct NotificationSnapshot: Sendable {
    let authorization: NotificationAuthorization
    var alertsEnabled: Bool? = nil
    var description: String {
        switch authorization {
        case .notRequested: return "이 기기에서 아직 권한을 요청하지 않았어요"
        case .denied: return "이 기기에서 알림이 허용되지 않았어요"
        case .quiet: return "조용한 알림만 임시 허용되어 있어요"
        case .temporary: return "일시적으로 알림이 허용되어 있어요"
        case .unknown: return "기기 설정에서 알림 상태를 확인해 주세요"
        case .allowed: return alertsEnabled == false ? "기기 알림 허용 · 알림 표시는 꺼짐" : "기기 알림 허용 · 알림 표시 켜짐"
        }
    }
}
struct NotificationReadState: Sendable {
    private(set) var revision: UInt64 = 0
    private(set) var observing = false
    private(set) var reading = false
    private(set) var snapshot: NotificationSnapshot?
    private(set) var failed = false
    mutating func begin() -> UInt64 {
        revision += 1; observing = true; reading = true; failed = false
        return revision
    }
    mutating func finish(_ ticket: UInt64, _ value: NotificationSnapshot) {
        guard reading, ticket == revision else { return }
        reading = false; snapshot = value; failed = false
    }
    mutating func fail(_ ticket: UInt64) {
        guard reading, ticket == revision else { return }
        reading = false; snapshot = nil; failed = true
    }
    mutating func cancel() { revision += 1; reading = false }
}
