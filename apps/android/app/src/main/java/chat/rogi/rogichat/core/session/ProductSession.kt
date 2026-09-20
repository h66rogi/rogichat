package chat.rogi.rogichat.core.session

import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.feature.settings.ProfileRepository
import chat.rogi.rogichat.feature.settings.ProfileEditor
import chat.rogi.rogichat.feature.rooms.RoomsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AccountSummary(val id: String, val nickname: String, val signInMethod: String, val soopConnected: Boolean) {
    init { require(id.isNotBlank()); require(ProfileEditor(nickname).error == null) }
}
data class SessionSnapshot(
    val access: ShellAccess = ShellAccess.SIGNED_OUT,
    val account: AccountSummary? = null,
    val generation: Long = 0,
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
    suspend fun restore(): Result<Unit>
}

class ProductServices(
    val session: StateFlow<SessionSnapshot>,
    val actions: SessionActions? = null,
    val profiles: ProfileRepository? = null,
    val rooms: RoomsRepository? = null,
) {
    companion object {
        // There is no native credential issuer/storage yet (C01/C02). No account is invented.
        fun installed() = ProductServices(MutableStateFlow(SessionSnapshot()).asStateFlow())
    }
}
