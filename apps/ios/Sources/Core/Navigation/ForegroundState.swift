struct ForegroundState: Sendable {
    private(set) var active = false
    private(set) var epoch: UInt64 = 0
    mutating func transition(_ value: Bool) {
        guard active != value else { return }
        active = value
        if value { epoch += 1 }
    }
}
