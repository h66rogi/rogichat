import SwiftUI

struct WireCard<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.background)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.secondary.opacity(0.4)))
        .accessibilityElement(children: .contain)
    }
}
