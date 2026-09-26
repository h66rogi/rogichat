import SwiftUI
import Kingfisher

struct ManualAddSheet: View {
    @ObservedObject var viewModel: ConsoleViewModel
    @Environment(\.dismiss) private var dismiss

    enum Tab: Int, CaseIterable {
        case search = 0
        case manual = 1

        var title: String {
            switch self {
            case .search: return "노래책 검색"
            case .manual: return "직접 입력"
            }
        }
    }

    @State private var selectedTab: Tab = .search

    // Manual input states
    @State private var rawArtist = ""
    @State private var rawTitle = ""
    @State private var rawMessage = ""

    // Search states
    @State private var searchText = ""
    @State private var searchResults: [Song] = []
    @State private var isSearching = false
    @State private var hasSearched = false
    @State private var searchTask: Task<Void, Never>?

    private var isFormValid: Bool {
        !rawArtist.trimmingCharacters(in: .whitespaces).isEmpty &&
        !rawTitle.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("모드", selection: $selectedTab) {
                    ForEach(Tab.allCases, id: \.self) { tab in
                        Text(tab.title).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)

                switch selectedTab {
                case .search:
                    searchTabView
                case .manual:
                    manualTabView
                }
            }
            .navigationTitle("신청곡 추가")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") {
                        dismiss()
                    }
                }

                if selectedTab == .manual {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("추가") {
                            Task {
                                await viewModel.submitManualRequest(
                                    rawArtist: rawArtist.trimmingCharacters(in: .whitespaces),
                                    rawTitle: rawTitle.trimmingCharacters(in: .whitespaces),
                                    songId: nil,
                                    rawMessage: rawMessage.trimmingCharacters(in: .whitespaces).isEmpty ? nil : rawMessage.trimmingCharacters(in: .whitespaces)
                                )
                            }
                        }
                        .disabled(!isFormValid || viewModel.isLoading)
                    }
                }
            }
            .interactiveDismissDisabled(viewModel.isLoading)
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: - Search Tab

    private var searchTabView: some View {
        VStack(spacing: 0) {
            // Search Bar
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)

                TextField("노래 또는 아티스트 검색", text: $searchText)
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()

                if !searchText.isEmpty {
                    Button(action: { searchText = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .padding(12)
            .background(Color(.systemGray6))
            .cornerRadius(10)
            .padding(.horizontal)
            .padding(.bottom, 8)
            .onChange(of: searchText) { _ in
                debounceSearch()
            }

            // Results
            if isSearching {
                Spacer()
                ProgressView()
                    .frame(maxWidth: .infinity)
                Spacer()
            } else if searchResults.isEmpty && hasSearched {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "music.note")
                        .font(.largeTitle)
                        .foregroundColor(.secondary)
                    Text("검색 결과가 없습니다")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Spacer()
            } else if searchResults.isEmpty && !hasSearched {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.largeTitle)
                        .foregroundColor(.secondary)
                    Text("노래를 검색해보세요")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(searchResults) { song in
                            Button {
                                Task {
                                    await viewModel.submitManualRequest(
                                        rawArtist: song.artist.name,
                                        rawTitle: song.title,
                                        songId: song.id,
                                        rawMessage: nil
                                    )
                                }
                            } label: {
                                searchResultRow(song: song)
                            }
                            .buttonStyle(.plain)
                            .disabled(viewModel.isLoading)

                            Divider()
                                .padding(.leading, 72)
                        }
                    }
                }
            }
        }
    }

    private func searchResultRow(song: Song) -> some View {
        HStack(spacing: 12) {
            KFImage(ChannelEnvironment.imageURL(song.albumArt ?? ""))
                .placeholder {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.gray.opacity(0.2))
                        .overlay(
                            Image(systemName: "music.note")
                                .foregroundColor(.gray)
                        )
                }
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: 48, height: 48)
                .cornerRadius(8)

            VStack(alignment: .leading, spacing: 4) {
                Text(song.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(.primary)
                    .lineLimit(1)

                Text(song.artist.name)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Image(systemName: "plus.circle.fill")
                .font(.title3)
                .foregroundColor(.accentColor)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    private func debounceSearch() {
        searchTask?.cancel()

        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else {
            searchResults = []
            hasSearched = false
            return
        }

        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await performSearch(query: query)
        }
    }

    private func performSearch(query: String) async {
        isSearching = true
        do {
            let response = try await ChannelAPIClient.shared.request(
                endpoint: .channelSongs(
                    channelId: viewModel.channelId,
                    page: 1,
                    limit: 30,
                    categoryId: nil,
                    artistId: nil,
                    difficulty: nil,
                    search: query
                ),
                responseType: SongsResponse.self
            )
            searchResults = response.items.map { $0.toDomain() }
        } catch {
            if !Task.isCancelled {
                searchResults = []
            }
        }
        hasSearched = true
        isSearching = false
    }

    // MARK: - Manual Tab

    private var manualTabView: some View {
        Form {
            Section("곡 정보") {
                TextField("아티스트", text: $rawArtist)
                    .textContentType(.name)

                TextField("곡 제목", text: $rawTitle)
            }

            Section("메시지 (선택)") {
                TextField("요청 메시지", text: $rawMessage)
            }
        }
    }
}
