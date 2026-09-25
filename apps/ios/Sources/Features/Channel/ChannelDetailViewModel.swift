import Foundation

// Copied from meloming-ios 18a33bb ChannelDetailViewModel.swift.
// Rogichat's channel supports its public profile and configured content sections.

@MainActor
final class ChannelDetailViewModel: ObservableObject {
    let identifier: String
    private let repository: ChannelRepository

    @Published var channel: Channel?
    @Published var profile: ChannelProfile?
    @Published var favoriteCount = 0
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

            // The source's parallel channel detail/profile/menu loading is retained.
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await self.loadProfile() }
                group.addTask { await self.loadFavoriteCount() }
                group.addTask { await self.loadFeatureSettings() }
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
            featureSettings = try await repository.fetchChannelFeatureSettings(identifier: identifier)
        } catch {
            // The shell can still show the profile when menu settings are unavailable.
            featureSettings = nil
        }
        featureSettingsLoaded = true
    }

    private func loadFavoriteCount() async {
        guard let channel else { return }
        if let response = try? await repository.fetchFavoritesCount(channelId: channel.id) {
            favoriteCount = response.totalFavorites
        }
    }
}
