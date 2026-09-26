import SwiftUI

// MARK: - View model

@MainActor
final class ChannelHomeSectionViewModel: ObservableObject {
    let channelId: Int

    @Published private(set) var songs: [Song] = []
    @Published private(set) var upcomingSchedules: [Schedule] = []
    @Published private(set) var isLoading = true
    @Published private(set) var songsError = false
    @Published private(set) var schedulesError = false

    private let repository: ChannelRepository

    init(channelId: Int, repository: ChannelRepository = AppClientChannelRepository()) {
        self.channelId = channelId
        self.repository = repository
    }

    func load() async {
        isLoading = true
        songsError = false
        schedulesError = false
        defer { isLoading = false }

        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadSongs() }
            group.addTask { await self.loadSchedules() }
        }
    }

    private func loadSongs() async {
        do {
            let response = try await repository.fetchSongs(page: 1, search: "")
            songs = response.items.map { $0.toDomain() }
        } catch { songsError = true }
    }

    private func loadSchedules() async {
        // 웹은 오늘~+1개월 — ym 기반 API라 이번 달 + 다음 달을 합쳐 근사
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM"

        let now = Date()
        let currentYm = formatter.string(from: now)
        let nextMonth = calendar.date(byAdding: .month, value: 1, to: now) ?? now
        let nextYm = formatter.string(from: nextMonth)

        let current = try? await repository.fetchSchedules(yearMonth: currentYm)
        let next = try? await repository.fetchSchedules(yearMonth: nextYm)
        if current == nil && next == nil { schedulesError = true }
        let items = (current?.items ?? []) + (next?.items ?? [])
        let startOfToday = calendar.startOfDay(for: now)
        var seen = Set<Int>()
        upcomingSchedules = items
            .map { $0.toDomain() }
            .filter { schedule in
                guard !schedule.isCanceled, schedule.startAt >= startOfToday else { return false }
                return seen.insert(schedule.id).inserted
            }
            .sorted { $0.startAt < $1.startAt }
        if upcomingSchedules.count > 3 {
            upcomingSchedules = Array(upcomingSchedules.prefix(3))
        }
    }
}

// MARK: - Home section

/// 채널 홈 섹션 — 웹 section/home.tsx의 미리보기 구성을 iOS 관용구로 이식
struct ChannelHomeSectionView: View {
    let channel: Channel
    let profile: ChannelProfile?
    let refreshRevision: Int
    let onOpenTab: (ChannelDetailView.ChannelTab) -> Void

    @StateObject private var viewModel: ChannelHomeSectionViewModel

    init(
        channel: Channel,
        profile: ChannelProfile?,
        refreshRevision: Int,
        onOpenTab: @escaping (ChannelDetailView.ChannelTab) -> Void
    ) {
        self.channel = channel
        self.profile = profile
        self.refreshRevision = refreshRevision
        self.onOpenTab = onOpenTab
        _viewModel = StateObject(wrappedValue: ChannelHomeSectionViewModel(channelId: channel.id))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            introSection
            songsSection
            scheduleSection
            anniversarySection
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .background(alignment: .topTrailing) {
            Circle()
                .fill(Color.accentColor.opacity(0.10))
                .frame(width: 220, height: 220)
                .blur(radius: 52)
                .offset(x: 92, y: -54)
                .allowsHitTesting(false)
        }
        .task(id: refreshRevision) { await viewModel.load() }
    }

    // MARK: 소개

    @ViewBuilder
    private var introSection: some View {
        glassSection(title: "소개", systemImage: "info.circle.fill") {
            if let description = profile?.homeDescription, !description.isEmpty {
                HTMLTextView(htmlString: description)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("안녕하세요, \(channel.name)의 채널입니다 👋")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: 노래책

    private var songsSection: some View {
        glassSection(title: "최신 등록 노래", systemImage: "music.note.list", tab: .songBook) {
            if viewModel.isLoading && viewModel.songs.isEmpty {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 20)
            } else if viewModel.songsError && viewModel.songs.isEmpty {
                Button("노래를 불러올 수 없어요. 다시 시도") { Task { await viewModel.load() } }
                    .font(.caption).frame(maxWidth: .infinity).padding(14).channelHomeInnerGlass()
            } else if viewModel.songs.isEmpty {
                emptyText("아직 등록된 노래가 없어요")
            } else {
                VStack(spacing: 0) {
                    ForEach(viewModel.songs.prefix(6)) { song in
                        Button {
                            onOpenTab(.songBook)
                        } label: {
                            HStack(spacing: 10) {
                                AsyncImage(url: song.albumArt.flatMap(ChannelImageURL.resolve)) { image in
                                    image.resizable().scaledToFill()
                                } placeholder: {
                                    Image(systemName: "music.note")
                                        .foregroundStyle(.tertiary)
                                        .frame(width: 38, height: 38)
                                        .background(Color(.tertiarySystemFill))
                                }
                                .frame(width: 38, height: 38)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(song.title)
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                    Text(song.artist.name)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        if song.id != viewModel.songs.prefix(6).last?.id {
                            Divider()
                        }
                    }
                }
                .padding(.horizontal, 14)
                .channelHomeInnerGlass()
            }
        }
    }

    // MARK: 일정

    private var scheduleSection: some View {
        glassSection(title: "방송 일정", systemImage: "calendar", tab: .schedule) {
            if viewModel.isLoading && viewModel.upcomingSchedules.isEmpty {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 20)
            } else if viewModel.schedulesError && viewModel.upcomingSchedules.isEmpty {
                Button("일정을 불러올 수 없어요. 다시 시도") { Task { await viewModel.load() } }
                    .font(.caption).frame(maxWidth: .infinity).padding(14).channelHomeInnerGlass()
            } else if viewModel.upcomingSchedules.isEmpty {
                emptyText("예정된 일정이 없어요")
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(viewModel.upcomingSchedules) { schedule in
                        HStack(alignment: .top, spacing: 10) {
                            Label(schedule.scheduleType.displayName, systemImage: schedule.scheduleType.iconName)
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(schedule.scheduleType == .live ? Color.accentColor : .secondary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(.ultraThinMaterial, in: Capsule())
                                .overlay {
                                    ZStack {
                                        Capsule()
                                            .fill(Color.accentColor.opacity(0.06))
                                        Capsule()
                                            .stroke(Color.white.opacity(0.38), lineWidth: 0.5)
                                    }
                                }

                            VStack(alignment: .leading, spacing: 2) {
                                Text(schedule.title)
                                    .font(.caption.weight(.semibold))
                                    .lineLimit(1)
                                Text(Self.scheduleDateText(schedule))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .channelHomeInnerGlass()
            }
        }
    }

    private static func scheduleDateText(_ schedule: Schedule) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = schedule.allDay ? "M월 d일 (E)" : "M월 d일 (E) a h:mm"
        return formatter.string(from: schedule.startAt)
    }

    // MARK: 기념일

    @ViewBuilder
    private var anniversarySection: some View {
        if let anniversaries = profile?.anniversaries {
            glassSection(title: "기념일", systemImage: "party.popper.fill") {
                VStack(alignment: .leading, spacing: 8) {
                    if let event = anniversaries.nextUpcomingEvent {
                        anniversaryRow(
                            label: event.label,
                            value: event.daysUntil == 0 ? "D-DAY" : "D-\(event.daysUntil)",
                            highlighted: true
                        )
                    }
                    if let milestones = anniversaries.milestones {
                        anniversaryRow(
                            label: "방송 시작일로부터",
                            value: "D+\(milestones.daysPassed)",
                            highlighted: false
                        )
                    }
                    if let birthday = anniversaries.birthday {
                        anniversaryRow(
                            label: "생일",
                            value: birthday.daysUntilBirthday == 0 ? "D-DAY" : "D-\(birthday.daysUntilBirthday)",
                            highlighted: false
                        )
                    }
                    if anniversaries.nextUpcomingEvent == nil,
                       anniversaries.milestones == nil,
                       anniversaries.birthday == nil {
                        Text("등록된 기념일이 없어요")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .channelHomeInnerGlass()
            }
        }
    }

    private func anniversaryRow(label: String, value: String, highlighted: Bool) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(highlighted ? .primary : .secondary)
            Spacer()
            Text(value)
                .font(.caption.weight(.bold))
                .foregroundStyle(highlighted ? Color.accentColor : .primary)
        }
    }

    // MARK: helpers

    private func glassSection<Content: View>(
        title: String,
        systemImage: String,
        tab: ChannelDetailView.ChannelTab? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 9) {
                Image(systemName: systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 30, height: 30)
                    .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                Text(title)
                    .font(.headline)

                Spacer()

                if let tab {
                    Button {
                        onOpenTab(tab)
                    } label: {
                        HStack(spacing: 2) {
                            Text("더보기")
                            Image(systemName: "chevron.right")
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    }
                }
            }

            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.58),
                            Color.accentColor.opacity(0.18),
                            Color.primary.opacity(0.06)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 0.8
                )
        }
        .shadow(color: Color.accentColor.opacity(0.08), radius: 14, y: 7)
    }

    private func emptyText(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .channelHomeInnerGlass()
    }
}

private extension View {
    func channelHomeInnerGlass() -> some View {
        background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                ZStack {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color.white.opacity(0.025))
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.48),
                                Color.accentColor.opacity(0.12),
                                Color.primary.opacity(0.05)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 0.7
                    )
                }
            }
            .shadow(color: Color.accentColor.opacity(0.05), radius: 7, y: 3)
    }
}
