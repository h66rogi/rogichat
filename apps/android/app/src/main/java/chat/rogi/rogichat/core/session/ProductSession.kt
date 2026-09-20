package chat.rogi.rogichat.core.session

import android.content.Context
import chat.rogi.rogichat.core.auth.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Instant
import chat.rogi.rogichat.BuildConfig
import chat.rogi.rogichat.core.network.ApiClient

import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.feature.settings.ProfileRepository
import chat.rogi.rogichat.feature.settings.ProfileEditor
import chat.rogi.rogichat.feature.settings.NotificationPreferencesRepository
import chat.rogi.rogichat.feature.rooms.RoomsRepository
import kotlinx.coroutines.flow.StateFlow

data class AccountSummary(val id: String, val nickname: String, val signInMethod: String?, val soopConnected: Boolean,
                          val avatarAssetId: String? = null) {
    init { require(id.isNotBlank()); require(ProfileEditor(nickname).error == null) }
}
data class SessionSnapshot(
    val access: ShellAccess = ShellAccess.SIGNED_OUT,
    val account: AccountSummary? = null,
    val generation: Long = 0,
    val notice: String? = null,
    val validationNeedsRetry: Boolean = false,
    val expiresAt: Instant? = null,
    val storageFailure: Boolean = false,
) {
    init {
        require(access !in setOf(ShellAccess.READY, ShellAccess.LINK_REQUIRED) || account != null)
        require(access != ShellAccess.READY || account?.soopConnected == true)
        require(access !in setOf(ShellAccess.SIGNED_OUT, ShellAccess.RESTORING, ShellAccess.RETRYABLE_FAILURE) || account == null)
    }
}
enum class SignInProvider(val title: String) { APPLE("Apple로 계속하기"), SOOP("SOOP으로 계속하기") }

/** Domain boundary only. Implemented operations are exposed by the native session adapter.
 * No web cookie, role picker, fabricated credential or invented HTTP path can create a session.
 * The adapter must rotate generation and remove private account state when credentials/access are
 * invalidated, before awaiting logout/deletion/refresh; it owns authoritative completion, not UI.
 * Cancelled sign-in is cancellation, never a successful Result<Unit>.
 */
interface SessionActions {
    val providers: Set<SignInProvider>
    val canLinkSoop: Boolean get() = false
    val canSignOut: Boolean get() = false
    val canCloseAccount: Boolean get() = false
    val canRestore: Boolean get() = false
    suspend fun signIn(provider: SignInProvider): Result<Unit>
    suspend fun linkSoop(): Result<Unit>
    suspend fun signOut(): Result<Unit>
    suspend fun closeAccount(): Result<Unit>
    suspend fun resetLocalSession(): Result<Unit> = Result.failure(IllegalStateException("operation_unavailable"))
    suspend fun restore(): Result<Unit>
    suspend fun revalidate(): Result<Unit> = Result.success(Unit)
    suspend fun expireSession(generation: Long, expiresAt: Instant): Result<Unit> = Result.success(Unit)
}

class ProductServices(
    val session: StateFlow<SessionSnapshot>,
    val actions: SessionActions? = null,
    val profiles: ProfileRepository? = null,
    val rooms: RoomsRepository? = null,
    val auth: NativeAuthActions? = null,
    val notificationPreferences: NotificationPreferencesRepository? = null,
) {
    private val callbackScope by lazy { CoroutineScope(SupervisorJob() + Dispatchers.Default) }
    fun receiveAuthCallback(url: String) {
        // Application graph owns completion; activity recreation must not cancel a one-shot exchange.
        auth?.let { actions -> callbackScope.launch { actions.handleCallback(url) } }
    }
    companion object {
        @Volatile private var installedServices: ProductServices? = null
        // Application-scoped so activity recreation never pairs a retained ViewModel with a new gateway.
        fun installed(context: Context): ProductServices = installedServices ?: synchronized(this) {
            installedServices ?: NativeSessionCoordinator(
                androidCredentialStore(context.applicationContext, BuildConfig.ENVIRONMENT),
                ApiClient(BuildConfig.API_BASE_URL),
                auth = SoopAuthSupport(SoopAuthContract(BuildConfig.ENVIRONMENT), androidPendingAuthStore(context.applicationContext, BuildConfig.ENVIRONMENT)),
            ).services().also { installedServices = it }
        }
    }
}
