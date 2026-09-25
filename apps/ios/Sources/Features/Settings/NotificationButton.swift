import SwiftUI

// Copied from meloming-ios d133fb4,
// Meloming/Presentation/Common/Components/NotificationButton.swift.
// Rogichat has no unread-count endpoint, so only the unbadged branch is retained.
struct NotificationButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "bell")
                .symbolRenderingMode(.palette)
                .foregroundStyle(Color.primary, Color.primary)
                .font(.title3)
        }
    }
}
