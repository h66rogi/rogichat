import SwiftUI

struct MessageSearchScreen: View {
    let session: AppSession
    let scope: UInt64
    let onOpen: (MessageSearchHit) -> Void
    @State private var query = ""
    @State private var submitted = ""
    @State private var items: [MessageSearchHit] = []
    @State private var cursor: String?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 12) {
            Text("내가 볼 수 있는 모든 대화에서 찾습니다.")
                .font(.subheadline).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack {
                TextField("메시지 문장 검색", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit { Task { await search() } }
                Button("검색") { Task { await search() } }
                    .disabled(loading || query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
            }
            .padding(12)
            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            if loading && items.isEmpty { ProgressView("대화 내용을 찾는 중") }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
                Button("다시 시도") { Task { await search(term: submitted, next: cursor) } }
            }
            if !loading && error == nil && !submitted.isEmpty && items.isEmpty {
                ContentUnavailableView("찾은 메시지가 없어요", systemImage: "magnifyingglass")
            }
            List {
                ForEach(items) { hit in
                    Button { onOpen(hit) } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("\(hit.roomName) · \(hit.author)").font(.subheadline.weight(.semibold))
                            Text(hit.excerpt).font(.body).lineLimit(4)
                            Text(hit.createdAt).font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.plain)
                }
                if cursor != nil {
                    Button(loading ? "더 찾는 중" : "더 보기") {
                        Task { await search(term: submitted, next: cursor) }
                    }.disabled(loading)
                }
            }.listStyle(.plain)
        }
        .padding(.horizontal, 16)
        .navigationTitle("대화 내용 검색")
    }

    private func search(term: String? = nil, next: String? = nil) async {
        guard !loading else { return }
        let phrase = (term ?? query).trimmingCharacters(in: .whitespacesAndNewlines)
        guard phrase.count >= 2 && phrase.count <= 100 else { return }
        loading = true; error = nil
        if next == nil { submitted = phrase; items = []; cursor = nil }
        defer { loading = false }
        do {
            let page = try await session.searchMessages(query: phrase, cursor: next, scope: scope)
            if next == nil { items = page.items }
            else { items.append(contentsOf: page.items.filter { hit in !items.contains(where: { $0.id == hit.id }) }) }
            cursor = page.nextCursor
        } catch { self.error = "검색하지 못했어요. 연결 상태를 확인해 주세요." }
    }
}
