import SwiftUI

// Adapted LoadingView/EmptyStateView composition, without brand assets or raw errors (R06).
struct ScreenStatus: View {
    let title: String
    let message: String
    var loading = false
    var retry: (() -> Void)? = nil
    var body: some View {
        VStack(spacing: 16) {
            if loading { ProgressView().scaleEffect(1.2) }
            Text(title).font(.headline)
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if let retry { Button("다시 시도", action: retry).buttonStyle(.borderedProminent) }
        }
        .padding(24).frame(maxWidth: .infinity)
    }
}
