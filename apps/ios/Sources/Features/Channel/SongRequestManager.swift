import Foundation
import Combine

@MainActor
final class SongRequestManager: ObservableObject {
    let identifier: String

    @Published var isLive = false
    @Published var sessionId: Int?
    @Published var requestEnabled = false
    @Published var isPaused = false
    @Published var maxQueueSize = 0
    @Published var queueCount = 0
    @Published var isSubmitting = false
    @Published var requestError: String?
    @Published var preventDuplicateSongs = false
    @Published var blockedCategoryIds: [Int] = []
    @Published var requestedSongIds: [Int] = []
    @Published var queueItems: [SongRequestQueueItem] = []
    @Published var isLoadingQueue = false

    var isQueueFull: Bool {
        maxQueueSize > 0 && queueCount >= maxQueueSize
    }

    var showRequestUI: Bool {
        isLive && requestEnabled
    }

    var canRequest: Bool {
        showRequestUI && !isPaused && !isQueueFull
    }

    private let socketManager = SongLiveSocketManager()
    private var cancellables = Set<AnyCancellable>()
    private var pollingTask: Task<Void, Never>?
    private var isSocketConnected = false
    private static let pollInterval: UInt64 = 30_000_000_000 // 30 seconds

    init(identifier: String) {
        self.identifier = identifier
        subscribeToSocketEvents()
    }

    // MARK: - Lifecycle

    func start() {
        socketManager.connect(identifier: identifier)
        startPolling()
    }

    func stop() {
        socketManager.disconnect()
        stopPolling()
    }

    // MARK: - Polling (fallback)

    func startPolling() {
        pollingTask?.cancel()
        pollingTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: Self.pollInterval)
                guard !Task.isCancelled else { break }
                await self.fetchLiveState()
            }
        }
    }

    func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
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
    }

    private func handleSocketEvent(_ event: ConsoleSocketEvent) {
        switch event {
        case .connected:
            isSocketConnected = true
        case .disconnected:
            isSocketConnected = false
        case .reconnecting:
            break
        case .joined(let session):
            if let session {
                sessionId = session.sessionId
                isLive = session.isLive && session.sessionId != nil
                queueCount = session.queueCount
                if let settings = session.settings {
                    requestEnabled = settings.requestEnabled
                    isPaused = settings.paused
                    maxQueueSize = settings.maxQueueSize
                    preventDuplicateSongs = settings.preventDuplicateSongs
                    blockedCategoryIds = settings.blockedCategoryIds
                } else {
                    requestEnabled = false
                    isPaused = false
                    maxQueueSize = 0
                    preventDuplicateSongs = false
                    blockedCategoryIds = []
                }
                if preventDuplicateSongs, let sid = session.sessionId {
                    Task { await fetchRequestedSongIds(sessionId: sid) }
                }
            } else {
                isLive = false
                sessionId = nil
                requestEnabled = false
                isPaused = false
                maxQueueSize = 0
                preventDuplicateSongs = false
                blockedCategoryIds = []
                requestedSongIds = []
                queueCount = 0
            }
        case .sessionStarted:
            Task { await fetchLiveState() }
        case .sessionEnded:
            isLive = false
            sessionId = nil
            requestEnabled = false
            isPaused = false
            preventDuplicateSongs = false
            blockedCategoryIds = []
            requestedSongIds = []
            queueCount = 0
            queueItems = []
        case .settingsUpdated:
            Task { await fetchLiveState() }
        case .requestAdded, .requestUpdated, .requestRemoved, .queueReordered:
            Task {
                await fetchLiveState()
                await fetchQueue()
            }
        }
    }

    // MARK: - Data Fetching

    func fetchLiveState() async {
        do {
            let session = try await ChannelAPIClient.shared.request(
                endpoint: .activeLiveSession(identifier: identifier),
                responseType: LiveSessionDTO.self
            ).toDomain()

            sessionId = session.sessionId
            isLive = session.isLive && session.sessionId != nil
            queueCount = session.queueCount

            if let settings = session.settings {
                requestEnabled = settings.requestEnabled
                isPaused = settings.paused
                maxQueueSize = settings.maxQueueSize
                preventDuplicateSongs = settings.preventDuplicateSongs
                blockedCategoryIds = settings.blockedCategoryIds
            } else {
                requestEnabled = false
                isPaused = false
                maxQueueSize = 0
                preventDuplicateSongs = false
                blockedCategoryIds = []
            }

            if preventDuplicateSongs, let sid = session.sessionId {
                await fetchRequestedSongIds(sessionId: sid)
            }
        } catch {
            // Silently fail - polling will retry
        }
    }

    func fetchQueue() async {
        guard let sessionId else { return }
        isLoadingQueue = true
        do {
            let response = try await ChannelAPIClient.shared.request(
                endpoint: .songRequestQueue(sessionId: sessionId),
                responseType: SongRequestQueueResponseDTO.self
            )
            queueItems = response.requests.map { $0.toDomain() }
        } catch {
        }
        isLoadingQueue = false
    }

    func fetchRequestedSongIds(sessionId: Int) async {
        do {
            let response = try await ChannelAPIClient.shared.request(
                endpoint: .requestedSongIds(sessionId: sessionId),
                responseType: RequestedSongIdsResponse.self
            )
            requestedSongIds = response.songIds
        } catch {
            // Silently fail
        }
    }

    func isBlockedCategory(song: Song) -> Bool {
        guard !blockedCategoryIds.isEmpty else { return false }
        return song.categories.contains { blockedCategoryIds.contains($0.id) }
    }

    func isDuplicateRequest(songId: Int) -> Bool {
        preventDuplicateSongs && requestedSongIds.contains(songId)
    }

    func requestSong(_ song: Song) async -> Bool {
        guard let sessionId, canRequest, !isSubmitting else { return false }
        guard ChannelSession.shared.isAuthenticated,
              let user = ChannelSession.shared.currentUser else {
            requestError = "로그인이 필요합니다"
            return false
        }



        isSubmitting = true
        defer { isSubmitting = false }

        let payload = SongRequestPayload(
            liveSessionId: sessionId,
            songId: song.id,
            rawArtist: song.artist.name,
            rawTitle: song.title,
            rawMessage: nil,
            requesterPlatformId: "app_\(user.id)",
            requesterNickname: user.nickname
        )

        do {
            _ = try await ChannelAPIClient.shared.request(
                endpoint: .createSongRequest(payload: payload),
                responseType: SongRequestResponse.self
            )
            await fetchLiveState()
            return true
        } catch {
            requestError = "신청곡 요청에 실패했습니다"
            return false
        }
    }
}
