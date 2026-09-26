import SwiftUI
import Kingfisher
import SafariServices
import WebKit

struct ChannelDetailView: View {
    let identifier: String
    var initialTab: ChannelTab = .songBook
    let onTalk: () -> Void


    @StateObject private var viewModel: ChannelDetailViewModel
    @StateObject private var songRequestManager: SongRequestManager
    @State private var selectedTab: ChannelTab
    @State private var showAddSong = false
    @State private var showAddSchedule = false
    @State private var showChannelManagement = false
    @State private var showChannelSettings = false
    @State private var showConsole = false
    @State private var songBookRefreshToken = UUID()
    @State private var songBookSearchText = ""
    @State private var scheduleRefreshToken = UUID()
    @State private var showQueueSheet = false

    /// feature-settings 병합 결과 탭 (서버 라벨 오버라이드 반영)
    struct ChannelResolvedTab: Identifiable, Equatable {
        let tab: ChannelTab
        let label: String

        var id: ChannelTab { tab }
        var icon: String { tab.icon }
    }

    enum ChannelTab: String, CaseIterable, Hashable {
        case wardrobe = "옷장"
        case setlist = "셋리스트"
        case songBook = "노래책"
        case schedule = "일정"
        case info = "정보"

        var icon: String {
            switch self {
            case .wardrobe: return "tshirt"
            case .setlist: return "list.number"
            case .songBook: return "music.note.list"
            case .schedule: return "calendar"
            case .info: return "person.text.rectangle"
            }
        }

        /// 서버 feature-settings key → iOS 지원 탭 매핑.
        /// 미지원 key(board/upbo/ranking/setlist/homework-song 및 커스텀 메뉴)는 graceful 제외.
        static let featureKeyMap: [String: ChannelTab] = [
            "wardrobe": .wardrobe,
            "setlist": .setlist,
            "musicbook": .songBook,
            "schedule": .schedule,
            "info": .info
        ]

        /// 설정 로드 실패/빈 응답 시 기존 하드코딩 순서 폴백 (무중단)
        static var fallbackResolvedTabs: [ChannelResolvedTab] {
            [.songBook, .schedule, .setlist, .wardrobe]
                .map { ChannelResolvedTab(tab: $0, label: $0.rawValue) }
        }

        /// 웹 getConfiguredTabItems와 동일: enabled 필터 → order 정렬 → 라벨 오버라이드
        static func resolveTabs(
            from settings: ChannelFeatureSettingsResponse?
        ) -> [ChannelResolvedTab] {
            guard let settings, !settings.items.isEmpty else {
                return fallbackResolvedTabs
            }
            let sorted = settings.items.sorted { ($0.order ?? .max) < ($1.order ?? .max) }
            var resolved: [ChannelResolvedTab] = []
            for item in sorted {
                guard item.isEnabled else { continue }
                guard let tab = featureKeyMap[item.key],
                      !resolved.contains(where: { $0.tab == tab }) else { continue }
                resolved.append(ChannelResolvedTab(tab: tab, label: item.displayLabel ?? tab.rawValue))
            }
            guard !resolved.isEmpty else { return [] }
            return resolved
        }
    }

    init(identifier: String = "h66rogi", initialTab: ChannelTab = .songBook, onTalk: @escaping () -> Void) {
        self.identifier = identifier
        self.onTalk = onTalk
        self.initialTab = initialTab
        self._viewModel = StateObject(wrappedValue: ChannelDetailViewModel(identifier: identifier))
        self._songRequestManager = StateObject(wrappedValue: SongRequestManager(identifier: identifier))
        self._selectedTab = State(initialValue: initialTab)
    }

    var body: some View {
        Group {
            if viewModel.isLoading {
                LoadingView()
            } else if let channel = viewModel.channel {
                ScrollView {
                    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                        ChannelProfileHero(
                            channel: channel,
                            profile: viewModel.profile,
                            isFavorited: viewModel.isFavorited,
                            favoriteCount: viewModel.favoriteCount,
                            isOwner: viewModel.isOwner,
                            onFavorite: { Task { await viewModel.toggleFavorite() } },
                            onTalk: onTalk,
                            onEditProfile: { showChannelSettings = true },
                            onManage: { showChannelManagement = true }
                        )

                        Section {
                            if resolvedTabs.isEmpty {
                                unavailableSectionsView
                                    .padding(.bottom, 42)
                            } else {
                                selectedSectionContent(channel: channel)
                                    .padding(.bottom, 42)
                            }
                        } header: {
                            if !resolvedTabs.isEmpty {
                                VStack(spacing: 6) {
                                    ChannelSectionRail(
                                        tabs: resolvedTabs,
                                        selectedTab: $selectedTab,
                                        onSelect: openSection
                                    )

                                    if selectedTab == .songBook {
                                        SongBookSearchBar(text: $songBookSearchText)
                                            .padding(.horizontal, 20)
                                            .padding(.bottom, 8)
                                    }

                                    if viewModel.canManageContent {
                                        ownerSectionAction
                                    }
                                }
                                .padding(.top, 6)
                                .padding(.bottom, 10)
                            }
                        }
                    }
                }
                .background(Color(.systemBackground))
                .refreshable { await viewModel.loadChannel() }
            } else if let error = viewModel.error {
                ErrorView(error: error) {
                    Task {
                        await viewModel.loadChannel()
                    }
                }
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundColor(.secondary)
                    Text("채널을 불러올 수 없습니다")
                        .foregroundColor(.secondary)
                    Button("다시 시도") {
                        Task {
                            await viewModel.loadChannel()
                        }
                    }
                }
            }
        }
        .tint(Color(hex: "#6366F1"))
        .navigationTitle(viewModel.channel?.name ?? "채널")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let channel = viewModel.channel {
                    let webURL = ChannelEnvironment.webURL
                    if let url = URL(string: "\(webURL.absoluteString)/channel/\(channel.webPath)") {
                        ShareLink(
                            item: url,
                            subject: Text(channel.name),
                            message: Text("\(channel.name) - 로기챗")
                        ) {
                            Image(systemName: "square.and.arrow.up")
                        }
                        .accessibilityLabel("채널 공유")
                    }

                    if viewModel.canManageSettings {
                        Menu {
                            Button {
                                showConsole = true
                            } label: {
                                Label("신청곡 콘솔", systemImage: "music.note.list")
                            }

                            Button {
                                showChannelManagement = true
                            } label: {
                                Label("채널 관리", systemImage: "gearshape")
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                        .accessibilityLabel("채널 더보기")
                    }
                }
            }
        }
        .sheet(isPresented: $showAddSong) {
            if let channel = viewModel.channel {
                AddSongView(channelId: channel.id, identifier: identifier) {
                    songBookRefreshToken = UUID()
                }
            }
        }
        .sheet(isPresented: $showAddSchedule) {
            if let channel = viewModel.channel {
                AddScheduleView(channelId: channel.id) {
                    scheduleRefreshToken = UUID()
                }
            }
        }
        .navigationDestination(isPresented: $showChannelManagement) {
            if let channel = viewModel.channel {
                ChannelManagementView(
                    channelId: channel.id,
                    channelName: channel.name,
                    identifier: identifier,
                    isOwner: viewModel.isOwner
                )
            }
        }
        .navigationDestination(isPresented: $showChannelSettings) {
            if let channel = viewModel.channel {
                ChannelSettingsView(channelId: channel.id, identifier: identifier)
            }
        }
        .navigationDestination(isPresented: $showConsole) {
            if let channel = viewModel.channel {
                ConsoleView(channelId: channel.id, channelIdentifier: channel.webPath)
            }
        }
        .sheet(isPresented: $showQueueSheet) {
            SongRequestQueueSheet(manager: songRequestManager)
                .presentationDetents([.large])
        }
        .task {
            await ChannelSession.shared.refresh()
            async let channelLoad: Void = viewModel.loadChannel()
            async let liveStateLoad: Void = songRequestManager.fetchLiveState()
            _ = await (channelLoad, liveStateLoad)
            songRequestManager.start()
        }
        .onChange(of: viewModel.featureSettingsLoaded) { loaded in
            if loaded { adjustSelectionForResolvedTabs() }
        }
        .onDisappear {
            songRequestManager.stop()
        }
    }

    private var resolvedTabs: [ChannelResolvedTab] {
        ChannelTab.resolveTabs(
            from: viewModel.featureSettings
        )
    }

    private var unavailableSectionsView: some View {
        VStack(spacing: 10) {
            Image(systemName: "rectangle.stack.badge.minus")
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(.secondary)

            Text("공개된 채널 섹션이 없어요")
                .font(.headline)

            Text("채널에서 섹션을 공개하면 이곳에서 확인할 수 있어요.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .padding(.horizontal, 24)
    }

    /// 설정 로드 후 기본 진입 탭이 비활성이면 첫 활성 탭으로 이동.
    /// 딥링크(initialTab 명시)로 들어온 탭은 사용자가 의도한 것이므로 그대로 유지.
    private func adjustSelectionForResolvedTabs(forceUnavailableSelection: Bool = false) {
        guard (forceUnavailableSelection || selectedTab == initialTab),
              !resolvedTabs.contains(where: { $0.tab == selectedTab }),
              let first = resolvedTabs.first?.tab else { return }
        selectedTab = first
    }

    private func openSection(_ tab: ChannelTab) {
        withAnimation(.easeInOut(duration: 0.24)) {
            selectedTab = tab
        }
    }

    @ViewBuilder
    private var ownerSectionAction: some View {
        switch selectedTab {
        case .songBook:
            ChannelOwnerSectionAction(title: "노래 추가", systemImage: "plus") {
                showAddSong = true
            }
        case .schedule:
            ChannelOwnerSectionAction(title: "일정 추가", systemImage: "plus") {
                showAddSchedule = true
            }
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private func selectedSectionContent(channel: Channel) -> some View {
        switch selectedTab {
        case .wardrobe:
            ChannelWardrobeView(identifier: channel.webPath)
        case .setlist:
            ChannelSetlistView(identifier: channel.webPath)
        case .songBook:
            SongBookView(
                channelId: channel.id,
                identifier: channel.webPath,
                refreshToken: songBookRefreshToken,
                songRequestManager: songRequestManager,
                pinnedSearchText: $songBookSearchText,
                onShowQueue: { showQueueSheet = true }
            )
            .padding(.top, 12)
        case .schedule:
            ScheduleView(
                channelId: channel.id,
                refreshToken: scheduleRefreshToken,
                canEdit: viewModel.canManageContent
            )
            .padding(.top, 12)
        case .info:
            ChannelInfoView(
                channel: channel,
                profile: viewModel.profile,
                favoriteCount: viewModel.favoriteCount
            )
            .padding(.top, 12)
        }
    }


}

extension Color {
    var isLight: Bool {
        return luminance > 0.5
    }

    var luminance: CGFloat {
        let uiColor = UIColor(self)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0

        uiColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha)

        // Calculate relative luminance (WCAG formula)
        return 0.299 * red + 0.587 * green + 0.114 * blue
    }

    /// Returns an accessible color for text display.
    /// If the color has low contrast against the background, returns black or white instead.
    func accessibleTextColor(for colorScheme: ColorScheme) -> Color {
        let backgroundLuminance: CGFloat = colorScheme == .dark ? 0.1 : 0.95
        let colorLuminance = self.luminance

        // Calculate contrast ratio
        let lighter = max(backgroundLuminance, colorLuminance)
        let darker = min(backgroundLuminance, colorLuminance)
        let contrastRatio = (lighter + 0.05) / (darker + 0.05)

        // WCAG AA requires 4.5:1 for normal text, use 3.0 as threshold for UI elements
        if contrastRatio < 3.0 {
            return colorScheme == .dark ? .white : .black
        }

        return self
    }
}

struct FavoriteStatusResponse: Decodable {
    let isFavorite: Bool
}

struct ChannelFavoritesCountResponse: Decodable {
    let totalFavorites: Int
}

// MARK: - Channel Info View
struct ChannelInfoView: View {
    let channel: Channel
    let profile: ChannelProfile?
    let favoriteCount: Int

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    @State private var showingSafari = false
    @State private var selectedURL: URL?

    private var themeColor: Color {
        Color(hex: channel.themeColor)
    }

    private var accessibleThemeColor: Color {
        themeColor.accessibleTextColor(for: colorScheme)
    }

    // 외부 브라우저로 열어야 하는 도메인 목록
    private static let externalBrowserDomains = [
        "chzzk.naver.com",      // 치지직
        "afreecatv.com",        // 아프리카TV
        "twitch.tv",            // 트위치
        "kick.com"              // 킥
    ]

    private func shouldOpenExternally(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return Self.externalBrowserDomains.contains { host.contains($0) }
    }

    private func openLink(_ url: URL) {
        if shouldOpenExternally(url) {
            openURL(url)
        } else {
            selectedURL = url
            showingSafari = true
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // Description Section
            if let description = profile?.description ?? profile?.homeDescription ?? channel.channelDescription,
               !description.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label("프로필 설명", systemImage: "text.quote")
                        .font(.headline)
                        .foregroundColor(accessibleThemeColor)

                    HTMLTextView(htmlString: description)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.systemGray6))
                        .cornerRadius(12)
                }
            }

            // Links Section
            if let platformUrl = channel.platformUrl, !platformUrl.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label("링크", systemImage: "link")
                        .font(.headline)
                        .foregroundColor(accessibleThemeColor)

                    VStack(spacing: 8) {
                        if let url = URL(string: platformUrl) {
                            Button {
                                openLink(url)
                            } label: {
                                HStack {
                                    Image(systemName: "play.tv")
                                    Text("방송 플랫폼")
                                    Spacer()
                                    Image(systemName: shouldOpenExternally(url) ? "arrow.up.forward.app" : "arrow.up.right")
                                        .font(.caption)
                                }
                                .padding()
                                .background(Color(.systemGray6))
                                .cornerRadius(10)
                            }
                            .buttonStyle(.plain)
                            .foregroundColor(.primary)
                        }

                        ForEach(channel.additionalLinks, id: \.url) { link in
                            if let url = URL(string: link.url) {
                                Button {
                                    openLink(url)
                                } label: {
                                    HStack {
                                        Image(systemName: "link")
                                        Text(link.name)
                                        Spacer()
                                        Image(systemName: shouldOpenExternally(url) ? "arrow.up.forward.app" : "arrow.up.right")
                                            .font(.caption)
                                    }
                                    .padding()
                                    .background(Color(.systemGray6))
                                    .cornerRadius(10)
                                }
                                .buttonStyle(.plain)
                                .foregroundColor(.primary)
                            }
                        }
                    }
                }
            }

            // Profile Info Section
            if let profile = profile {
                let infoItems = buildProfileInfoItems(profile: profile)

                if !infoItems.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("채널 프로필", systemImage: "person.circle")
                            .font(.headline)
                            .foregroundColor(accessibleThemeColor)

                        VStack(spacing: 0) {
                            ForEach(Array(infoItems.enumerated()), id: \.offset) { index, item in
                                HStack {
                                    Text(item.label)
                                        .font(.subheadline)
                                        .fontWeight(.medium)
                                        .foregroundColor(accessibleThemeColor)
                                        .frame(width: 80, alignment: .leading)
                                        .padding(.vertical, 10)
                                        .padding(.horizontal, 12)
                                        .background(themeColor.opacity(0.1))

                                    Text(item.value)
                                        .font(.subheadline)
                                        .foregroundColor(.secondary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.vertical, 10)
                                        .padding(.horizontal, 12)
                                }
                                .background(Color(.systemBackground))

                                if index < infoItems.count - 1 {
                                    Divider()
                                }
                            }
                        }
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color(.systemGray4), lineWidth: 1)
                        )
                    }
                }

                // Bio Section
                if let bio = profile.bio, !bio.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("약력", systemImage: "doc.text")
                            .font(.headline)
                            .foregroundColor(accessibleThemeColor)

                        Text(bio)
                            .font(.body)
                            .foregroundColor(.primary)
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.systemGray6))
                            .cornerRadius(12)
                    }
                }
            }

            // Statistics Section
            VStack(alignment: .leading, spacing: 8) {
                Label("채널 통계", systemImage: "chart.bar")
                    .font(.headline)
                    .foregroundColor(accessibleThemeColor)

                HStack(spacing: 12) {
                    StatItem(icon: "music.note", value: "\(channel.songCount)", label: "곡")
                    StatItem(icon: "person.2", value: "\(channel.artistCount)", label: "아티스트")
                    StatItem(icon: "folder", value: "\(channel.categoryCount)", label: "카테고리")
                    StatItem(icon: "star.fill", value: "\(favoriteCount)", label: "즐겨찾기")
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color(.systemGray6))
                .cornerRadius(12)
            }

            Spacer()
        }
        .padding()
        .sheet(isPresented: $showingSafari) {
            if let url = selectedURL {
                SafariView(url: url)
            }
        }
    }

    private func buildProfileInfoItems(profile: ChannelProfile) -> [(label: String, value: String)] {
        var items: [(label: String, value: String)] = []

        if let nickname = profile.nickname, !nickname.isEmpty {
            items.append(("닉네임", nickname))
        }
        if let birthday = profile.birthdayDisplayName {
            items.append(("생일", birthday))
        }
        if let residence = profile.residence, !residence.isEmpty {
            items.append(("거주지", residence))
        }
        if let nationality = profile.nationality, !nationality.isEmpty {
            items.append(("국적", nationality))
        }
        if let gender = profile.genderDisplayName {
            items.append(("성별", gender))
        }
        if let heightCm = profile.heightCm, !heightCm.isEmpty {
            items.append(("키", heightCm))
        }
        if let weightKg = profile.weightKg, !weightKg.isEmpty {
            items.append(("몸무게", weightKg))
        }
        if let mbti = profile.mbti, !mbti.isEmpty {
            items.append(("MBTI", mbti))
        }
        if let symbolColor = profile.symbolColor, !symbolColor.isEmpty {
            items.append(("상징 색상", symbolColor))
        }
        if let agency = profile.agency, !agency.isEmpty {
            items.append(("소속사", agency))
        }
        if let fandomName = profile.fandomName, !fandomName.isEmpty {
            items.append(("팬덤명", fandomName))
        }
        if let religion = profile.religion, !religion.isEmpty {
            items.append(("종교", religion))
        }
        if let debutDate = profile.debutDateDisplayName {
            items.append(("데뷔일", debutDate))
        }
        if let alias = profile.alias, !alias.isEmpty {
            items.append(("별명", alias.joined(separator: ", ")))
        }
        if let affiliatedGroups = profile.affiliatedGroups, !affiliatedGroups.isEmpty {
            items.append(("소속 그룹", affiliatedGroups.joined(separator: ", ")))
        }
        if let broadcastingPlatforms = profile.broadcastingPlatforms, !broadcastingPlatforms.isEmpty {
            items.append(("방송 플랫폼", broadcastingPlatforms.joined(separator: ", ")))
        }
        if let education = profile.education, !education.isEmpty {
            items.append(("학력", education.joined(separator: ", ")))
        }

        return items
    }
}

struct StatItem: View {
    let icon: String
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(.accentColor)
            Text(value)
                .font(.headline)
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - HTML Text View
struct HTMLTextView: View {
    let htmlString: String

    var body: some View {
        Text(attributedString)
            .font(.body)
            .foregroundColor(.primary)
    }

    private var attributedString: AttributedString {
        // Convert HTML to AttributedString
        let htmlData = Data(wrappedHTML.utf8)

        if let nsAttributedString = try? NSAttributedString(
            data: htmlData,
            options: [
                .documentType: NSAttributedString.DocumentType.html,
                .characterEncoding: String.Encoding.utf8.rawValue
            ],
            documentAttributes: nil
        ) {
            // Convert NSAttributedString to AttributedString
            if var attributedString = try? AttributedString(nsAttributedString, including: \.uiKit) {
                // Reset font to system font
                attributedString.font = .body
                return attributedString
            }
        }

        // Fallback: strip HTML tags
        return AttributedString(strippedHTML)
    }

    private var wrappedHTML: String {
        """
        <html>
        <head>
        <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 16px;
            line-height: 1.5;
        }
        </style>
        </head>
        <body>\(htmlString)</body>
        </html>
        """
    }

    private var strippedHTML: String {
        // Simple HTML tag stripper
        var result = htmlString
        // Replace common HTML entities
        result = result.replacingOccurrences(of: "&nbsp;", with: " ")
        result = result.replacingOccurrences(of: "&amp;", with: "&")
        result = result.replacingOccurrences(of: "&lt;", with: "<")
        result = result.replacingOccurrences(of: "&gt;", with: ">")
        result = result.replacingOccurrences(of: "&quot;", with: "\"")
        result = result.replacingOccurrences(of: "&#39;", with: "'")
        // Replace <br> with newline
        result = result.replacingOccurrences(of: "<br>", with: "\n")
        result = result.replacingOccurrences(of: "<br/>", with: "\n")
        result = result.replacingOccurrences(of: "<br />", with: "\n")
        result = result.replacingOccurrences(of: "</p>", with: "\n\n")
        result = result.replacingOccurrences(of: "</div>", with: "\n")
        // Remove all other HTML tags
        result = result.replacingOccurrences(
            of: "<[^>]+>",
            with: "",
            options: .regularExpression
        )
        // Clean up multiple newlines
        result = result.replacingOccurrences(
            of: "\n{3,}",
            with: "\n\n",
            options: .regularExpression
        )
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Channel Platform Badge
struct ChannelPlatformBadge: View {
    let platform: String

    var body: some View {
        Text(displayName)
            .font(.caption2)
            .fontWeight(.semibold)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(badgeColor)
            .foregroundColor(.white)
            .clipShape(Capsule())
    }

    private var displayName: String {
        switch platform {
        case "SOOP": return "SOOP"
        case "CHZZK": return "CHZZK"
        case "CIME": return "CIME"
        default: return platform
        }
    }

    private var badgeColor: Color {
        switch platform {
        case "SOOP": return Color(red: 0, green: 0.47, blue: 0.95)
        case "CHZZK": return Color(red: 0, green: 0.78, blue: 0.37)
        case "CIME": return Color(red: 0.66, green: 0.33, blue: 0.97)
        default: return .gray
        }
    }
}

// MARK: - Channel Gift Tab
