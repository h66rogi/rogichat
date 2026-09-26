import SwiftUI
import Kingfisher
import SafariServices

struct ChannelDetailView: View {
    let identifier: String
    let onTalk: () -> Void
    var initialTab: ChannelTab = .songbook

    @StateObject private var viewModel: ChannelDetailViewModel
    @StateObject private var songRequestManager: SongRequestManager
    @State private var showQueue = false
    @State private var showManagement = false
    @State private var showConsole = false
    @State private var selectedTab: ChannelTab
    @State private var showAddSong = false
    @State private var showAddSchedule = false
    @State private var songBookRefreshToken = UUID()
    @State private var scheduleRefreshToken = UUID()

    enum ChannelTab: String, CaseIterable {
        case songbook = "노래책"
        case schedule = "일정"
        case setlist = "셋리스트"
        case wardrobe = "옷장"
        case info = "정보"

        var icon: String {
            switch self {
            case .songbook: return "music.note.list"
            case .schedule: return "calendar"
            case .setlist: return "list.number"
            case .wardrobe: return "tshirt"
            case .info: return "info.circle"
            }
        }
    }

    init(identifier: String = "h66rogi", initialTab: ChannelTab = .songbook, onTalk: @escaping () -> Void = {}) {
        self.identifier = identifier
        self.onTalk = onTalk
        self._songRequestManager = StateObject(wrappedValue: SongRequestManager(identifier: identifier))
        self.initialTab = initialTab
        self._viewModel = StateObject(wrappedValue: ChannelDetailViewModel(identifier: identifier))
        self._selectedTab = State(initialValue: initialTab)
    }

    var body: some View {
        Group {
            if viewModel.isLoading {
                LoadingView()
            } else if let channel = viewModel.channel {
                ScrollView {
                    VStack(spacing: 0) {
                        // Header
                        ChannelHeader(channel: channel, favoriteCount: viewModel.favoriteCount)

                        // Tab Selector
                        Picker("Tab", selection: $selectedTab) {
                            ForEach(ChannelTab.allCases, id: \.self) { tab in
                                Label(tab.rawValue, systemImage: tab.icon)
                                    .tag(tab)
                            }
                        }
                        .pickerStyle(.segmented)
                        .padding()

                        // Tab Content
                        switch selectedTab {
                        case .songbook:
                            SongBookView(channelId: channel.id, identifier: channel.webPath, refreshToken: songBookRefreshToken, songRequestManager: songRequestManager, onShowQueue: { showQueue = true })
                        case .schedule:
                            ScheduleView(channelId: channel.id, refreshToken: scheduleRefreshToken, canEdit: viewModel.canManageContent)
                        case .setlist:
                            ChannelSetlistView(identifier: channel.webPath)
                        case .wardrobe:
                            ChannelWardrobeView(identifier: channel.webPath)
                        case .info:
                            if viewModel.canManageSettings {
                                Button("채널 관리", systemImage: "gearshape") { showManagement = true }
                                    .padding(.top)
                            }
                            if viewModel.canManageContent {
                                Button("신청곡 콘솔", systemImage: "music.note.list") { showConsole = true }
                                    .padding(.top)
                            }
                            ChannelInfoView(channel: channel, profile: viewModel.profile, favoriteCount: viewModel.favoriteCount)
                        }
                    }
                }
                .refreshable {
                    switch selectedTab {
                    case .songbook:
                        songBookRefreshToken = UUID()
                    case .schedule:
                        scheduleRefreshToken = UUID()
                    case .setlist, .wardrobe, .info:
                        await viewModel.loadChannel()
                    }
                }
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
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button(action: onTalk) { Image(systemName: "chevron.left") }
                    .accessibilityLabel("대화로 돌아가기")
                    .tint(.primary)
            }
            ToolbarItem(placement: .principal) {
                if let channel = viewModel.channel {
                    HStack {
                        Text(channel.name)
                            .font(.headline)
                            .lineLimit(1)
                        Spacer()
                    }
                    .frame(maxWidth: .infinity)
                }
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                if let channel = viewModel.channel {
                    let webURL = ChannelEnvironment.webURL
                    ShareLink(
                        item: URL(string: "\(webURL.absoluteString)/channel/\(channel.webPath)")!,
                        subject: Text(channel.name),
                        message: Text("\(channel.name) - 로기챗")
                    ) {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                if viewModel.canManageContent {
                    if selectedTab == .songbook {
                        Button {
                            showAddSong = true
                        } label: {
                            Image(systemName: "plus")
                        }
                    } else if selectedTab == .schedule {
                        Button {
                            showAddSchedule = true
                        } label: {
                            Image(systemName: "plus")
                        }
                    }
                }
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    Task {
                        await viewModel.toggleFavorite()
                    }
                } label: {
                    Image(systemName: viewModel.isFavorited ? "star.fill" : "star")
                        .foregroundColor(viewModel.isFavorited ? .yellow : .primary)
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
        .sheet(isPresented: $showQueue) {
            SongRequestQueueSheet(manager: songRequestManager)
                .presentationDetents([.medium, .large])
        }
        .navigationDestination(isPresented: $showManagement) {
            if let channel = viewModel.channel {
                ChannelManagementView(channelId: channel.id, channelName: channel.name, identifier: identifier)
            }
        }
        .navigationDestination(isPresented: $showConsole) {
            if let channel = viewModel.channel {
                ConsoleView(channelId: channel.id, channelIdentifier: channel.webPath)
            }
        }
        .task {
            await ChannelSession.shared.refresh()
            await viewModel.loadChannel()
            await songRequestManager.fetchLiveState()
            songRequestManager.start()
        }
        .onDisappear { songRequestManager.stop() }
    }
}

// MARK: - Channel Header
struct ChannelHeader: View {
    let channel: Channel
    let favoriteCount: Int

    private var themeColor: Color {
        Color(hex: channel.themeColor)
    }

    private var textColor: Color {
        themeColor.isLight ? .black : .white
    }

    var body: some View {
        VStack(spacing: 0) {
            // Theme Color Background Area
            ZStack(alignment: .bottom) {
                // Background
                themeColor
                    .frame(height: channel.topBannerUrl != nil ? 230 : 160)

                VStack(spacing: 0) {
                    // Banner (if exists)
                    if let bannerUrl = channel.topBannerUrl {
                        KFImage(ChannelEnvironment.imageURL(bannerUrl))
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(height: 120)
                            .clipped()
                    }

                    // Profile Area with theme color background
                    HStack(spacing: 16) {
                        // Profile Image
                        KFImage(ChannelEnvironment.imageURL(channel.profileImageUrl ?? ""))
                            .placeholder {
                                Circle()
                                    .fill(Color.white.opacity(0.3))
                                    .overlay(
                                        Text(channel.name.prefix(1))
                                            .font(.title.bold())
                                            .foregroundColor(textColor)
                                    )
                            }
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 72, height: 72)
                            .clipShape(Circle())
                            .overlay(
                                Circle()
                                    .stroke(Color.white, lineWidth: 3)
                            )
                            .shadow(color: .black.opacity(0.2), radius: 4, x: 0, y: 2)

                        // Name and Stats
                        VStack(alignment: .leading, spacing: 6) {
                            Text(channel.name)
                                .font(.title3.bold())
                                .foregroundColor(textColor)

                            HStack(spacing: 12) {
                                Label("\(channel.songCount)곡", systemImage: "music.note")
                                Label("\(favoriteCount)", systemImage: "star.fill")
                            }
                            .font(.subheadline)
                            .foregroundColor(textColor.opacity(0.8))
                        }

                        Spacer()
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 16)
                }
            }
        }
    }
}

// MARK: - Color Extension for Light/Dark detection
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
