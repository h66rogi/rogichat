import SwiftUI

// Copied from meloming-ios 18a33bb: ChannelNativeHubViews.swift profile shell and section rail.
// The single Rogichat channel keeps the native layout while unsupported actions are absent.
struct ChannelProfileHero: View {
    let channel: Channel
    let profile: ChannelProfile?
    let favoriteCount: Int
    let onTalk: () -> Void

    private var themeTint: Color {
        Color(hex: channel.themeColor)
    }

    private var description: String? {
        let source = profile?.homeDescription ?? profile?.description ?? channel.channelDescription
        guard let source else { return nil }
        let plain = source
            .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return plain.isEmpty ? nil : plain
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .center, spacing: 18) {
                ChannelProfileAvatar(channel: channel, isLive: false)

                HStack(spacing: 0) {
                    ChannelProfileMetric(value: favoriteCount.formatted(), label: "즐겨찾기")
                    ChannelProfileMetric(value: "\(channel.songCount)", label: "노래")
                    ChannelProfileMetric(value: "\(channel.artistCount)", label: "아티스트")
                }
                .frame(maxWidth: .infinity)

            }

            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 6) {
                    Text(channel.name)
                        .font(.headline.weight(.bold))
                        .lineLimit(1)

                    ChannelVerificationMark(channel: channel)
                }

                Text("@\(channel.webPath)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                if let description {
                    Text(description)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }

            }

            profileActions
        }
        .padding(20)
        .background {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 26, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [themeTint.opacity(0.14), .clear, Color.accentColor.opacity(0.06)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [Color.white.opacity(0.62), themeTint.opacity(0.20), Color.primary.opacity(0.07)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 0.8
                )
        }
        .shadow(color: themeTint.opacity(0.10), radius: 18, y: 8)
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .padding(.bottom, 18)
    }

    @ViewBuilder
    private var profileActions: some View {
        Button(action: onTalk) {
            Label("대화 열기", systemImage: "bubble.left.and.bubble.right.fill")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(ChannelGlassActionButtonStyle(tint: Color.accentColor))
    }
}

private struct ChannelGlassActionButtonStyle: ButtonStyle {
    let tint: Color
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, compact ? 0 : 10)
            .frame(minWidth: compact ? 46 : nil, minHeight: 46)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .fill(tint.opacity(configuration.isPressed ? 0.18 : 0.09))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: [Color.white.opacity(0.64), tint.opacity(0.26), Color.primary.opacity(0.06)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 0.8
                    )
            }
            .shadow(color: tint.opacity(0.10), radius: 7, y: 3)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

struct ChannelOwnerSectionAction: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        HStack {
            Spacer()
            Button(action: action) {
                Label(title, systemImage: systemImage)
                    .font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .tint(Color.accentColor)
            .padding(.horizontal, 20)
        }
        .padding(.bottom, 4)
        .accessibilityHint("이 채널에 \(title)을 합니다")
    }
}

private struct ChannelProfileMetric: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.subheadline.weight(.bold))
                .contentTransition(.numericText())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

private struct ChannelVerificationMark: View {
    let channel: Channel

    var body: some View {
        HStack(spacing: 4) {
            if !channel.verifications.isEmpty {
                Image(systemName: "checkmark.seal.fill")
                    .font(.subheadline)
                    .foregroundStyle(Color.accentColor)
                    .accessibilityLabel("인증 채널")
            }

        }
    }
}

private struct ChannelProfileAvatar: View {
    let channel: Channel
    let isLive: Bool
    @State private var isPulsing = false

    var body: some View {
        ZStack {
            if isLive {
                Circle()
                    .fill(
                        AngularGradient(
                            colors: [
                                .orange,
                                .red,
                                .pink,
                                .orange
                            ],
                            center: .center
                        )
                    )
                    .padding(-4)
                    .scaleEffect(isPulsing ? 1.045 : 1)
                    .opacity(isPulsing ? 0.82 : 1)
            }

            Group {
                if channel.profileImageUrl == "/images/h66rogi-profile.png" {
                    Image("ChannelProfile").resizable().aspectRatio(contentMode: .fill)
                } else if let urlString = channel.profileImageUrl, let url = ChannelImageURL.resolve(urlString) {
                    AsyncImage(url: url) { image in
                        image.resizable().aspectRatio(contentMode: .fill)
                    } placeholder: {
                        Circle().fill(Color(hex: channel.themeColor).opacity(0.16))
                    }
                } else {
                    Circle()
                        .fill(Color(hex: channel.themeColor).opacity(0.16))
                        .overlay {
                            Text(channel.name.prefix(1))
                                .font(.title2.weight(.bold))
                                .foregroundStyle(Color(hex: channel.themeColor))
                        }
                }
            }
            .frame(width: 88, height: 88)
            .clipShape(Circle())
            .overlay {
                Circle().stroke(Color(.systemBackground), lineWidth: 3)
            }
        }
        .frame(width: 96, height: 96)
        .shadow(color: isLive ? Color.orange.opacity(0.3) : .black.opacity(0.12), radius: 10, y: 4)
        .onAppear {
            guard isLive else { return }
            withAnimation(.easeInOut(duration: 1.15).repeatForever(autoreverses: true)) {
                isPulsing = true
            }
        }
        .onChange(of: isLive) { _, live in
            if !live {
                isPulsing = false
            }
        }
        .accessibilityLabel(channel.name)
    }
}

struct ChannelSectionRail: View {
    /// feature-settings 기반 동적 탭 목록 (순서/라벨/노출 반영)
    let tabs: [ChannelDetailView.ChannelResolvedTab]
    @Binding var selectedTab: ChannelDetailView.ChannelTab
    var onSelect: ((ChannelDetailView.ChannelTab) -> Void)?

    private let primaryTint = Color.accentColor

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(tabs) { resolved in
                        Button {
                            select(resolved.tab)
                        } label: {
                            sectionLabel(
                                title: resolved.label,
                                icon: resolved.icon,
                                isSelected: selectedTab == resolved.tab
                            )
                        }
                        .buttonStyle(.plain)
                        .contentShape(Capsule())
                        .accessibilityAddTraits(selectedTab == resolved.tab ? .isSelected : [])
                        .id(resolved.tab)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
            }
            .onAppear {
                proxy.scrollTo(selectedTab, anchor: .center)
            }
            .onChange(of: selectedTab) { _, tab in
                withAnimation(.easeInOut(duration: 0.28)) {
                    proxy.scrollTo(tab, anchor: .center)
                }
            }
        }
        .background(Color.clear)
    }

    private func select(_ tab: ChannelDetailView.ChannelTab) {
        withAnimation(.easeInOut(duration: 0.28)) {
            selectedTab = tab
        }
        onSelect?(tab)
    }

    @ViewBuilder
    private func sectionLabel(
        title: String,
        icon: String,
        isSelected: Bool
    ) -> some View {
        Label(title, systemImage: icon)
            .font(.subheadline.weight(isSelected ? .bold : .medium))
            .foregroundStyle(isSelected ? primaryTint : Color.secondary)
            .padding(.horizontal, 13)
            .padding(.vertical, 9)
            .frame(minHeight: 44)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay {
                Capsule()
                    .fill(primaryTint.opacity(isSelected ? 0.20 : 0.06))
            }
            .overlay {
                Capsule()
                    .stroke(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(isSelected ? 0.72 : 0.52),
                                primaryTint.opacity(isSelected ? 0.44 : 0.20),
                                Color.primary.opacity(0.05)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: isSelected ? 0.9 : 0.6
                    )
            }
            .shadow(
                color: primaryTint.opacity(isSelected ? 0.18 : 0.06),
                radius: isSelected ? 9 : 5,
                y: 3
            )
    }
}
