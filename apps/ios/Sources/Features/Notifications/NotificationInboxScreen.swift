import SwiftUI

// Adapted from Meloming/Presentation/Notifications/NotificationsView.swift and
// NotificationsViewModel.swift: native List, empty/error states, refresh, paging,
// read actions and relative time. Rogichat supplies its own authorized API.
private extension InboxNotification {
    var relativeTime: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: createdAt) else { return "" }
        let relative = RelativeDateTimeFormatter()
        relative.locale = Locale(identifier: "ko_KR")
        relative.unitsStyle = .abbreviated
        return relative.localizedString(for: date, relativeTo: Date())
    }
}

struct NotificationInboxScreen: View {
    let session: AppSession
    let scope: UInt64
    let onOpenRoom: (String) -> Void
    let onOpenSettings: () -> Void
    @State private var items: [InboxNotification] = []
    @State private var cursor: String?
    @State private var loading = true
    @State private var loadingMore = false
    @State private var markingAll = false
    @State private var error: String?

    var body: some View {
        Group {
            if loading && items.isEmpty { ProgressView("알림을 확인하는 중").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if let error, items.isEmpty {
                ContentUnavailableView {
                    Label("알림을 불러올 수 없어요", systemImage: "bell.slash")
                } description: { Text(error) } actions: {
                    Button("다시 시도") { Task { await refresh() } }
                }
            } else if items.isEmpty {
                ContentUnavailableView("알림이 없습니다", systemImage: "bell", description: Text("새로운 알림이 도착하면 여기에 표시됩니다"))
            } else {
                List {
                    ForEach(items) { item in
                        Button { Task { await open(item) } } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: "bubble.left.fill")
                                    .foregroundStyle(AppTheme.accent)
                                    .frame(width: 32, height: 32)
                                    .background(AppTheme.accent.opacity(0.1), in: Circle())
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(item.title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                                        Spacer(minLength: 8)
                                        Text(item.relativeTime).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Text(item.body).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                                }
                                if !item.isRead { Circle().fill(AppTheme.accent).frame(width: 8, height: 8) }
                            }
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                            .background(item.isRead ? Color.clear : AppTheme.accent.opacity(0.05))
                        }.buttonStyle(.plain)
                    }
                    if cursor != nil {
                        ProgressView().frame(maxWidth: .infinity).task { await loadMore() }
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                }
                .listStyle(.plain)
                .refreshable { await refresh() }
            }
        }
        .navigationTitle("알림")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("알림 설정", systemImage: "gearshape", action: onOpenSettings)
                    if items.contains(where: { !$0.isRead }) {
                        Button("모두 읽기") { Task { await markAll() } }.disabled(markingAll)
                    }
                } label: { Image(systemName: "ellipsis.circle").accessibilityLabel("알림 메뉴") }
            }
        }
        .task(id: scope) { await refresh() }
    }

    private func refresh() async {
        loading = true; error = nil
        do {
            let page = try await session.notificationInbox(cursor: nil, scope: scope)
            items = page.items; cursor = page.nextCursor
        } catch { self.error = "연결을 확인하고 다시 시도해 주세요." }
        loading = false
    }
    private func loadMore() async {
        guard let cursor, !loadingMore else { return }
        loadingMore = true; defer { loadingMore = false }
        do {
            let page = try await session.notificationInbox(cursor: cursor, scope: scope)
            items.append(contentsOf: page.items.filter { item in !items.contains(where: { $0.id == item.id }) })
            self.cursor = page.nextCursor
        } catch { self.error = "알림을 더 불러오지 못했어요. 다시 시도해 주세요." }
    }
    private func open(_ item: InboxNotification) async {
        if !item.isRead {
            do {
                try await session.markNotificationRead(id: item.id, scope: scope)
                if let index = items.firstIndex(where: { $0.id == item.id }) { items[index].readAt = ISO8601DateFormatter().string(from: Date()) }
            } catch { self.error = "읽음 상태를 저장하지 못했어요." }
        }
        onOpenRoom(item.roomId)
    }
    private func markAll() async {
        guard !markingAll else { return }
        markingAll = true; defer { markingAll = false }
        for item in items where !item.isRead {
            do {
                try await session.markNotificationRead(id: item.id, scope: scope)
                if let index = items.firstIndex(where: { $0.id == item.id }) { items[index].readAt = ISO8601DateFormatter().string(from: Date()) }
            } catch { self.error = "일부 알림의 읽음 상태를 저장하지 못했어요."; break }
        }
    }
}
