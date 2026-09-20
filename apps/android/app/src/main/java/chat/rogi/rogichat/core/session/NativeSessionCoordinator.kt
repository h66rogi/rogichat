package chat.rogi.rogichat.core.session

import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.feature.settings.*
import java.time.Clock
import java.time.Instant
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** New Rogichat coordinator: storage publication and response application share one local epoch
 * fence. Server accountGeneration is an opaque invalidation hint, never the local operation epoch.
 * No native credential issuance or test-login path is implemented here.
 */
class NativeSessionCoordinator(private val store: CredentialStore, private val api: NativeApi,
                               private val clock: Clock = Clock.systemUTC()) : SessionActions, ProfileRepository {
    private val lock = Mutex()
    private val mutable = MutableStateFlow(SessionSnapshot(access = ShellAccess.RESTORING))
    val session = mutable.asStateFlow()
    private var epoch = 0L
    private var credential: NativeCredential? = null
    private var loaded = false
    private var removalPending = false
    private var refreshId = 0L
    private var activeRefresh: Long? = null
    private var serverGeneration: String? = null
    private var profileRevision = 0L
    override val providers = emptySet<SignInProvider>()
    override val canRestore = true
    override val canSignOut = true
    override suspend fun signIn(provider: SignInProvider) = unavailable()
    override suspend fun linkSoop() = unavailable()
    override suspend fun closeAccount() = unavailable()
    private fun unavailable(): Result<Unit> = Result.failure(IllegalStateException("operation_unavailable"))
    fun services() = ProductServices(session, this, this)

    private class Ticket(val epoch: Long, val credential: NativeCredential, val accountId: String?, val profileRevision: Long)
    private fun current(ticket: Ticket) = epoch == ticket.epoch && credential?.token == ticket.credential.token
    private fun publish(access: ShellAccess, account: AccountSummary? = null, notice: String? = null) {
        mutable.value = SessionSnapshot(access, account, epoch, notice, expiresAt = credential?.expiresAt.takeIf { account != null })
    }
    private suspend fun clearLocked() {
        epoch++
        activeRefresh = null
        credential = null
        loaded = true
        serverGeneration = null
        removalPending = true
        publish(ShellAccess.RESTORING)
        withContext(NonCancellable) {
            try {
                store.clear()
                removalPending = false
                publish(ShellAccess.SIGNED_OUT)
            } catch (failure: Exception) {
                publish(ShellAccess.RETRYABLE_FAILURE)
                throw failure
            }
        }
    }
    override suspend fun restore(): Result<Unit> = refresh(retainAuthorized = false)
    private suspend fun refresh(retainAuthorized: Boolean): Result<Unit> = outcome {
        var requestId = 0L
        val ticket = lock.withLock {
            if (activeRefresh != null) return@outcome
            if (removalPending) { clearLocked(); return@outcome }
            if (!loaded) {
                try { credential = store.read(); loaded = true }
                catch (failure: Exception) { publish(ShellAccess.RETRYABLE_FAILURE); throw failure }
            }
            val saved = credential
            if (saved == null) { publish(ShellAccess.SIGNED_OUT); return@outcome }
            if (!saved.expiresAt.isAfter(clock.instant())) { clearLocked(); return@outcome }
            requestId = ++refreshId
            activeRefresh = requestId
            Ticket(epoch, saved, mutable.value.account?.id, profileRevision)
        }
        try {
            val projection = NativeDtos.session(api.get(ApiRoute.SESSION, ticket.credential.token))
            lock.withLock {
                if (!current(ticket)) return@withLock
                if (ticket.accountId != null && ticket.accountId != projection.account.id) throw InvalidResponse()
                // The server defines fixed expiry. Never extend it locally or on use.
                // Protected encoding preserves milliseconds; server ISO timestamps may have finer precision.
                if (projection.expiresAt.toEpochMilli() != ticket.credential.expiresAt.toEpochMilli()) throw InvalidResponse()
                if (!projection.expiresAt.isAfter(clock.instant())) { clearLocked(); return@withLock }
                val updated = NativeCredential(ticket.credential.token, projection.expiresAt)
                withContext(NonCancellable) { store.write(updated) }
                if (!updated.expiresAt.isAfter(clock.instant())) { clearLocked(); return@withLock }
                val account = if (profileRevision != ticket.profileRevision && mutable.value.account?.id == projection.account.id) {
                    projection.account.copy(nickname = requireNotNull(mutable.value.account).nickname,
                        avatarAssetId = mutable.value.account?.avatarAssetId)
                } else projection.account
                if (serverGeneration != projection.serverGeneration || mutable.value.account?.id != projection.account.id ||
                    mutable.value.access != projection.access) epoch++
                credential = updated
                serverGeneration = projection.serverGeneration
                publish(projection.access, account)
            }
        } catch (cancelled: CancellationException) {
            withContext(NonCancellable) { lock.withLock {
                if (current(ticket) && mutable.value.access == ShellAccess.RESTORING) { epoch++; publish(ShellAccess.RETRYABLE_FAILURE) }
            } }
            throw cancelled
        }
        catch (failure: Exception) {
            lock.withLock {
                if (current(ticket)) {
                    if (failure is ApiException && failure.statusCode == 401) clearLocked()
                    else if (!ticket.credential.expiresAt.isAfter(clock.instant())) clearLocked()
                    else if (retainAuthorized && mutable.value.account?.id == ticket.accountId &&
                        (failure is IOException || failure is ApiException && failure.statusCode in setOf(408, 429, 500, 502, 503, 504))) {
                        mutable.value = mutable.value.copy(notice = "계정 확인을 완료하지 못했어요. 연결을 확인하고 다시 시도해 주세요.", validationNeedsRetry = true)
                    }
                    else { epoch++; publish(ShellAccess.RETRYABLE_FAILURE) }
                }
            }
            throw failure
        } finally {
            withContext(NonCancellable) { lock.withLock { if (activeRefresh == requestId) activeRefresh = null } }
        }
    }
    override suspend fun revalidate(): Result<Unit> = if (session.value.access in setOf(ShellAccess.READY, ShellAccess.LINK_REQUIRED))
        refresh(retainAuthorized = true) else Result.success(Unit)
    override suspend fun expireSession(generation: Long, expiresAt: Instant): Result<Unit> = outcome {
        lock.withLock {
            if (epoch == generation && credential?.expiresAt == expiresAt && mutable.value.account != null &&
                !expiresAt.isAfter(clock.instant())) clearLocked()
        }
    }
    override suspend fun signOut(): Result<Unit> = outcome {
        var localFailure: Exception? = null
        val previous = lock.withLock {
            val old = credential
            try { clearLocked() } catch (failure: Exception) { localFailure = failure }
            old
        }
        val signedOutEpoch = lock.withLock { epoch }
        if (previous != null) {
            try { api.postWithoutResponse(ApiRoute.LOGOUT, previous.token, "{}") }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                // An already invalid token is authoritative logout, not a retry or token refresh.
                if (failure !is ApiException || failure.statusCode != 401) lock.withLock {
                    if (epoch == signedOutEpoch && !removalPending && credential == null) publish(ShellAccess.SIGNED_OUT,
                        notice = "이 기기에서 로그아웃했어요. 서버의 로그인 종료는 확인하지 못했어요.")
                }
            }
        }
        localFailure?.let { throw it }
    }
    override suspend fun load(accountId: String): Result<UserProfile> = profile(accountId) { token ->
        NativeDtos.profile(api.get(ApiRoute.PROFILE, token))
    }
    override suspend fun save(accountId: String, changes: ProfileChanges): Result<UserProfile> = profile(accountId, save = true) { token ->
        NativeDtos.profile(api.patch(ApiRoute.PROFILE, token, NativeDtos.profilePatch(changes)))
    }
    private suspend fun profile(accountId: String, save: Boolean = false, call: suspend (String) -> UserProfile): Result<UserProfile> = outcome {
        val ticket = lock.withLock {
            val own = mutable.value.account
            if (own?.id != accountId || mutable.value.access !in setOf(ShellAccess.READY, ShellAccess.LINK_REQUIRED))
                throw CancellationException("account_scope_changed")
            val saved = credential ?: throw CancellationException("account_scope_changed")
            if (!saved.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
            Ticket(epoch, saved, accountId, profileRevision)
        }
        try {
            val result = call(ticket.credential.token)
            if (result.id != accountId) throw InvalidResponse()
            lock.withLock {
                if (!current(ticket) || mutable.value.account?.id != accountId) throw CancellationException("account_scope_changed")
                if (!ticket.credential.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
                if (save) mutable.value.account?.let { account ->
                    profileRevision++
                    mutable.value = mutable.value.copy(account = account.copy(nickname = result.nickname, avatarAssetId = result.avatarAssetId))
                }
            }
            result
        } catch (failure: ApiException) {
            var refresh = false
            lock.withLock {
                if (current(ticket)) {
                    if (failure.statusCode == 401) clearLocked()
                    else if (failure.statusCode == 403 && failure.code == "SOOP_LINK_REQUIRED") {
                        epoch++
                        mutable.value.account?.let { publish(ShellAccess.LINK_REQUIRED, it.copy(soopConnected = false)) }
                        refresh = true
                    }
                }
            }
            if (refresh) restore()
            throw failure
        }
    }
    private suspend inline fun <T> outcome(block: () -> T): Result<T> = try { Result.success(block()) }
    catch (cancelled: CancellationException) { throw cancelled }
    catch (failure: Exception) { Result.failure(failure) }
}
