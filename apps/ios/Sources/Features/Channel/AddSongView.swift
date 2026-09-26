import SwiftUI

struct AddSongView: View {
    let channelId: Int
    let identifier: String
    var onComplete: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: AddSongViewModel
    @State private var isAdditionalInfoExpanded = false
    @State private var isMemoExpanded = false
    @State private var showAlbumArtPicker = false

    init(channelId: Int, identifier: String, onComplete: (() -> Void)? = nil) {
        self.channelId = channelId
        self.identifier = identifier
        self.onComplete = onComplete
        self._viewModel = StateObject(wrappedValue: AddSongViewModel(channelId: channelId, identifier: identifier))
    }

    var body: some View {
        NavigationStack {
            Form {
                // MARK: - Required Section
                Section {
                    // Title
                    TextField("노래 제목", text: $viewModel.title)
                        .textContentType(.none)
                        .autocorrectionDisabled()

                    // Artist
                    artistField

                    // Categories
                    categoriesField

                    // Difficulty
                    difficultyField

                } header: {
                    Text("필수 항목")
                } footer: {
                    Text("노래 제목, 아티스트, 카테고리, 난이도는 필수입니다.")
                }

                // MARK: - Album Art Section
                Section {
                    albumArtField
                } header: {
                    Text("앨범 아트 (선택)")
                }

                // MARK: - Optional Fields Section (Collapsible)
                Section {
                    DisclosureGroup("추가 정보 (선택)", isExpanded: $isAdditionalInfoExpanded) {
                        // Song Key & BPM
                        HStack {
                            VStack(alignment: .leading) {
                                Text("키")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("예: C#", text: $viewModel.songKey)
                            }

                            Divider()

                            VStack(alignment: .leading) {
                                Text("BPM")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("예: 120", text: $viewModel.bpmString)
                                    .keyboardType(.numberPad)
                            }
                        }

                        // URLs
                        VStack(alignment: .leading, spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("노래방 URL")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("https://...", text: $viewModel.karaokeUrl)
                                    .keyboardType(.URL)
                                    .autocapitalization(.none)
                            }

                            VStack(alignment: .leading, spacing: 4) {
                                Text("원곡 유튜브 URL")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("https://...", text: $viewModel.originalUrl)
                                    .keyboardType(.URL)
                                    .autocapitalization(.none)
                            }

                            VStack(alignment: .leading, spacing: 4) {
                                Text("본인 커버 URL")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("https://...", text: $viewModel.coverUrl)
                                    .keyboardType(.URL)
                                    .autocapitalization(.none)
                            }

                            VStack(alignment: .leading, spacing: 4) {
                                Text("가사 링크")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("https://...", text: $viewModel.lyricsLink)
                                    .keyboardType(.URL)
                                    .autocapitalization(.none)
                            }
                        }
                    }
                }

                // MARK: - Memo Section (Collapsible)
                Section {
                    DisclosureGroup("메모 (선택)", isExpanded: $isMemoExpanded) {
                        TextEditor(text: $viewModel.lyricsText)
                            .frame(minHeight: 100)

                        Text("가사나 개인 메모를 입력하세요. 채널 관리자만 볼 수 있습니다.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("노래 추가")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("추가") {
                        Task {
                            let success = await viewModel.createSong()
                            if success {
                                onComplete?()
                                dismiss()
                            }
                        }
                    }
                    .disabled(!viewModel.isValid || viewModel.isLoading)
                }
            }
            .disabled(viewModel.isLoading)
            .overlay {
                if viewModel.isLoading {
                    Color.black.opacity(0.3)
                        .ignoresSafeArea()
                    ProgressView("추가 중...")
                        .padding()
                        .background(.regularMaterial)
                        .cornerRadius(12)
                }
            }
            .alert("오류", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("확인") {
                    viewModel.errorMessage = nil
                }
            } message: {
                if let message = viewModel.errorMessage {
                    Text(message)
                }
            }
            .task {
                await viewModel.loadData()
            }
            .sheet(isPresented: $showAlbumArtPicker) {
                AlbumArtPickerView(
                    title: viewModel.title,
                    artist: viewModel.artistName,
                    onSelect: { url in
                        viewModel.albumArt = url
                    }
                )
            }
        }
    }

    // MARK: - Artist Field
    private var artistField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("아티스트")
                .font(.caption)
                .foregroundColor(.secondary)

            TextField("아티스트 이름 입력", text: $viewModel.artistName)
                .autocorrectionDisabled()

            if !viewModel.artists.isEmpty {
                let filteredArtists = viewModel.filteredArtists

                if !filteredArtists.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(filteredArtists, id: \.id) { artist in
                                Button {
                                    viewModel.artistName = artist.name
                                } label: {
                                    Text(artist.name)
                                        .font(.subheadline)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                        .background(
                                            viewModel.artistName == artist.name
                                                ? Color.accentColor
                                                : Color(.systemGray5)
                                        )
                                        .foregroundColor(
                                            viewModel.artistName == artist.name
                                                ? .white
                                                : .primary
                                        )
                                        .cornerRadius(16)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                } else if !viewModel.artistName.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "plus.circle.fill")
                            .foregroundColor(.accentColor)
                        Text("'\(viewModel.artistName)' 새 아티스트로 추가됩니다")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    // MARK: - Categories Field
    private var categoriesField: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("카테고리")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                if !viewModel.selectedCategories.isEmpty {
                    Text("\(viewModel.selectedCategories.count)개 선택")
                        .font(.caption)
                        .foregroundColor(.accentColor)
                }
            }

            if viewModel.categories.isEmpty {
                TextField("카테고리 이름 (쉼표로 구분)", text: $viewModel.newCategoryName)
            } else {
                // Show existing categories as toggle chips
                FlowLayout(spacing: 8) {
                    ForEach(viewModel.categories, id: \.id) { category in
                        let isSelected = viewModel.selectedCategories.contains(category.name)
                        let color = Color(hex: category.color ?? "#3B82F6")

                        Button {
                            viewModel.toggleCategory(category.name)
                        } label: {
                            HStack(spacing: 4) {
                                Circle()
                                    .fill(color)
                                    .frame(width: 8, height: 8)

                                Text(category.name)
                                    .font(.subheadline)

                                if isSelected {
                                    Image(systemName: "checkmark")
                                        .font(.caption.bold())
                                }
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(
                                isSelected
                                    ? color.opacity(0.2)
                                    : Color(.systemGray6)
                            )
                            .foregroundColor(isSelected ? color : .primary)
                            .overlay(
                                RoundedRectangle(cornerRadius: 16)
                                    .stroke(isSelected ? color : Color.clear, lineWidth: 1)
                            )
                            .cornerRadius(16)
                        }
                        .buttonStyle(.plain)
                    }
                }

                TextField("또는 새 카테고리 입력", text: $viewModel.newCategoryName)
                    .font(.subheadline)
            }
        }
    }

    // MARK: - Difficulty Field
    private var difficultyField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("난이도")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack(spacing: 4) {
                ForEach(1...5, id: \.self) { star in
                    Button {
                        viewModel.difficulty = star
                    } label: {
                        Image(systemName: star <= viewModel.difficulty ? "star.fill" : "star")
                            .font(.title2)
                            .foregroundColor(star <= viewModel.difficulty ? .yellow : .gray)
                    }
                    .buttonStyle(.plain)
                }

                Spacer()

                Text("(\(viewModel.difficulty)/5)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Album Art Field
    private var albumArtField: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Search button
            Button {
                showAlbumArtPicker = true
            } label: {
                HStack {
                    Image(systemName: "magnifyingglass")
                    Text("앨범아트 검색")
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(viewModel.canSearchAlbumArt ? Color.accentColor : Color(.systemGray4))
                .foregroundColor(.white)
                .cornerRadius(10)
            }
            .disabled(!viewModel.canSearchAlbumArt)

            if !viewModel.canSearchAlbumArt {
                Text("노래 제목과 아티스트를 입력하면 앨범아트를 검색할 수 있습니다")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            // Manual URL input
            TextField("또는 URL 직접 입력", text: $viewModel.albumArt)
                .keyboardType(.URL)
                .textContentType(.URL)
                .autocapitalization(.none)
                .autocorrectionDisabled()

            // Preview
            if !viewModel.albumArt.isEmpty, let url = URL(string: viewModel.albumArt) {
                HStack {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: 100, height: 100)
                                .clipped()
                                .cornerRadius(8)
                        case .failure:
                            Label("이미지를 불러올 수 없습니다", systemImage: "exclamationmark.triangle")
                                .foregroundColor(.red)
                                .font(.caption)
                        default:
                            ProgressView()
                                .frame(width: 100, height: 100)
                        }
                    }

                    Spacer()

                    Button {
                        viewModel.albumArt = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
    }
}

// MARK: - Album Art Picker View
struct AlbumArtPickerView: View {
    let title: String
    let artist: String
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var images: [AlbumArtImage] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("검색 중...")
                } else if let error = errorMessage {
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundColor(.secondary)
                        Text(error)
                            .foregroundColor(.secondary)
                        Button("다시 시도") {
                            Task { await searchImages() }
                        }
                    }
                } else if images.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.largeTitle)
                            .foregroundColor(.secondary)
                        Text("검색 결과가 없습니다")
                            .foregroundColor(.secondary)
                    }
                } else {
                    ScrollView {
                        LazyVGrid(columns: [
                            GridItem(.flexible()),
                            GridItem(.flexible()),
                            GridItem(.flexible())
                        ], spacing: 12) {
                            ForEach(images) { image in
                                Button {
                                    onSelect(image.imageUrl)
                                    dismiss()
                                } label: {
                                    AsyncImage(url: URL(string: image.thumbnailUrl ?? image.imageUrl)) { phase in
                                        switch phase {
                                        case .success(let img):
                                            img
                                                .resizable()
                                                .aspectRatio(contentMode: .fill)
                                                .frame(width: 100, height: 100)
                                                .clipped()
                                                .cornerRadius(8)
                                        case .failure:
                                            Rectangle()
                                                .fill(Color(.systemGray5))
                                                .frame(width: 100, height: 100)
                                                .cornerRadius(8)
                                                .overlay(
                                                    Image(systemName: "photo")
                                                        .foregroundColor(.secondary)
                                                )
                                        default:
                                            Rectangle()
                                                .fill(Color(.systemGray5))
                                                .frame(width: 100, height: 100)
                                                .cornerRadius(8)
                                                .overlay(ProgressView())
                                        }
                                    }
                                }
                            }
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("앨범아트 선택")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") {
                        dismiss()
                    }
                }
            }
            .task {
                await searchImages()
            }
        }
    }

    private func searchImages() async {
        isLoading = true
        errorMessage = nil

        do {
            let response = try await ChannelAPIClient.shared.request(
                endpoint: .searchAlbumArt(title: title, artist: artist),
                responseType: AlbumArtSearchResponse.self
            )
            images = response.images
        } catch {
            errorMessage = "이미지 검색에 실패했습니다"
        }

        isLoading = false
    }
}

// MARK: - Album Art Models
struct AlbumArtImage: Identifiable, Decodable {
    var id: String { imageUrl }
    let title: String
    let imageUrl: String
    let thumbnailUrl: String?
}

struct AlbumArtSearchResponse: Decodable {
    let images: [AlbumArtImage]
}
