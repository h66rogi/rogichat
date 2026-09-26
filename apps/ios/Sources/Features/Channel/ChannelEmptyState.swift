import SwiftUI

/// iOS 16-compatible empty/error state. `ContentUnavailableView` is iOS 17+,
/// while Core V2 keeps the same native fallback floor as the rest of the app.
struct ChannelEmptyState: View {
    let title: String
    let systemImage: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 38, weight: .medium))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.bordered)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(24)
    }
}
