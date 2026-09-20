// Adapted from the reference app Core/State; see mobile-reuse-audit.md.
import Foundation

/// 단일 데이터 소스 화면의 로딩 상태를 표현하는 enum.
/// isLoading/error/value 분산 상태를 하나로 통합.
/// 주의: 멀티축 화면(Console, NewsDetail 등)에는 사용하지 말 것.
enum Loadable<T> {
    case idle
    case loading(previous: T? = nil)
    case loaded(T)
    case failed(Error)

    var value: T? {
        switch self {
        case .loading(let previous): return previous
        case .loaded(let value): return value
        default: return nil
        }
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    var error: Error? {
        if case .failed(let error) = self { return error }
        return nil
    }
}
