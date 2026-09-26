import SwiftUI
import Kingfisher

// New Rogichat section: the native reference has no setlist tab.
struct ChannelSetlistView: View {
    let identifier: String
    @State private var items: [ChannelSetlistSummary] = []
    @State private var selected: ChannelSetlistSummary?
    @State private var page = 0
    @State private var total = 0
    @State private var loading = false
    @State private var error: Error?

    var body: some View {
        VStack(spacing: 12) {
            if loading && items.isEmpty {
                LoadingView()
            } else if let error, items.isEmpty {
                ErrorView(error: error) { Task { await load(reset: true) } }
            } else if items.isEmpty {
                EmptyStateView(icon: "list.number", title: "아직 공개된 셋리스트가 없어요", message: "방송에서 부른 노래를 이곳에서 볼 수 있어요.")
            } else {
                ForEach(items) { item in
                    Button { selected = item } label: {
                        HStack(spacing: 14) {
                            KFImage(ChannelEnvironment.imageURL(item.albumArtPreviews.first))
                                .placeholder { Image(systemName: "music.note.list").foregroundStyle(.secondary) }
                                .resizable().scaledToFill().frame(width: 64, height: 64)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                            VStack(alignment: .leading, spacing: 5) {
                                Text(item.dateTitle).font(.headline).foregroundStyle(.primary)
                                Text("\(item.completedCount)곡").font(.subheadline).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        }
                        .padding(16)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
                        .overlay { RoundedRectangle(cornerRadius: 20).stroke(Color.primary.opacity(0.08), lineWidth: 0.5) }
                    }.buttonStyle(.plain)
                }
                if items.count < total {
                    if error != nil {
                        Button("다시 시도") { Task { await load(reset: false) } }
                    } else {
                        ProgressView().padding().task { await load(reset: false) }
                    }
                }
            }
        }
        .padding(.horizontal, 16).padding(.top, 12)
        .task(id: identifier) { await load(reset: true) }
        .sheet(item: $selected) { item in
            ChannelSetlistDetailView(identifier: identifier, summary: item)
        }
    }

    private func load(reset: Bool) async {
        guard !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        let nextPage = reset ? 1 : page + 1
        do {
            let response = try await ChannelAPIClient.shared.request(endpoint: .channelSetlists(identifier: identifier, page: nextPage), responseType: ChannelSetlistsResponse.self)
            items = reset ? response.setlists : items + response.setlists.filter { row in !items.contains(where: { $0.id == row.id }) }
            page = nextPage; total = response.total
        } catch is CancellationError { }
        catch { self.error = error }
    }
}

private struct ChannelSetlistDetailView: View {
    let identifier: String
    let summary: ChannelSetlistSummary
    @Environment(\.dismiss) private var dismiss
    @State private var detail: ChannelSetlistDetail?
    @State private var error: Error?

    var body: some View {
        NavigationStack {
            Group {
                if let detail {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            VStack(spacing: 8) {
                                Text(detail.summary.dateTitle).font(.title3.bold())
                                Text("\(detail.summary.completedCount)곡").font(.subheadline).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity).padding(24)
                            ForEach(Array(detail.songs.enumerated()), id: \.element.id) { index, song in
                                HStack(spacing: 12) {
                                    Text("\(index + 1)").font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 24)
                                    KFImage(ChannelEnvironment.imageURL(song.albumArt))
                                        .placeholder { Image(systemName: "music.note").foregroundStyle(.secondary) }
                                        .resizable().scaledToFill().frame(width: 48, height: 48).clipShape(RoundedRectangle(cornerRadius: 8))
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(song.title).font(.subheadline.weight(.semibold))
                                        Text(song.artist).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }.padding(.horizontal, 16).padding(.vertical, 10)
                                Divider().padding(.leading, 52)
                            }
                        }
                    }
                } else if let error {
                    ErrorView(error: error) { Task { await load() } }
                } else { LoadingView() }
            }
            .navigationTitle("셋리스트").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
            .task { await load() }
        }
    }
    private func load() async {
        error = nil
        do {
            detail = try await ChannelAPIClient.shared.request(endpoint: .channelSetlist(identifier: identifier, sessionID: summary.sessionId), responseType: ChannelSetlistDetail.self)
        } catch is CancellationError { }
        catch { self.error = error }
    }
}

struct ChannelSetlistsResponse: Decodable { let setlists: [ChannelSetlistSummary]; let total: Int }
struct ChannelSetlistSummary: Decodable, Identifiable {
    let sessionId: Int
    let startedAt: String
    let completedCount: Int
    let albumArtPreviews: [String]
    var id: Int { sessionId }
    var dateTitle: String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: startedAt) ?? ISO8601DateFormatter().date(from: startedAt) else { return "셋리스트" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.dateFormat = "yyyy년 M월 d일"
        return formatter.string(from: date)
    }
}
struct ChannelSetlistDetail: Decodable { let summary: ChannelSetlistSummary; let songs: [ChannelSetlistSong] }
struct ChannelSetlistSong: Decodable, Identifiable { let id: Int; let title: String; let artist: String; let albumArt: String? }
