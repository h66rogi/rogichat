package chat.rogi.rogichat.core.session

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import chat.rogi.rogichat.core.auth.*
import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.common.request
import java.time.Clock
import java.time.Duration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SessionOperationState(val busy: Boolean = false, val error: String? = null, val consentNeeded: Boolean = false)
class SessionViewModel(private val services: ProductServices, private val injectedScope: CoroutineScope? = null,
                       private val clock: Clock = Clock.systemUTC()) : ViewModel() {
    private val mutable = MutableStateFlow(SessionOperationState())
    private var revision = 0L
    private var startupRequested = false
    val state = mutable.asStateFlow()
    fun start() {
        if (startupRequested) return
        startupRequested = true
        (injectedScope ?: viewModelScope).launch {
            // Only auth scope/expiry changes restart this timer; profile edits and retry notices do not.
            services.session.map { Triple(it.generation, it.account?.id, it.expiresAt) }.distinctUntilChanged().collectLatest { ticket ->
                val expiresAt = ticket.third ?: return@collectLatest
                if (ticket.second == null) return@collectLatest
                while (expiresAt.isAfter(clock.instant())) {
                    delay(Duration.between(clock.instant(), expiresAt).toMillis().coerceAtLeast(1))
                }
                services.actions?.expireSession(ticket.first, expiresAt)
            }
        }
        services.auth?.let { auth ->
            (injectedScope ?: viewModelScope).launch { auth.restorePending() }
            (injectedScope ?: viewModelScope).launch {
                auth.authState.map { it.expiresAt }.distinctUntilChanged().collectLatest { expires ->
                    if (expires == null) return@collectLatest
                    while (expires.isAfter(clock.instant())) delay(Duration.between(clock.instant(), expires).toMillis().coerceAtLeast(1))
                    auth.expireAuthentication()
                }
            }
        }
        if (services.session.value.access == ShellAccess.RESTORING) restore()
    }
    fun foreground() { services.actions?.let { actions -> (injectedScope ?: viewModelScope).launch { actions.revalidate() } } }
    fun retryValidation() { if (services.session.value.account != null) services.actions?.takeIf { it.canRestore }?.let {
        perform("계정 확인을 완료하지 못했어요.") { it.revalidate() }
    } }
    fun signIn(provider: SignInProvider) {
        val actions = services.actions ?: return
        if (services.session.value.access != ShellAccess.SIGNED_OUT) return
        if (provider !in actions.providers) return
        if (provider == SignInProvider.SOOP && services.auth != null) {
            if (!services.auth.authState.value.active) mutable.value = mutable.value.copy(consentNeeded = true)
            return
        }
        perform("로그인을 완료하지 못했어요. 다시 시도해 주세요.") { actions.signIn(provider) }
    }
    fun dismissConsent() { mutable.value = mutable.value.copy(consentNeeded = false) }
    fun confirmConsent() {
        if (!mutable.value.consentNeeded || services.session.value.access != ShellAccess.SIGNED_OUT) return
        services.auth?.let { auth -> perform("로그인을 시작하지 못했어요.") { auth.startLogin(CURRENT_TERMS) } }
    }
    fun cancelAuthentication() { services.auth?.let { auth ->
        (injectedScope ?: viewModelScope).launch { auth.cancelAuthentication() }
    } }
    fun resetLocalSession() {
        if (services.session.value.storageFailure && services.session.value.account == null) services.actions?.let {
            perform("기기의 로그인 정보를 지우지 못했어요. 다시 시도해 주세요.") { it.resetLocalSession() }
        }
    }
    fun linkSoop() { if (services.session.value.access != ShellAccess.LINK_REQUIRED) return; services.actions?.takeIf { it.canLinkSoop }?.let { perform("SOOP 계정을 연결하지 못했어요.") { it.linkSoop() } } }
    fun signOut() { if (services.session.value.account == null) return; services.actions?.takeIf { it.canSignOut }?.let { perform("로그아웃하지 못했어요. 다시 시도해 주세요.") { it.signOut() } } }
    fun closeAccount() { if (services.session.value.account == null) return; services.actions?.takeIf { it.canCloseAccount }?.let { perform("탈퇴를 완료하지 못했어요. 다시 시도해 주세요.") { it.closeAccount() } } }
    fun restore() { if (services.session.value.access !in setOf(ShellAccess.RESTORING, ShellAccess.RETRYABLE_FAILURE)) return; services.actions?.takeIf { it.canRestore }?.let { perform("계정을 확인하지 못했어요. 다시 시도해 주세요.") { it.restore() } } }
    private fun perform(message: String, operation: suspend () -> Result<Unit>) {
        if (mutable.value.busy) return
        val captured = services.session.value
        val ticket = ++revision
        mutable.value = SessionOperationState(busy = true)
        (injectedScope ?: viewModelScope).launch {
            try {
                val result = request(operation)
                val current = services.session.value
                if (ticket == revision) mutable.value = SessionOperationState(error = message.takeIf {
                    result.isFailure && current.generation == captured.generation && current.access == captured.access &&
                        current.account?.id == captured.account?.id
                })
            } finally {
                if (ticket == revision) mutable.value = mutable.value.copy(busy = false)
            }
        }
    }
    fun dismissError() { mutable.value = mutable.value.copy(error = null) }
}
