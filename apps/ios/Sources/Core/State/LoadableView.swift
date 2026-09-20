// Adapted from the reference app Core/State; see mobile-reuse-audit.md.
import SwiftUI

/// `Loadable<T>`의 모든 상태를 강제로 처리하는 제네릭 뷰.
/// if/else if 체인과 달리, 누락된 상태가 있으면 **컴파일 에러** 발생 → 빈 화면 원천 차단.
///
/// 사용 예시:
/// ```swift
/// LoadableView(state: viewModel.clipState,
///     idle: { LoadingView() },
///     loading: { LoadingView() },
///     loaded: { clip in clipContent(clip) },
///     failed: { error in ErrorView(error: error) }
/// )
/// ```
struct LoadableView<T, Idle: View, Loading: View, Loaded: View, Failed: View>: View {
    let state: Loadable<T>
    let idle: () -> Idle
    let loading: (T?) -> Loading
    let loaded: (T) -> Loaded
    let failed: (Error) -> Failed

    init(
        state: Loadable<T>,
        @ViewBuilder idle: @escaping () -> Idle,
        @ViewBuilder loading: @escaping (T?) -> Loading,
        @ViewBuilder loaded: @escaping (T) -> Loaded,
        @ViewBuilder failed: @escaping (Error) -> Failed
    ) {
        self.state = state
        self.idle = idle
        self.loading = loading
        self.loaded = loaded
        self.failed = failed
    }

    init(
        state: Loadable<T>,
        @ViewBuilder idle: @escaping () -> Idle,
        @ViewBuilder loading: @escaping () -> Loading,
        @ViewBuilder loaded: @escaping (T) -> Loaded,
        @ViewBuilder failed: @escaping (Error) -> Failed
    ) {
        self.init(
            state: state,
            idle: idle,
            loading: { _ in loading() },
            loaded: loaded,
            failed: failed
        )
    }

    var body: some View {
        switch state {
        case .idle:
            idle()
        case .loading(let previous):
            loading(previous)
        case .loaded(let value):
            loaded(value)
        case .failed(let error):
            failed(error)
        }
    }
}

// MARK: - Convenience: idle과 loading이 같은 뷰

extension LoadableView where Idle == Loading {
    /// `.idle`과 `.loading`에 같은 뷰를 사용하는 편의 초기화.
    /// 대부분의 화면에서 idle/loading 모두 LoadingView를 보여주므로 중복 제거.
    init(
        state: Loadable<T>,
        @ViewBuilder loading: @escaping (T?) -> Loading,
        @ViewBuilder loaded: @escaping (T) -> Loaded,
        @ViewBuilder failed: @escaping (Error) -> Failed
    ) {
        self.init(
            state: state,
            idle: { loading(nil) },
            loading: loading,
            loaded: loaded,
            failed: failed
        )
    }

    init(
        state: Loadable<T>,
        @ViewBuilder loading: @escaping () -> Loading,
        @ViewBuilder loaded: @escaping (T) -> Loaded,
        @ViewBuilder failed: @escaping (Error) -> Failed
    ) {
        self.init(
            state: state,
            loading: { _ in loading() },
            loaded: loaded,
            failed: failed
        )
    }
}
