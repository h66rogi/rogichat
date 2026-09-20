import SwiftUI

// Adapted MyPageSection/MyActionRow implementation units. Provenance R05 in mobile-reuse-audit.md.
struct SettingsSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3.weight(.bold)).padding(.horizontal, 2).accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) { content }
                .padding(.vertical, 2)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
    }
}
struct SettingsRow: View {
    let icon: String
    let title: String
    let subtitle: String
    var tint: Color = .accentColor
    var enabled = true
    var action: (() -> Void)? = nil

    private var label: some View {
        HStack(spacing: 13) {
            Image(systemName: icon).font(.body.weight(.semibold)).foregroundStyle(tint)
                .frame(width: 38, height: 38)
                .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                Text(subtitle).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if action != nil && enabled {
                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11).frame(minHeight: 52)
        .contentShape(Rectangle())
    }
    var body: some View {
        if let action {
            Button(action: action) { label }.buttonStyle(.plain).disabled(!enabled)
                .accessibilityElement(children: .combine)
        } else {
            label.accessibilityElement(children: .combine)
        }
    }
}
