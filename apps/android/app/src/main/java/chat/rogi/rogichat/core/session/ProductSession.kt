package chat.rogi.rogichat.core.session

import android.content.Context
import chat.rogi.rogichat.core.auth.*
import chat.rogi.rogichat.core.push.*
import chat.rogi.rogichat.core.realtime.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Instant
import chat.rogi.rogichat.BuildConfig
import chat.rogi.rogichat.core.network.ApiClient
import chat.rogi.rogichat.core.network.AccountPartition
import chat.rogi.rogichat.core.rooms.AndroidRoomsStore

import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.feature.settings.ProfileRepository
import chat.rogi.rogichat.feature.settings.ProfileEditor
import chat.rogi.rogichat.feature.settings.NotificationPreferencesRepository
import chat.rogi.rogichat.feature.rooms.RoomsRepository
import chat.rogi.rogichat.channelport.ChannelGraph
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
    val accountPartition: AccountPartition? = null,
) {
    init {
        require(access !in setOf(ShellAccess.READY, ShellAccess.LINK_REQUIRED) || account != null)
        require(access !in setOf(ShellAccess.SIGNED_OUT, ShellAccess.RESTORING, ShellAccess.RETRYABLE_FAILURE) || account == null)
    }
}
/** Immutable UI admission identity; never recapture it after a confirmation or coroutine hop. */
data class SessionIdentity(val epoch: Long, val accountId: String?) {
    fun matches(snapshot: SessionSnapshot) = epoch == snapshot.generation && accountId == snapshot.account?.id
    companion object { fun from(snapshot: SessionSnapshot) = SessionIdentity(snapshot.generation, snapshot.account?.id) }
}
enum class SignInProvider(val title: String) { APPLE("Apple로 계속하기"), SOOP("SOOP으로 계속하기") }

/** Domain boundary only. Implemented operations are exposed by the native session adapter.
 * No web cookie, role picker, fabricated credential or invented HTTP path can create a session.
 * The adapter must rotate generation and remove private account state when credentials/access are
 * invalidated, before awaiting logout/deletion/refresh; it owns authoritative completion, not UI.
 * Cancelled sign-in is cancellation, never a successful Result<Unit>.
 */
interface SessionActions {
    fun setForeground(value: Boolean) = Unit
    val providers: Set<SignInProvider>
    val canLinkSoop: Boolean get() = false
    val canSignOut: Boolean get() = false
    val canRestore: Boolean get() = false
    suspend fun signIn(provider: SignInProvider): Result<Unit>
    suspend fun linkSoop(): Result<Unit>
    suspend fun signOut(expected: SessionIdentity? = null): Result<Unit>
    suspend fun resetLocalSession(expected: SessionIdentity? = null): Result<Unit> = Result.failure(IllegalStateException("operation_unavailable"))
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
    val access: AccountAccessActions? = null,
    val notificationPreferences: NotificationPreferencesRepository? = null,
    val notificationInbox: chat.rogi.rogichat.feature.notifications.NotificationInboxRepository? = null,
    val deletion: chat.rogi.rogichat.core.deletion.AccountDeletionActions? = null,
    val conversations: chat.rogi.rogichat.core.conversation.ConversationRepository? = null,
    val push: NativePushCoordinator? = null,
    val blocks: chat.rogi.rogichat.core.messageactions.AccountBlocksCoordinator? = null,
    val accountMedia: chat.rogi.rogichat.core.media.AccountMediaRepository? = null,
    val channel: ChannelGraph? = null,
) {
    private val callbackScope by lazy { CoroutineScope(SupervisorJob() + Dispatchers.Default) }
    fun receiveSyncWake() { callbackScope.launch { actions?.revalidate(); conversations?.wake() } }
    fun receiveAuthCallback(url: String) {
        // Application graph owns completion; activity recreation must not cancel a one-shot exchange.
        auth?.let { actions -> callbackScope.launch { actions.handleCallback(url) } }
    }
    companion object {
        @Volatile private var installedServices: ProductServices? = null
        // Application-scoped so activity recreation never pairs a retained ViewModel with a new gateway.
        fun installed(context: Context): ProductServices = installedServices ?: synchronized(this) {
            installedServices ?: run {
                val api = ApiClient(BuildConfig.API_BASE_URL)
                val credentials = androidCredentialStore(context.applicationContext, BuildConfig.ENVIRONMENT)
                val coordinator = NativeSessionCoordinator(
                    credentials,
                    api,
                realtime = NativeRealtimeManager(SocketIORealtimeFactory()),
                deletionStore = androidAccountDeletionStore(context.applicationContext, BuildConfig.ENVIRONMENT),
                roomsStore = AndroidRoomsStore(context.applicationContext, BuildConfig.ENVIRONMENT),
                auth = SoopAuthSupport(SoopAuthContract(BuildConfig.ENVIRONMENT), androidPendingAuthStore(context.applicationContext, BuildConfig.ENVIRONMENT)),
                )
                val owner = CoroutineScope(SupervisorJob() + Dispatchers.IO)
                owner.launch {
                    try { chat.rogi.rogichat.core.media.MediaScratchPreparation.prepare(context.applicationContext.cacheDir) }
                    catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                    catch (_: Exception) { /* Media admission retries cleanup and fails closed; account operations stay available. */ }
                }
                val push = NativePushCoordinator(coordinator, androidPushInstallation(context.applicationContext, BuildConfig.ENVIRONMENT),
                    FirebasePushProvider(context.applicationContext), AndroidPushPermission(context.applicationContext)::current, coordinator.session, owner)
                coordinator.services(push, ChannelGraph(credentials, coordinator.session, owner)).also { installedServices = it }
            }
        }
    }
}
