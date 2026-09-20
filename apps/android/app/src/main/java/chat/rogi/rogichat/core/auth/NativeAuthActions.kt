package chat.rogi.rogichat.core.auth

import kotlinx.coroutines.flow.StateFlow

interface NativeAuthActions {
    val authState: StateFlow<AuthUiState>
    val browserLaunch: StateFlow<BrowserLaunch?>
    val rulesUrl: String
    suspend fun startLogin(termsVersion: String): Result<Unit>
    suspend fun startAppleLogin(termsVersion: String): Result<Unit> = Result.failure(IllegalStateException("operation_unavailable"))
    suspend fun restorePending(): Result<Unit>
    suspend fun handleCallback(url: String): Result<Unit>
    suspend fun claimBrowserLaunch(state: String): BrowserLaunch?
    suspend fun browserFailed(state: String)
    suspend fun cancelAuthentication(): Result<Unit>
    suspend fun expireAuthentication(): Result<Unit>
}
class SoopAuthSupport(val contract: SoopAuthContract, val pendingStore: PendingAuthStore,
                      val createProof: () -> AuthProof = AuthProof::create)
