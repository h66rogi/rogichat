import SwiftUI

@main
struct RogichatApp: App {
    private let environment = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            VStack(alignment: .leading, spacing: 12) {
                Text(environment.displayName)
                    .font(.largeTitle.bold())
                Text("대화가 시작될 공간을 준비하고 있어요.")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .padding(24)
        }
    }
}
