import Foundation

@MainActor
final class ChannelDetailViewModel: ObservableObject {
    let identifier: String
    private let repository: ChannelRepository

    @Published var channel: Channel?
    @Published var profile: ChannelProfile?
    @Published var isFavorited = false
    @Published var favoriteCount = 0
    @Published var canManageContent = false
    @Published var canManageSettings = false
    @Published var isOwner = false
    @Published var isLoading = false
    @Published var error: Error?
    /// 채널 feature-settings — 로드 실패/미지원이면 nil 유지 → 클라이언트 기본 순서 폴백
    @Published var featureSettings: ChannelFeatureSettingsResponse?
    @Published var featureSettingsLoaded = false

    init(identifier: String, repository: ChannelRepository = AppClientChannelRepository()) {
        self.identifier = identifier
        self.repository = repository
    }

    func loadChannel() async {
        isLoading = true
        error = nil

        do {
            let channelDTO = try await repository.fetchChannelDetail(identifier: identifier)
            channel = channelDTO.toDomain()
            favoriteCount = channel?.favoritesCount ?? 0

            // Load profile, favorite status, favorite count, and permissions in parallel
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await self.loadProfile() }
                group.addTask { await self.loadFavoriteCount() }
                group.addTask { await self.loadFeatureSettings() }
                if ChannelSession.shared.isAuthenticated {
                    group.addTask { await self.checkFavoriteStatus() }
                    group.addTask { await self.checkPermissions() }
                }
            }
        } catch {
            self.error = error
        }

        isLoading = false
    }

    private func loadProfile() async {
        guard let channel = channel else { return }

        do {
            let profileResponse = try await repository.fetchChannelProfile(channelId: channel.id)
            profile = profileResponse
        } catch {
            // Profile is optional, don't set error
        }
    }

    private func loadFeatureSettings() async {
        do {
            featureSettings = try await ChannelAPIClient.shared.request(
                endpoint: .channelFeatureSettings(identifier: identifier),
                responseType: ChannelFeatureSettingsResponse.self
            )
        } catch {
            // 실패 시 하드코딩 순서 폴백 (무중단)
            featureSettings = nil
        }
        featureSettingsLoaded = true
    }



    private func checkPermissions() async {
        do {
            let response = try await repository.fetchChannelPermission(identifier: identifier)
            isOwner = response.isOwner
            canManageContent = response.manageContent || response.isOwner
            canManageSettings = response.manageSettings || response.isOwner
        } catch {
            canManageContent = false
            canManageSettings = false
        }
    }

    func checkFavoriteStatus() async {
        guard let channel = channel else { return }

        do {
            let response = try await repository.checkFavorite(channelId: channel.id)
            isFavorited = response.isFavorite
        } catch {
        }
    }

    private func loadFavoriteCount() async {
        guard let channel = channel else { return }

        do {
            let response = try await repository.fetchFavoritesCount(channelId: channel.id)
            favoriteCount = response.totalFavorites
        } catch {
        }
    }

    func toggleFavorite() async {
        guard let channel = channel else { return }
        guard ChannelSession.shared.isAuthenticated else { return }

        let wasFavorited = isFavorited
        let previousCount = favoriteCount

        // Optimistic update
        isFavorited.toggle()
        favoriteCount = max(0, favoriteCount + (wasFavorited ? -1 : 1))

        do {
            if wasFavorited {
                try await repository.removeFavorite(channelId: channel.id)
            } else {
                try await repository.addFavorite(channelId: channel.id)
            }
        } catch {
            // Rollback
            isFavorited = wasFavorited
            favoriteCount = previousCount
        }
    }
}
