import Foundation

struct AppEnvironment: Sendable {
    enum Name: String, Sendable {
        case qa
        case prod
    }

    let name: Name
    let apiBaseURL: URL
    let displayName: String
    let keychainService: String

    init(bundle: Bundle = .main) {
        guard let rawName = bundle.object(forInfoDictionaryKey: "RogichatEnvironment") as? String,
              let name = Name(rawValue: rawName),
              let rawURL = bundle.object(forInfoDictionaryKey: "RogichatAPIBaseURL") as? String,
              let url = URL(string: rawURL),
              let bundleID = bundle.bundleIdentifier,
              let displayName = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
        else { preconditionFailure("Missing app environment configuration") }

        let expectedID = name == .qa ? "chat.rogi.rogichat.qa" : "chat.rogi.rogichat"
        let expectedURL = name == .qa ? "https://api.qa.rogi.chat/v1/" : "https://api.rogi.chat/v1/"
        precondition(bundleID == expectedID && rawURL == expectedURL, "Inconsistent app environment")
        self.name = name
        self.apiBaseURL = url
        self.displayName = displayName
        self.keychainService = bundleID + ".session"
    }
}
