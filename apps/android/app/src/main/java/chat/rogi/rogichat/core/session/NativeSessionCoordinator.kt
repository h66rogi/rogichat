package chat.rogi.rogichat.core.session

import chat.rogi.rogichat.core.auth.*
import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.feature.settings.*
import java.time.Clock
import java.time.Instant
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** New Rogichat coordinator: storage publication and response application share one local epoch
 * fence. Server accountGeneration is an opaque invalidation hint, never the local operation epoch.
 * SOOP issuance uses only the committed native transaction and completion contract.
 */
class NativeSessionCoordinator(private val store: CredentialStore, private val api: NativeApi,
                               private val clock: Clock = Clock.systemUTC(),
                               private val auth: SoopAuthSupport? = null) : SessionActions, ProfileRepository, NativeAuthActions {
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
    private val mutableAuth = MutableStateFlow(AuthUiState())
    override val authState = mutableAuth.asStateFlow()
    private val mutableLaunch = MutableStateFlow<BrowserLaunch?>(null)
    override val browserLaunch = mutableLaunch.asStateFlow()
    override val rulesUrl get() = requireNotNull(auth).contract.rulesUrl
    private var pendingLoaded = false
    private var pending: PendingAuth? = null
    private var attempt: AuthAttempt? = null
    private var authRevision = 0L
    private class AuthAttempt(val revision: Long, val epoch: Long, val proof: AuthProof, val intent: AuthIntent,
                              val createdAt: Instant, val token: String?, val accountId: String?,
                              val serverGeneration: String?, val clearStamp: String?)
    override val providers = if (auth == null) emptySet() else setOf(SignInProvider.SOOP)
    override val canLinkSoop get() = auth != null
    override val canRestore = true
    override val canSignOut = true
    override suspend fun signIn(provider: SignInProvider) = unavailable()
    override suspend fun linkSoop() = beginAuthentication(AuthIntent.LINK)
    override suspend fun closeAccount() = unavailable()
    private fun unavailable(): Result<Unit> = Result.failure(IllegalStateException("operation_unavailable"))
    fun services() = ProductServices(session, this, this, auth = this.takeIf { auth != null })

    private class Ticket(val epoch: Long, val credential: NativeCredential, val accountId: String?, val profileRevision: Long)
    private fun current(ticket: Ticket) = epoch == ticket.epoch && credential?.token == ticket.credential.token
    private fun publish(access: ShellAccess, account: AccountSummary? = null, notice: String? = null, storageFailure: Boolean = false) {
        mutable.value = SessionSnapshot(access, account, epoch, notice, expiresAt = credential?.expiresAt.takeIf { account != null }, storageFailure = storageFailure)
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
                // Credential clear changes its durable stamp even if pending erase fails.
                var pendingFailure: Exception? = null
                try { invalidateAuthLocked() } catch (failure: Exception) { pendingFailure = failure }
                store.clear()
                pendingFailure?.let { throw it }
                removalPending = false
                publish(ShellAccess.SIGNED_OUT)
            } catch (failure: Exception) {
                publish(ShellAccess.RETRYABLE_FAILURE, storageFailure = failure is CredentialStoreException)
                throw failure
            }
        }
    }
    override suspend fun restore(): Result<Unit> = refresh(retainAuthorized = false)
    private suspend fun refresh(retainAuthorized: Boolean, expectedEpoch: Long? = null, expectedToken: String? = null): Result<Unit> = outcome {
        var requestId = 0L
        val ticket = lock.withLock {
            if (expectedEpoch != null && (epoch != expectedEpoch || credential?.token != expectedToken)) return@outcome
            if (activeRefresh != null) return@outcome
            if (removalPending) { clearLocked(); return@outcome }
            if (!loaded) {
                try { credential = store.read(); loaded = true }
                catch (failure: Exception) { publish(ShellAccess.RETRYABLE_FAILURE, storageFailure = failure is CredentialStoreException); throw failure }
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
                    else { epoch++; publish(ShellAccess.RETRYABLE_FAILURE, storageFailure = failure is CredentialStoreException) }
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
    override suspend fun resetLocalSession(): Result<Unit> = outcome {
        lock.withLock {
            if (mutable.value.account != null || !mutable.value.storageFailure) return@withLock
            clearLocked()
        }
    }
    private suspend fun invalidateAuthLocked(problem: AuthProblem? = null) {
        authRevision++
        attempt = null; pending = null; pendingLoaded = true; mutableLaunch.value = null
        mutableAuth.value = AuthUiState(error = problem)
        try { withContext(NonCancellable) { auth?.pendingStore?.clear() } }
        catch (failure: Exception) { mutableAuth.value = AuthUiState(error = AuthProblem.CANCEL_UNCONFIRMED); throw failure }
    }
    private fun authCurrent(ticket: AuthAttempt): Boolean = attempt === ticket && authRevision == ticket.revision &&
        epoch == ticket.epoch && credential?.token == ticket.token && mutable.value.account?.id == ticket.accountId &&
        serverGeneration == ticket.serverGeneration
    private suspend fun authFailure(ticket: AuthAttempt, problem: AuthProblem) {
        withContext(NonCancellable) { lock.withLock {
            if (attempt === ticket) {
                try { invalidateAuthLocked(problem) }
                catch (_: Exception) { mutableAuth.value = AuthUiState(error = AuthProblem.STORAGE) }
            }
        } }
    }
    override suspend fun startLogin(termsVersion: String): Result<Unit> = if (termsVersion != CURRENT_TERMS)
        Result.failure(IllegalArgumentException("terms_consent_required")) else beginAuthentication(AuthIntent.LOGIN)

    private suspend fun beginAuthentication(intent: AuthIntent): Result<Unit> = outcome {
        val support = auth ?: throw IllegalStateException("operation_unavailable")
        val ticket = lock.withLock {
            require(loaded && !removalPending)
            if (intent == AuthIntent.LOGIN) require(mutable.value.access == ShellAccess.SIGNED_OUT && credential == null)
            else {
                require(mutable.value.access == ShellAccess.LINK_REQUIRED && mutable.value.account != null && credential != null)
                if (!requireNotNull(credential).expiresAt.isAfter(clock.instant())) { clearLocked(); return@outcome }
            }
            try { invalidateAuthLocked() }
            catch (failure: Exception) { mutableAuth.value = AuthUiState(error = AuthProblem.STORAGE); throw failure }
            epoch++
            mutable.value = mutable.value.copy(generation = epoch)
            val proof = support.createProof()
            val stamp = try { store.clearStamp() }
                catch (failure: Exception) { mutableAuth.value = AuthUiState(error = AuthProblem.STORAGE); throw failure }
            AuthAttempt(authRevision, epoch, proof, intent, clock.instant(), credential?.token,
                mutable.value.account?.id, serverGeneration, stamp).also {
                attempt = it; mutableAuth.value = AuthUiState(AuthPhase.STARTING, expiresAt = it.createdAt.plusSeconds(600))
            }
        }
        try {
            val start = support.contract.start(api.postAuth(ApiRoute.SOOP_START, ticket.token, support.contract.startBody(intent, ticket.proof)))
            lock.withLock {
                if (attempt !== ticket) return@withLock
                if (!authCurrent(ticket)) { invalidateAuthLocked(AuthProblem.SESSION_CHANGED); return@withLock }
                val record = PendingAuth(start.transactionId, intent, ticket.proof, ticket.createdAt,
                    ticket.token?.let(::fingerprint), ticket.accountId, ticket.serverGeneration, ticket.clearStamp)
                if (!record.active(clock.instant()) || !clock.instant().isBefore(record.launchDeadline)) {
                    invalidateAuthLocked(AuthProblem.EXPIRED); return@withLock
                }
                withContext(NonCancellable) { support.pendingStore.write(record) }
                pending = record
                mutableAuth.value = AuthUiState(AuthPhase.AWAITING_BROWSER, expiresAt = record.expiresAt)
                mutableLaunch.value = BrowserLaunch(record.proof.state, start.authorizeUrl)
            }
        } catch (cancelled: CancellationException) { authFailure(ticket, AuthProblem.FAILED); throw cancelled }
        catch (failure: Exception) {
            if (ticket.intent == AuthIntent.LINK && failure is ApiException && failure.statusCode == 401 && failure.code == "UNAUTHENTICATED") {
                withContext(NonCancellable) { lock.withLock {
                    if (authCurrent(ticket)) { clearLocked(); mutableAuth.value = AuthUiState(error = AuthProblem.SESSION_CHANGED) }
                } }
            }
            authFailure(ticket, when (failure) {
                is ApiException -> if (ticket.intent == AuthIntent.LOGIN && failure.statusCode == 401) AuthProblem.FAILED else SoopAuthContract.problem(failure.code, failure.statusCode)
                is CredentialStoreException -> AuthProblem.STORAGE
                is IOException -> AuthProblem.NETWORK
                else -> AuthProblem.FAILED
            }); throw failure
        }
    }
    private suspend fun readyForPending() {
        if (mutable.value.access == ShellAccess.RESTORING) {
            restore()
            session.first { it.access != ShellAccess.RESTORING }
        }
    }
    override suspend fun restorePending(): Result<Unit> = outcome {
        val support = auth ?: return@outcome
        readyForPending()
        lock.withLock {
            if (pendingLoaded || mutable.value.access == ShellAccess.RETRYABLE_FAILURE) return@withLock
            val record = try { support.pendingStore.read() }
                catch (failure: Exception) { mutableAuth.value = AuthUiState(error = AuthProblem.STORAGE); throw failure }
            if (record == null) { pendingLoaded = true; return@withLock }
            val matches = record.credentialFingerprint == credential?.token?.let(::fingerprint) &&
                record.accountId == mutable.value.account?.id && record.serverGeneration == serverGeneration &&
                record.clearStamp == store.clearStamp()
            if (!record.active(clock.instant()) || !matches) {
                invalidateAuthLocked(if (matches) AuthProblem.EXPIRED else AuthProblem.SESSION_CHANGED)
                return@withLock
            }
            pendingLoaded = true; pending = record; authRevision++
            attempt = AuthAttempt(authRevision, epoch, record.proof, record.intent, record.createdAt,
                credential?.token, record.accountId, record.serverGeneration, record.clearStamp)
            mutableAuth.value = AuthUiState(AuthPhase.AWAITING_BROWSER, expiresAt = record.expiresAt)
        }
    }
    override suspend fun claimBrowserLaunch(state: String): BrowserLaunch? = lock.withLock {
        val launch = mutableLaunch.value?.takeIf { it.state == state } ?: return@withLock null
        val record = pending ?: return@withLock null
        val ticket = attempt ?: return@withLock null
        if (!authCurrent(ticket) || !record.active(clock.instant()) || !clock.instant().isBefore(record.launchDeadline)) {
            invalidateAuthLocked(AuthProblem.EXPIRED); return@withLock null
        }
        mutableLaunch.value = null // Rotation/recomposition must never launch this one-time URL twice.
        launch
    }
    override suspend fun browserFailed(state: String) {
        withContext(NonCancellable) { lock.withLock {
            if (attempt?.proof?.state == state) {
                try { invalidateAuthLocked(AuthProblem.BROWSER) }
                catch (_: Exception) { mutableAuth.value = AuthUiState(error = AuthProblem.STORAGE) }
            }
        } }
    }
    override suspend fun cancelAuthentication(): Result<Unit> = outcome {
        lock.withLock { invalidateAuthLocked() }
    }
    override suspend fun expireAuthentication(): Result<Unit> = outcome {
        lock.withLock {
            if (mutableAuth.value.expiresAt?.let { !it.isAfter(clock.instant()) } == true) invalidateAuthLocked(AuthProblem.EXPIRED)
        }
    }
    override suspend fun handleCallback(url: String): Result<Unit> = outcome {
        val support = auth ?: return@outcome
        // Wrong-origin/path/duplicate/unknown/wrong-state callbacks never consume a rightful flow.
        val callback = try { support.contract.callback(url) } catch (_: Exception) { return@outcome }
        restorePending().getOrThrow()
        var recheck: AuthAttempt? = null
        val claimed = lock.withLock {
            val record = pending ?: return@outcome
            val ticket = attempt ?: return@outcome
            if (record.proof.state != callback.state) return@outcome
            if (!record.active(clock.instant()) || !authCurrent(ticket)) {
                invalidateAuthLocked(if (record.active(clock.instant())) AuthProblem.SESSION_CHANGED else AuthProblem.EXPIRED)
                return@outcome
            }
            if (callback.error != null) {
                invalidateAuthLocked(SoopAuthContract.problem(callback.error))
                if (ticket.intent == AuthIntent.LINK && callback.error == "LINK_SESSION_CHANGED") recheck = ticket
                return@withLock null
            }
            try { withContext(NonCancellable) { support.pendingStore.clear() } }
            catch (failure: Exception) {
                attempt = null; pending = null; authRevision++; mutableLaunch.value = null
                mutableAuth.value = AuthUiState(error = AuthProblem.STORAGE)
                throw failure
            }
            pending = null; mutableLaunch.value = null
            val deadline = minOf(record.expiresAt, clock.instant().plusSeconds(120))
            mutableAuth.value = AuthUiState(AuthPhase.EXCHANGING, expiresAt = deadline)
            Triple(ticket, record, deadline)
        }
        if (claimed == null) {
            recheck?.let { refresh(retainAuthorized = true, expectedEpoch = it.epoch, expectedToken = it.token) }
            return@outcome
        }
        val (ticket, record, deadline) = claimed
        var returned: NativeCredential? = null
        var installed = false
        val operationJob = currentCoroutineContext()[Job]
        try {
            // A canceled/newer scope cannot reach HTTP even after durable consume suspends.
            val permitted = lock.withLock { authCurrent(ticket) && clock.instant().isBefore(deadline) }
            if (!permitted) return@outcome
            val response = support.contract.exchange(api.postAuth(ApiRoute.SOOP_EXCHANGE, ticket.token,
                support.contract.exchangeBody(record, requireNotNull(callback.code))))
            returned = response.credential
            lock.withLock {
                if (!authCurrent(ticket) || operationJob?.isActive == false || !clock.instant().isBefore(deadline)) return@withLock
                require(response.credential.token != ticket.token)
                require(response.credential.expiresAt.isAfter(clock.instant()))
                // Fixed seven-day issuance, with at most one minute of device/server clock skew.
                require(!response.credential.expiresAt.isAfter(clock.instant().plusSeconds(604_860)))
                if (ticket.intent == AuthIntent.LINK) require(response.session.account.id == ticket.accountId)
                withContext(NonCancellable) {
                    try { store.write(response.credential) }
                    catch (failure: Exception) {
                        try { clearLocked() } catch (_: Exception) { /* Durable failure remains retryable. */ }
                        mutableAuth.value = AuthUiState(error = AuthProblem.STORAGE)
                        throw failure
                    }
                    // Commit under the same epoch lock; no observer sees account state before secure persistence.
                    if (operationJob?.isActive == false || !response.credential.expiresAt.isAfter(clock.instant())) {
                        clearLocked(); return@withContext
                    }
                    credential = response.credential; loaded = true; removalPending = false
                    serverGeneration = response.session.serverGeneration; epoch++; profileRevision++
                    attempt = null; authRevision++; mutableAuth.value = AuthUiState()
                    publish(response.session.access, response.session.account)
                    installed = true
                }
            }
        } catch (cancelled: CancellationException) { authFailure(ticket, AuthProblem.LOST_RESPONSE); throw cancelled }
        catch (failure: Exception) {
            authFailure(ticket, when (failure) {
                is ApiException -> SoopAuthContract.problem(failure.code, failure.statusCode)
                is CredentialStoreException -> AuthProblem.STORAGE
                else -> AuthProblem.LOST_RESPONSE
            })
            if (ticket.intent == AuthIntent.LINK && failure is ApiException && failure.code == "LINK_SESSION_CHANGED") {
                refresh(retainAuthorized = true, expectedEpoch = ticket.epoch, expectedToken = ticket.token)
            }
            throw failure
        } finally {
            if (!installed) {
                authFailure(ticket, AuthProblem.LOST_RESPONSE)
                returned?.let { revokeReturned(it.token, ticket.token) }
            }
        }
    }
    private suspend fun revokeReturned(token: String, originalToken: String?) {
        withContext(NonCancellable) {
            val safe = lock.withLock { token != originalToken && token != credential?.token }
            if (safe) try { withTimeout(3_000) { api.postWithoutResponse(ApiRoute.LOGOUT, token, "{}") } }
            catch (_: Exception) { /* Result remains failed; never log a credential or replace another session. */ }
        }
    }
    private suspend inline fun <T> outcome(block: () -> T): Result<T> = try { Result.success(block()) }
    catch (cancelled: CancellationException) { throw cancelled }
    catch (failure: Exception) { Result.failure(failure) }
}
