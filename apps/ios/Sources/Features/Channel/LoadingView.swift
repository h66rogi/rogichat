import SwiftUI

struct LoadingView: View {
    var message: String? = nil
    var showLogo: Bool = false

    var body: some View {
        VStack(spacing: 24) {
            if showLogo {
                Image("MelomingLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 120, height: 120)
                    .clipShape(RoundedRectangle(cornerRadius: 24))
            }

            ProgressView()
                .scaleEffect(1.2)

            if let message = message {
                Text(message)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}
