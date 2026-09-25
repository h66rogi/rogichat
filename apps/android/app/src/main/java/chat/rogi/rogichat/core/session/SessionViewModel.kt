package chat.rogi.rogichat.core.session

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import chat.rogi.rogichat.core.auth.*
import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.common.request
import java.time.Clock
import chat.rogi.rogichat.core.deletion.*
import java.time.Duration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SessionOperationState(val busy: Boolean = false, val error: String? = null)
class SessionViewModel(private val services: ProductServices, private val injectedScope: CoroutineScope? = null,
                       private val clock: Clock = Clock.systemUTC()) : ViewModel() {
    private val mutable = MutableStateFlow(SessionOperationState())
    private val dismissedDeletion = MutableStateFlow<String?>(null)
    val dismissedDeletionKey = dismissedDeletion.asStateFlow()
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
    fun background() { services.actions?.setForeground(false) }
    fun foreground() { services.actions?.setForeground(true); services.actions?.let { actions -> (injectedScope ?: viewModelScope).launch { actions.revalidate() } } }
    fun retryValidation() { if (services.session.value.account != null) services.actions?.takeIf { it.canRestore }?.let {
        perform("계정 확인을 완료하지 못했어요.") { it.revalidate() }
    } }
    fun signIn(provider: SignInProvider) {
        val actions = services.actions ?: return
        if (services.session.value.access != ShellAccess.SIGNED_OUT) return
        if (provider !in actions.providers) return
        if (services.auth != null) {
            if (!services.auth.authState.value.active) services.auth.let { auth -> perform("로그인을 시작하지 못했어요.") {
                if (provider == SignInProvider.APPLE) auth.startAppleLogin("") else auth.startLogin("")
            } }
            return
        }
        perform("로그인을 완료하지 못했어요. 다시 시도해 주세요.") { actions.signIn(provider) }
    }
    fun password(input: PasswordInput) {
        val actions = services.access ?: return
        if (mutable.value.busy) return
        val expected = SessionIdentity.from(services.session.value); val capturedAccount = expected.accountId
        val ticket = ++revision; mutable.value = SessionOperationState(busy = true)
        (injectedScope ?: viewModelScope).launch {
            try {
                val result = actions.password(input, expected)
                if (ticket == revision && services.session.value.account?.id == capturedAccount) mutable.value = SessionOperationState(error = result.exceptionOrNull()?.let {
                    when ((it as? chat.rogi.rogichat.core.network.ApiException)?.statusCode) {
                        401 -> "아이디 또는 비밀번호를 확인해 주세요."
                        429 -> "요청이 많아요. 잠시 후 다시 시도해 주세요."
                        else -> "로그인 정보를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요."
                    }
                })
            } finally { if (ticket == revision) mutable.value = mutable.value.copy(busy = false) }
        }
    }
    fun cancelAuthentication() { services.auth?.let { auth ->
        (injectedScope ?: viewModelScope).launch { auth.cancelAuthentication() }
    } }
    fun resetLocalSession(expected: SessionIdentity = SessionIdentity.from(services.session.value)) {
        if (!expected.matches(services.session.value)) return
        if (services.session.value.storageFailure && services.session.value.account == null) services.actions?.let {
            perform("기기의 로그인 정보를 지우지 못했어요. 다시 시도해 주세요.") { it.resetLocalSession(expected) }
        }
    }
    fun linkSoop() { if (services.session.value.access != ShellAccess.LINK_REQUIRED) return; services.actions?.takeIf { it.canLinkSoop }?.let { perform("SOOP 계정을 연결하지 못했어요.") { it.linkSoop() } } }
    fun signOut(expected: SessionIdentity = SessionIdentity.from(services.session.value)) { if (!expected.matches(services.session.value) || services.session.value.account == null) return; services.actions?.takeIf { it.canSignOut }?.let { perform("로그아웃하지 못했어요. 다시 시도해 주세요.") { it.signOut(expected) } } }
    fun deleteAccount(intent: DeletionIntent) {
        val current = services.session.value
        // Reject a stale rendered confirmation before changing B's UI or launching a coroutine.
        if (current.account?.id != intent.accountId || current.generation != intent.epoch || current.access !in setOf(ShellAccess.READY, ShellAccess.LINK_REQUIRED)) return
        dismissedDeletion.value = null
        services.deletion?.let { actions -> (injectedScope ?: viewModelScope).launch {
            val result = request { actions.requestDeletion(intent) }
            if (result.isFailure && services.session.value.account?.id == intent.accountId && services.session.value.generation == intent.epoch)
                mutable.value = mutable.value.copy(error = "탈퇴 요청을 시작하지 못했어요.")
        } }
    }
    fun acknowledgeDeletion() {
        val state = services.deletion?.deletionState?.value ?: return
        if (!state.blocksSession) dismissedDeletion.value = if (state.capacityReached) "capacity" else state.record?.operationId
    }
    fun retryDeletionCleanup() { services.deletion?.let { actions ->
        (injectedScope ?: viewModelScope).launch { val result = request { actions.retryDeletionCleanup() }; if (result.isFailure) mutable.value = mutable.value.copy(error = "이 기기의 계정 정보를 지우지 못했어요. 다시 시도해 주세요.") }
    } }
    fun resetDeletionData(intent: DeletionResetIntent) {
        val actions = services.deletion ?: return
        if (!intent.matches(services.session.value, actions.deletionState.value)) return
        (injectedScope ?: viewModelScope).launch {
            val result = request { actions.resetDeletionData(intent) }
            if (result.isFailure && intent.matches(services.session.value, actions.deletionState.value))
                mutable.value = mutable.value.copy(error = "이 기기의 정보를 초기화하지 못했어요.")
        }
    }
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
