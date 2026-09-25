import SwiftUI

// Copied from meloming-ios d133fb4, Meloming/Presentation/More/ServiceGridSection.swift.
// Rogichat has four live destinations, so the Meloming-only all-services slot is omitted.
struct ServiceGridSection: View {
    let gridServices: [ServiceItem]
    let onServiceTap: (ServiceItem) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(gridServices.chunked(into: 4).enumerated()), id: \.offset) { _, row in
                HStack(spacing: 0) {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, item in
                        ServiceGridItem(item: item) { onServiceTap(item) }
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
        .padding(.vertical, 8)
    }
}

private struct ServiceGridItem: View {
    let item: ServiceItem
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 14)
                    .fill(item.iconBgColor)
                    .frame(width: 48, height: 48)
                    .overlay(Text(item.iconEmoji).font(.system(size: 22)))
                Text(item.name)
                    .font(.system(size: 11))
                    .foregroundColor(.primary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 4)
        }
        .buttonStyle(.plain)
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
