import Foundation
import Combine

enum ConsoleTab: String, CaseIterable {
    case queue = "대기열"
    case history = "히스토리"
    case settings = "설정"
}

@MainActor
final class ConsoleViewModel: ObservableObject {
    let channelId: Int
    let channelIdentifier: String

    // Session
    @Published var session: ConsoleSession?
    @Published var sessionLoading = true
    @Published var isSessionActive = false

    // Queue
    @Published var nowPlaying: ConsoleSongRequest?
    @Published var queue: [ConsoleSongRequest] = []
    @Published var history: [ConsoleSongRequest] = []

    // Settings
    @Published var settings: ConsoleSessionSettings?
    @Published var pricingSettings: PricingSettings?
    @Published var categories: [Category] = []

    // Session History
    @Published var sessionHistory: [SessionHistoryItem] = []

    // UI state
    @Published var activeTab: ConsoleTab = .queue
    @Published var connectionStatus: ConnectionStatus = .disconnected
    @Published var isLoading = false
    @Published var showManualAddSheet = false
    @Published var error: String?
    private var detectedPlatform: String = "OTHER"

    private let repository: ConsoleRepository
    private let socketManager = SongLiveSocketManager()
    private var cancellables = Set<AnyCancellable>()
    private var pollingTask: Task<Void, Never>?

    init(channelId: Int, channelIdentifier: String, repository: ConsoleRepository = AppClientConsoleRepository()) {
        self.channelId = channelId
        self.channelIdentifier = channelIdentifier
        self.repository = repository
        subscribeToSocketEvents()
    }

    // MARK: - Initial Load

    func loadInitialData() async {
        sessionLoading = true
        do {
            // Detect platform from channel verifications
            if let channelDTO = try? await repository.fetchChannelDetail(identifier: channelIdentifier) {
                let channel = channelDTO.toDomain()
                if let firstVerification = channel.verifications.first {
                    detectedPlatform = firstVerification.platform
                }
            }

            let sessionDTO = try await repository.fetchActiveSession(identifier: channelIdentifier)
            let session = sessionDTO?.toDomain()
            self.session = session
            self.isSessionActive = session?.isActive ?? false
            self.settings = session?.settings
            sessionLoading = false

            if let session = session, session.isActive {
                await activateSession(session)
            } else {
                await loadSessionHistory()
            }
        } catch {
            sessionLoading = false
            self.error = error.localizedDescription
            await loadSessionHistory()
        }
    }

    // MARK: - Session Management

    func startSession() async {
        let platform = detectedPlatform
        isLoading = true
        do {
            let payload = StartSessionPayload(platform: platform, platformChannelId: nil)
            let sessionDTO = try await repository.startSession(payload: payload)
            let session = sessionDTO.toDomain()
            self.session = session
            self.isSessionActive = true
            self.settings = session.settings
            isLoading = false
            await activateSession(session)
        } catch {
            isLoading = false
            self.error = error.localizedDescription
        }
    }

    func endSession() async {
        guard let sessionId = session?.id else { return }
        isLoading = true
        do {
            try await repository.endSession(sessionId: sessionId)
            deactivateSession()
            isLoading = false
        } catch {
            isLoading = false
            self.error = error.localizedDescription
        }
    }

    // MARK: - Queue Management

    func loadQueueData(sessionId: Int) async {
        async let queueResult: () = loadQueue(sessionId: sessionId)
        async let nowPlayingResult: () = loadNowPlaying(sessionId: sessionId)
        _ = await (queueResult, nowPlayingResult)
    }

    private func loadQueue(sessionId: Int) async {
        do {
            let response = try await repository.fetchQueue(sessionId: sessionId, includeCompleted: false)
            queue = response.requests.map { $0.toDomain() }
        } catch {
            // Silently fail, will retry on next poll
        }
    }

    private func loadNowPlaying(sessionId: Int) async {
        do {
            let response = try await repository.fetchNowPlaying(sessionId: sessionId)
            nowPlaying = response?.toDomain()
        } catch {
            // Silently fail
        }
    }

    func loadHistory() async {
        guard let sessionId = session?.id else { return }
        do {
            let response = try await repository.fetchQueue(sessionId: sessionId, includeCompleted: true)
            history = response.requests.map { $0.toDomain() }.filter { $0.isCompleted || $0.isRejected }
        } catch {
            // Silently fail
        }
    }

    func playNow(requestId: Int) async {
        do {
            let response = try await repository.playNow(requestId: requestId)
            nowPlaying = response.toDomain()
            queue.removeAll { $0.id == requestId }
            if let sessionId = session?.id {
                await loadQueueData(sessionId: sessionId)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func playNext() async {
        guard let sessionId = session?.id else { return }
        do {
            let response = try await repository.playNext(sessionId: sessionId)
            let next = response?.toDomain()
            nowPlaying = next
            if let nextId = next?.id {
                queue.removeAll { $0.id == nextId }
            }
            await loadQueueData(sessionId: sessionId)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func skipCurrent(reason: String? = nil) async {
        guard let sessionId = session?.id else { return }
        do {
            let response = try await repository.skipCurrent(sessionId: sessionId, reason: reason)
            nowPlaying = response?.toDomain()
            await loadQueueData(sessionId: sessionId)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func deleteRequest(requestId: Int) async {
        let previousQueue = queue
        queue.removeAll { $0.id == requestId }

        do {
            try await repository.deleteRequest(requestId: requestId)
            if let sessionId = session?.id {
                await loadQueueData(sessionId: sessionId)
            }
        } catch {
            queue = previousQueue
            self.error = "삭제에 실패했습니다"
        }
    }

    func reorderRequest(requestId: Int, newOrder: Int) async {
        do {
            try await repository.updateRequestOrder(requestId: requestId, newOrder: newOrder)
        } catch {
            // Refresh queue on failure
            if let sessionId = session?.id {
                await loadQueue(sessionId: sessionId)
            }
        }
    }

    func clearQueue() async {
        guard let sessionId = session?.id else { return }
        do {
            _ = try await repository.clearQueue(sessionId: sessionId)
            queue = []
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Manual Add

    func submitManualRequest(rawArtist: String, rawTitle: String, songId: Int?, rawMessage: String?) async {
        guard let sessionId = session?.id else { return }
        isLoading = true
        do {
            let payload = CreateManualRequestPayload(
                rawArtist: rawArtist,
                rawTitle: rawTitle,
                songId: songId,
                rawMessage: rawMessage
            )
            _ = try await repository.createManualRequest(sessionId: sessionId, payload: payload)
            showManualAddSheet = false
            isLoading = false
            await loadQueueData(sessionId: sessionId)
        } catch {
            isLoading = false
            self.error = error.localizedDescription
        }
    }

    // MARK: - Settings

    func updateSettings(_ payload: UpdateSettingsPayload) async {
        guard let sessionId = session?.id else { return }

        // Optimistic update
        let previousSettings = settings
        if var current = settings {
            if let v = payload.requestEnabled { current.requestEnabled = v }
            if let v = payload.paused { current.paused = v }
            if let v = payload.requestCommand { current.requestCommand = v }
            if let v = payload.maxQueueSize { current.maxQueueSize = v }
            if let v = payload.donationPriorityEnabled { current.donationPriorityEnabled = v }
            if let v = payload.requireSongMatch { current.requireSongMatch = v }
            if let v = payload.preventDuplicateSongs { current.preventDuplicateSongs = v }
            if let v = payload.maxRequestsPerUser { current.maxRequestsPerUser = v }
            if let v = payload.maxTotalRequests { current.maxTotalRequests = v }
            if let v = payload.blockedCategoryIds { current.blockedCategoryIds = v }
            if let v = payload.karaokePlaybackMode { current.karaokePlaybackMode = v }
            if let v = payload.karaokeVideoType { current.karaokeVideoType = v }
            settings = current
        }

        do {
            let updated = try await repository.updateSessionSettings(sessionId: sessionId, payload: payload)
            settings = updated.toDomain()
        } catch {
            settings = previousSettings
            self.error = error.localizedDescription
        }
    }

    func updatePricingSettings(_ payload: UpdatePricingSettingsPayload) async {
        do {
            let updated = try await repository.updatePricingSettings(channelId: channelId, payload: payload)
            pricingSettings = updated.toDomain()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadSessionHistory() async {
        do {
            let response = try await repository.fetchSessionHistory(identifier: channelIdentifier, page: 1, limit: 5)
            sessionHistory = response.toDomain().sessions
        } catch {
            // Silently fail
        }
    }

    func cloneSession(sourceSessionId: Int) async {
        isLoading = true
        do {
            let sessionDTO = try await repository.cloneSession(sessionId: sourceSessionId, identifier: channelIdentifier)
            let session = sessionDTO.toDomain()
            self.session = session
            self.isSessionActive = true
            self.settings = session.settings
            isLoading = false
            await activateSession(session)
        } catch {
            isLoading = false
            self.error = error.localizedDescription
        }
    }

    // MARK: - Session Lifecycle Helpers

    private func activateSession(_ session: ConsoleSession) async {
        await loadQueueData(sessionId: session.id)
        await loadPricingSettings()
        await loadCategories()
        socketManager.connect(identifier: channelIdentifier)
        startPolling()
    }

    private func deactivateSession() {
        isSessionActive = false
        nowPlaying = nil
        queue = []
        socketManager.disconnect()
        cancelPolling()
    }

    func loadCategories() async {
        do {
            let response = try await repository.fetchCategories(identifier: channelIdentifier)
            categories = response
        } catch {
            // Silently fail
        }
    }

    func loadPricingSettings() async {
        do {
            let response = try await repository.fetchPricingSettings(channelId: channelId)
            pricingSettings = response.toDomain()
        } catch {
            // Silently fail
        }
    }

    // MARK: - WebSocket

    private func subscribeToSocketEvents() {
        socketManager.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                Task { @MainActor in
                    self?.handleSocketEvent(event)
                }
            }
            .store(in: &cancellables)

        socketManager.$connectionStatus
            .receive(on: DispatchQueue.main)
            .assign(to: &$connectionStatus)
    }

    private func handleSocketEvent(_ event: ConsoleSocketEvent) {
        switch event {
        case .connected:
            cancelPolling()
        case .disconnected:
            startPolling()
        case .reconnecting:
            break
        case .joined:
            cancelPolling()
        case .requestAdded, .requestUpdated, .queueReordered, .requestRemoved:
            guard let sessionId = session?.id else { return }
            Task { await loadQueueData(sessionId: sessionId) }
        case .settingsUpdated:
            Task { await refreshSession() }
        case .sessionStarted:
            Task { await loadInitialData() }
        case .sessionEnded:
            deactivateSession()
        }
    }

    private func refreshSession() async {
        do {
            let sessionDTO = try await repository.fetchActiveSession(identifier: channelIdentifier)
            if let session = sessionDTO?.toDomain() {
                self.session = session
                self.settings = session.settings
            } else if isSessionActive {
                deactivateSession()
                await loadSessionHistory()
            }
        } catch {
            // Silently fail
        }
    }

    // MARK: - Polling Fallback

    private func startPolling() {
        guard pollingTask == nil else { return }
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard let sessionId = session?.id, isSessionActive else { break }
                await loadQueueData(sessionId: sessionId)
                await refreshSession()
            }
        }
    }

    private func cancelPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    // MARK: - Cleanup

    func onDisappear() {
        socketManager.disconnect()
        cancelPolling()
    }
}
