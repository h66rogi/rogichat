package chat.rogi.rogichat.core.session

import chat.rogi.rogichat.core.auth.*
import chat.rogi.rogichat.core.identity.*
import chat.rogi.rogichat.core.messageactions.AccountBlocksCoordinator
import chat.rogi.rogichat.core.media.AccountMediaRepository
import chat.rogi.rogichat.core.push.*
import chat.rogi.rogichat.core.realtime.*
import chat.rogi.rogichat.core.rooms.*
import chat.rogi.rogichat.feature.rooms.RoomsRepository
import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.feature.settings.*
import java.util.UUID
import java.time.Clock
import java.time.Instant
import chat.rogi.rogichat.core.deletion.*
import chat.rogi.rogichat.core.conversation.*
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
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
                               private val auth: SoopAuthSupport? = null,
                               private val roomsStore: RoomsStore? = null,
                               private val deletionStore: AccountDeletionStore? = null,
                               private val roomCommandScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
                               private val realtime: NativeRealtimeManager? = null) : AccountAccessActions, SessionActions, ProfileRepository, NativeAuthActions, NotificationPreferencesRepository, chat.rogi.rogichat.feature.notifications.NotificationInboxRepository, RoomsRepository, AccountDeletionActions, ConversationGateway, PushGateway, AccountFeatureGateway {
    private val lock = Mutex()
    private val profileWrites = Mutex()
    @Volatile private var foreground = false
    private val realtimeLifecycle = Any()
    private var realtimeJob: Job? = null
    override fun setForeground(value: Boolean) = synchronized(realtimeLifecycle) {
        foreground = value
        if (!value) { realtime?.bind(null, false); realtimeJob?.cancel(); realtimeJob = null }
        else startRealtime()
    }
    private fun startRealtime(): Unit = synchronized(realtimeLifecycle) {
        val manager = realtime ?: return@synchronized
        if (!foreground || realtimeJob?.isActive == true || mutable.value.access != ShellAccess.READY) return@synchronized
        realtimeJob = roomCommandScope.launch {
            var reconnect: RealtimeTicket? = null
            var pause = 1000L
            while (isActive && foreground) {
                refresh(retainAuthorized = true)
                val admitted = lock.withLock {
                    val account = mutable.value.account
                    val saved = credential
                    if (!foreground || mutable.value.access != ShellAccess.READY || account == null || saved == null || !saved.expiresAt.isAfter(clock.instant())) return@launch
                    val scope = RealtimeScope(requireNotNull(auth).contract.environment, account.id, requireNotNull(serverGeneration), UUID.fromString(clientEpoch))
                    manager.bind(scope, true)
                    scope to saved.token
                }
                val (scope, bearer) = admitted
                var lost: RealtimeTicket? = null
                val old = reconnect?.takeIf { it.scope == scope }
                val stream = if (old == null) manager.connect(scope, bearer) else manager.reconnect(old, bearer)
                stream.collect { event -> when (event) {
                    is RealtimeEvent.SyncRequired -> { pause = 1000; conversationGraph?.wake() }
                    is RealtimeEvent.RevalidationRequired -> lost = event.ticket
                } }
                if (lost == null) break
                reconnect = lost
                delay(pause); pause = (pause * 2).coerceAtMost(30_000)
            }
        }
    }
    private var deletionLoaded = false
    private var deletionRecords = emptyList<DeletionRecord>()
    private class DeletionTicket(val intent: DeletionIntent, val original: NativeCredential, val epoch: Long, val partition: AccountPartition?) {
        var allowRestore = true
        var dispatching = true
        var observedReceipt: DeletionReceipt? = null
        var recentAuthRejected = false
    }
    private var activeDeletion: DeletionTicket? = null
    private val mutableDeletion = MutableStateFlow(DeletionState())
    override val deletionState = mutableDeletion.asStateFlow()
    private val mutable = MutableStateFlow(SessionSnapshot(access = ShellAccess.RESTORING))
    val session = mutable.asStateFlow()
    @Volatile private var clientEpoch = UUID.randomUUID().toString()
    @Volatile private var epoch = 0L
        set(value) {
            attempt?.dispatchActive?.set(false)
            grantExpiryJob?.cancel(); grantExpiryJob = null
            synchronized(realtimeLifecycle) { realtime?.bind(null, false); realtimeJob?.cancel(); realtimeJob = null }
            field = value; clientEpoch = UUID.randomUUID().toString(); blocksGraph?.invalidate()
        }
    @Volatile private var credential: NativeCredential? = null
    private var loaded = false
    private var removalPending = false
    private var refreshId = 0L
    private var activeRefresh: Long? = null
    private var serverGeneration: String? = null
    private var profileRevision = 0L
    @Volatile private var accountPartition: AccountPartition? = null
    private var blocksGraph: AccountBlocksCoordinator? = null
    private var conversationGraph: RoomConversationCoordinator? = null
    @Volatile private var roomRevision = 0L
        set(value) { field = value; conversationGraph?.invalidateAll() }
    private var roomIdentity: RoomSyncIdentity? = null
    @Volatile private var roomDirectory: RoomDirectory? = null
    private class RoomCommandTicket(val ticket: Ticket, val intent: RoomCommandIntent) { var reconciling = false }
    @Volatile private var activeRoomCommand: RoomCommandTicket? = null
    private var roomCommandRetry: Pair<RoomCommandTicket, Job>? = null
    private val mutableRoomRefresh = MutableStateFlow(0L)
    override val roomRefreshRequests = mutableRoomRefresh.asStateFlow()
    private val mutableRoomCommands = MutableStateFlow(RoomCommandState())
    override val roomCommands = mutableRoomCommands.asStateFlow()
    private val mutableAuth = MutableStateFlow(AuthUiState())
    override val authState = mutableAuth.asStateFlow()
    private val mutableLaunch = MutableStateFlow<BrowserLaunch?>(null)
    override val browserLaunch = mutableLaunch.asStateFlow()
    override val rulesUrl get() = requireNotNull(auth).contract.rulesUrl
    private var pendingLoaded = false
    private var pending: PendingAuth? = null
    private var attempt: AuthAttempt? = null
    private var grantExpiryJob: Job? = null
    private var authRevision = 0L
    private class AuthAttempt(val revision: Long, val epoch: Long, val proof: AuthProof, val intent: AuthIntent,
                              val createdAt: Instant, val token: String?, val accountId: String?,
                              val serverGeneration: String?, val clearStamp: String?, val provider: AuthProvider = AuthProvider.SOOP) {
        val dispatchActive = java.util.concurrent.atomic.AtomicBoolean(true)
    }
    override val providers = if (auth == null) emptySet() else setOf(SignInProvider.SOOP, SignInProvider.APPLE)
    override val canLinkSoop get() = auth != null
    override val canRestore = true
    override val canSignOut = true
    override suspend fun signIn(provider: SignInProvider) = unavailable()
    override suspend fun linkSoop() = beginAuthentication(AuthIntent.LINK)
    private fun unavailable(): Result<Unit> = Result.failure(IllegalStateException("operation_unavailable"))
    fun services(push: NativePushCoordinator? = null, channel: chat.rogi.rogichat.feature.channel.ChannelRepository? = null) = ProductServices(session, this, this, access = this, auth = this.takeIf { auth != null }, notificationPreferences = this, notificationInbox = this, rooms = this.takeIf { roomsStore != null }, deletion = this.takeIf { deletionStore != null }, conversations = conversationServices(), push = push, blocks = blockServices(), accountMedia = (roomsStore as? AccountFeatureStore)?.let { AccountMediaRepository(this, it) }, channel = channel)

    private fun blockServices(): AccountBlocksCoordinator? {
        val storage = roomsStore as? AccountFeatureStore ?: return null
        return blocksGraph ?: AccountBlocksCoordinator(this, storage, roomCommandScope, auth?.contract?.environment ?: "qa").also { blocksGraph = it }
    }
    private fun conversationServices(): ConversationRepository? {
        val storage = roomsStore as? ConversationStore ?: return null
        return conversationGraph ?: RoomConversationCoordinator(this, storage, roomCommandScope, clock, auth?.contract?.environment ?: "qa").also { conversationGraph = it }
    }
    private class Ticket(val epoch: Long, val credential: NativeCredential, val accountId: String?, val profileRevision: Long)
    private fun current(ticket: Ticket) = epoch == ticket.epoch && credential?.token == ticket.credential.token
    private fun publish(access: ShellAccess, account: AccountSummary? = null, notice: String? = null, storageFailure: Boolean = false) {
        mutable.value = SessionSnapshot(access, account, epoch, notice, expiresAt = credential?.expiresAt.takeIf { account != null }, storageFailure = storageFailure,
            accountPartition = accountPartition.takeIf { account != null })
        if (access == ShellAccess.READY) startRealtime()
    }
    private suspend fun clearLocked() {
        epoch++
        activeRefresh = null
        credential = null
        loaded = true
        serverGeneration = null
        accountPartition = null
        removalPending = true
        publish(ShellAccess.RESTORING)
        withContext(NonCancellable) {
            try {
                // Credential clear changes its durable stamp even if pending erase fails.
                var pendingFailure: Exception? = null
                try { invalidateAuthLocked() } catch (failure: Exception) { pendingFailure = failure }
                try { purgeRoomsLocked() } catch (failure: Exception) { pendingFailure = failure }
                store.clear()
                pendingFailure?.let { throw it }
                removalPending = false
                publish(ShellAccess.SIGNED_OUT)
            } catch (failure: Exception) {
                publish(ShellAccess.RETRYABLE_FAILURE, storageFailure = failure is CredentialStoreException || failure is RoomsStorageException)
                throw failure
            }
        }
    }
    override suspend fun restore(): Result<Unit> = refresh(retainAuthorized = false)
    private suspend fun refresh(retainAuthorized: Boolean, expectedEpoch: Long? = null, expectedToken: String? = null): Result<Unit> = outcome {
        var requestId = 0L
        val ticket = lock.withLock {
            deletionStartupLocked()
            if (activeDeletion != null) return@outcome
            if (expectedEpoch != null && (epoch != expectedEpoch || credential?.token != expectedToken)) return@outcome
            if (activeRefresh != null) return@outcome
            if (removalPending) { clearLocked(); return@outcome }
            if (!loaded) {
                try { credential = store.read(); loaded = true }
                catch (failure: Exception) { publish(ShellAccess.RETRYABLE_FAILURE, storageFailure = failure is CredentialStoreException || failure is RoomsStorageException); throw failure }
            }
            val saved = credential
            if (saved == null) { purgeRoomsLocked(); publish(ShellAccess.SIGNED_OUT); return@outcome }
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
                    mutable.value.access != projection.access || accountPartition != projection.accountPartition) {
                    epoch++; publish(ShellAccess.RESTORING)
                    if (projection.access == ShellAccess.READY && projection.accountPartition != null && roomsStore is ConversationStore) {
                        // Close authority first; persistent binding/generation/partition decides preservation.
                        // A same-credential retry after a transient error must retain the immutable outbox.
                        withdrawRoomsLocked()
                    } else purgeRoomsLocked()
                    if (projection.access == ShellAccess.READY && projection.accountPartition != null && roomsStore is ConversationStore) {
                        val scope = RoomsAccountScope(projection.account.id, epoch, projection.accountPartition)
                        try {
                            roomsStore.authorize(scope, fingerprint(updated.token), projection.serverGeneration) {
                                if (credential?.token != ticket.credential.token || !updated.expiresAt.isAfter(clock.instant()))
                                    throw CancellationException("session_scope_changed")
                            }
                        } catch (failure: Exception) {
                            if (!updated.expiresAt.isAfter(clock.instant())) clearLocked()
                            else publish(ShellAccess.RETRYABLE_FAILURE, storageFailure = true)
                            throw failure
                        }
                    }
                }
                credential = updated
                serverGeneration = projection.serverGeneration
                accountPartition = projection.accountPartition
                publish(projection.access, account)
            }
        } catch (cancelled: CancellationException) {
            withContext(NonCancellable) { lock.withLock {
                if (current(ticket) && mutable.value.access == ShellAccess.RESTORING) { epoch++; publish(ShellAccess.RETRYABLE_FAILURE); withdrawRoomsLocked() }
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
                    else { epoch++; publish(ShellAccess.RETRYABLE_FAILURE, storageFailure = failure is CredentialStoreException || failure is RoomsStorageException); withdrawRoomsLocked() }
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
    override suspend fun signOut(expected: SessionIdentity?): Result<Unit> = outcome {
        var localFailure: Exception? = null
        val previous = lock.withLock {
            if (expected != null && !expected.matches(mutable.value)) throw CancellationException("stale_session_intent")
            activeDeletion?.allowRestore = false
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
                        notice = "이 기기에서 로그아웃했어요.")
                }
            }
        }
        localFailure?.let { throw it }
    }
    override suspend fun load(accountId: String): Result<UserProfile> = profile(accountId) { token, _ ->
        NativeDtos.profile(api.get(ApiRoute.PROFILE, token))
    }
    override suspend fun admitPush(account: NotificationAccountScope, installation: NativePushInstallation): PushPermit = lock.withLock {
        if (mutable.value.access != ShellAccess.READY || mutable.value.account?.id != account.accountId || epoch != account.localEpoch)
            throw CancellationException("push_scope_changed")
        val saved = credential ?: throw CancellationException("push_scope_changed")
        if (!saved.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
        val originalEpoch = clientEpoch
        val captured = Ticket(epoch, saved, account.accountId, profileRevision)
        val scope = PushScope(requireNotNull(auth).contract.environment, account.accountId, requireNotNull(serverGeneration),
            UUID.fromString(originalEpoch), UUID.fromString(installation.installationId))
        PushPermit(scope, account, captured) {
            if (clientEpoch != originalEpoch || !saved.expiresAt.isAfter(clock.instant())) throw CancellationException("push_scope_changed")
        }
    }
    override suspend fun <T> pushRequest(permit: PushPermit, request: suspend (NativeApi, String, () -> Unit) -> T): T {
        permit.check()
        return ownState(permit.account) { token ->
            val original = permit.handle as Ticket
            permit.check(); if (token != original.credential.token) throw CancellationException("push_scope_changed")
            request(api, token, permit::check).also { permit.check() }
        }.getOrThrow()
    }
    override suspend fun getPreferences(scope: NotificationAccountScope): Result<NotificationPreferences> = ownState(scope) { token ->
        NotificationApi(api).getPreferences(token)
    }
    override suspend fun getInbox(scope: NotificationAccountScope, cursor: String?): Result<chat.rogi.rogichat.feature.notifications.InboxPage> = ownState(scope) { token ->
        chat.rogi.rogichat.feature.notifications.InboxContract.page(api.getNotificationInbox(token, cursor))
    }
    override suspend fun markInboxRead(scope: NotificationAccountScope, id: String): Result<Unit> = ownState(scope) { token ->
        api.markNotificationRead(token, id)
    }
    override suspend fun disablePush(scope: NotificationAccountScope, expected: PreferenceGeneration): Result<NotificationPreferences> = ownState(scope) { token ->
        NotificationApi(api).disablePush(token, expected)
    }
    // Reuses the profile transport's exact credential/epoch/expiry gate. Preferences do not require SOOP linking.
    private suspend fun <T> ownState(scope: NotificationAccountScope, call: suspend (String) -> T): Result<T> = outcome {
        val accountId = scope.accountId
        val ticket = lock.withLock {
            if (epoch != scope.localEpoch || mutable.value.account?.id != accountId || mutable.value.access !in setOf(ShellAccess.READY, ShellAccess.LINK_REQUIRED))
                throw CancellationException("account_scope_changed")
            val saved = credential ?: throw CancellationException("account_scope_changed")
            if (!saved.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
            Ticket(epoch, saved, accountId, profileRevision)
        }
        suspend fun checkCurrent() {
            if (!current(ticket) || mutable.value.account?.id != accountId) throw CancellationException("account_scope_changed")
            if (!ticket.credential.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
        }
        try {
            currentCoroutineContext().ensureActive()
            lock.withLock { checkCurrent() }
            val result = call(ticket.credential.token)
            lock.withLock { checkCurrent() }
            result
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            lock.withLock {
                checkCurrent()
                if (failure is ApiException && failure.statusCode == 401) {
                    clearLocked()
                    throw CancellationException("session_unauthenticated")
                }
            }
            throw failure
        }
    }
    override suspend fun save(accountId: String, changes: ProfileChanges): Result<UserProfile> = profile(accountId, save = true) { token, admission ->
        NativeDtos.profile(api.patchAdmitted(ApiRoute.PROFILE, token, NativeDtos.profilePatch(changes), admission))
    }
    private suspend fun profile(accountId: String, save: Boolean = false, call: suspend (String, () -> Unit) -> UserProfile): Result<UserProfile> = outcome {
        val ticket = lock.withLock {
            val own = mutable.value.account
            if (own?.id != accountId || mutable.value.access !in setOf(ShellAccess.READY, ShellAccess.LINK_REQUIRED))
                throw CancellationException("account_scope_changed")
            val saved = credential ?: throw CancellationException("account_scope_changed")
            if (!saved.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
            Ticket(epoch, saved, accountId, profileRevision)
        }
        try {
            suspend fun execute(): UserProfile {
                val admission = {
                    if (!current(ticket) || mutable.value.account?.id != accountId || !ticket.credential.expiresAt.isAfter(clock.instant()))
                        throw CancellationException("account_scope_changed")
                }
                admission()
                val result = call(ticket.credential.token, admission)
                if (result.id != accountId) throw InvalidResponse()
                lock.withLock {
                    if (!current(ticket) || mutable.value.account?.id != accountId) throw CancellationException("account_scope_changed")
                    if (!ticket.credential.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
                    if (save) mutable.value.account?.let { account ->
                        profileRevision++
                        mutable.value = mutable.value.copy(account = account.copy(nickname = result.nickname, avatarAssetId = result.avatarAssetId))
                    }
                }
                return result
            }
            if (save) profileWrites.withLock { execute() } else execute()
        } catch (failure: ApiException) {
            var refresh = false
            lock.withLock {
                if (current(ticket)) {
                    if (failure.statusCode == 401) clearLocked()
                    else if (failure.statusCode == 403 && failure.code == "SOOP_LINK_REQUIRED") {
                        val own = mutable.value.account
                        epoch++; publish(ShellAccess.RESTORING); purgeRoomsLocked()
                        own?.let { publish(ShellAccess.LINK_REQUIRED, it.copy(soopConnected = false)) }
                        refresh = true
                    }
                }
            }
            if (refresh) restore()
            throw failure
        }
    }
    override suspend fun resetLocalSession(expected: SessionIdentity?): Result<Unit> = outcome {
        lock.withLock {
            if (expected != null && !expected.matches(mutable.value)) throw CancellationException("stale_session_intent")
            if (mutable.value.account != null || !mutable.value.storageFailure) return@withLock
            clearLocked()
        }
    }

    private suspend fun withdrawRoomsLocked() {
        roomRevision++; roomIdentity = null; roomDirectory = null
        activeRoomCommand = null; mutableRoomCommands.value = RoomCommandState()
        try { withContext(NonCancellable) {
            if (roomsStore is ConversationStore) roomsStore.withdrawAuthority() else roomsStore?.clear()
        } } catch (failure: Exception) {
            publish(ShellAccess.RETRYABLE_FAILURE, storageFailure = true)
            throw failure
        }
    }
    override suspend fun admitAccountFeature(expected: SessionIdentity): AccountFeaturePermit = lock.withLock {
        if (!expected.matches(mutable.value) || mutable.value.access != ShellAccess.READY || activeRoomCommand != null) throw CancellationException("account_scope_changed")
        val saved = credential ?: throw CancellationException("account_scope_changed")
        if (!saved.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
        val account = RoomsAccountScope(requireNotNull(expected.accountId), epoch, accountPartition ?: throw CancellationException("account_partition_unavailable"))
        val ticket = Ticket(epoch, saved, expected.accountId, profileRevision)
        val originalEpoch = clientEpoch
        val permit = AccountFeaturePermit(account, originalEpoch, ticket) {
            if (clientEpoch != originalEpoch || !current(ticket) || !expected.matches(mutable.value) || mutable.value.access != ShellAccess.READY ||
                accountPartition != account.partition || activeRoomCommand != null || !saved.expiresAt.isAfter(clock.instant())) throw CancellationException("account_scope_changed")
        }
        (roomsStore as? AccountFeatureStore)?.prepareAccount(account, fingerprint(saved.token), requireNotNull(serverGeneration), permit::check)
            ?: throw RoomsStorageException()
        permit
    }
    override suspend fun <T> accountFeatureCommit(permit: AccountFeaturePermit, operation: suspend (() -> Unit) -> T): T = lock.withLock {
        permit.check()
        val ticket = permit.handle as Ticket
        (roomsStore as? AccountFeatureStore)?.prepareAccount(permit.account, fingerprint(ticket.credential.token), requireNotNull(serverGeneration), permit::check)
            ?: throw RoomsStorageException()
        operation(permit::check).also { permit.check() }
    }
    override suspend fun <T> accountFeatureRequest(permit: AccountFeaturePermit, operation: suspend (NativeApi, String, () -> Unit) -> T): T {
        val ticket = lock.withLock { permit.check(); permit.handle as Ticket }
        try {
            val result = operation(api, ticket.credential.token, permit::check)
            lock.withLock { permit.check() }
            return result
        } catch (failure: Exception) {
            withContext(NonCancellable) { lock.withLock {
                if (current(ticket)) {
                    if (!ticket.credential.expiresAt.isAfter(clock.instant()) || failure is ApiException && failure.statusCode == 401) clearLocked()
                    else if (failure is ApiException && failure.statusCode == 403 && failure.code == "SOOP_LINK_REQUIRED") {
                        val account = mutable.value.account
                        epoch++; publish(ShellAccess.RESTORING); purgeRoomsLocked()
                        account?.let { publish(ShellAccess.LINK_REQUIRED, it.copy(soopConnected = false)) }
                    }
                }
            } }
            throw failure
        }
    }
    override suspend fun accountBlocksChanged(permit: AccountFeaturePermit): Unit = lock.withLock {
        permit.check(); withdrawRoomsLocked(); mutableRoomRefresh.value++; Unit
    }
    override suspend fun accountProfileRequest(permit: AccountFeaturePermit, operation: suspend (NativeApi, String, () -> Unit) -> String): String = profileWrites.withLock {
        // The original permit is captured before waiting; mutation + full response publication share this lock.
        val body = accountFeatureRequest(permit, operation)
        accountProfileChanged(permit, body)
        body
    }
    private suspend fun accountProfileChanged(permit: AccountFeaturePermit, body: String): Unit = lock.withLock {
        permit.check(); val profile = NativeDtos.profile(body); require(profile.id == permit.account.accountId)
        profileRevision++
        mutable.value.account?.let { publish(mutable.value.access, it.copy(nickname = profile.nickname, avatarAssetId = profile.avatarAssetId)) }; Unit
    }
    private class ConversationTicket(val session: Ticket, val revision: Long)
    override suspend fun admitConversation(selection: ConversationSelection): ConversationPermit = lock.withLock {
        if (activeRoomCommand != null) throw RoomCommandInProgress()
        val saved = credential ?: throw CancellationException("session_scope_changed")
        if (!saved.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
        val ticket = Ticket(epoch, saved, selection.account.accountId, profileRevision)
        checkRoomTicket(ticket, selection.account, roomRevision)
        val directory = roomDirectory ?: throw StaleRoomSelection()
        if (directory.cycle != selection.directoryCycle || directory.memberships.none { it == selection.membership }) throw StaleRoomSelection()
        val admittedEpoch = clientEpoch
        lateinit var permit: ConversationPermit
        permit = ConversationPermit(selection, requireNotNull(roomIdentity).deviceId, ConversationTicket(ticket, roomRevision), admittedEpoch) {
            if (clientEpoch != admittedEpoch) throw CancellationException("conversation_scope_changed")
            checkConversation(permit)
        }
        permit
    }
    private fun checkConversation(permit: ConversationPermit): ConversationTicket {
        val captured = permit.handle as ConversationTicket
        checkRoomTicket(captured.session, permit.selection.account, captured.revision)
        if (activeRoomCommand != null || roomDirectory?.cycle != permit.selection.directoryCycle ||
            roomDirectory?.memberships?.none { it == permit.selection.membership } != false) throw CancellationException("conversation_scope_changed")
        return captured
    }
    private suspend fun requireConversationLocked(permit: ConversationPermit): ConversationTicket {
        val captured = permit.handle as ConversationTicket
        if (current(captured.session) && !captured.session.credential.expiresAt.isAfter(clock.instant())) {
            clearLocked(); throw CancellationException("session_expired")
        }
        return checkConversation(permit)
    }
    override suspend fun <T> conversationCommit(permit: ConversationPermit, action: suspend (() -> Unit) -> T): T = lock.withLock {
        requireConversationLocked(permit)
        try {
            val result = action { checkConversation(permit) }
            requireConversationLocked(permit); result
        } catch (failure: Exception) {
            // A final synchronous validation can expire inside SQLite; rollback precedes durable teardown.
            val captured = permit.handle as ConversationTicket
            if (current(captured.session) && !captured.session.credential.expiresAt.isAfter(clock.instant())) clearLocked()
            throw failure
        }
    }
    override suspend fun <T> conversationRequest(permit: ConversationPermit, request: suspend (NativeApi, String) -> T): T {
        val captured = lock.withLock { requireConversationLocked(permit) }
        try {
            currentCoroutineContext().ensureActive()
            val result = request(api, captured.session.credential.token)
            lock.withLock {
                if (current(captured.session) && !captured.session.credential.expiresAt.isAfter(clock.instant())) clearLocked()
                checkConversation(permit)
            }
            return result
        } catch (failure: Exception) {
            withContext(NonCancellable) { lock.withLock {
                if (current(captured.session)) {
                    if (!captured.session.credential.expiresAt.isAfter(clock.instant()) || failure is ApiException && failure.statusCode == 401) clearLocked()
                    else if (failure is ApiException && failure.statusCode == 403 && failure.code == "SOOP_LINK_REQUIRED") {
                        val account = mutable.value.account
                        epoch++; publish(ShellAccess.RESTORING); purgeRoomsLocked()
                        account?.let { publish(ShellAccess.LINK_REQUIRED, it.copy(soopConnected = false)) }
                    }
                }
            } }
            throw failure
        }
    }
    private suspend fun purgeRoomsLocked() {
        roomRevision++; roomIdentity = null; roomDirectory = null
        activeRoomCommand = null; mutableRoomCommands.value = RoomCommandState()
        try { withContext(NonCancellable) { roomsStore?.clear() } }
        catch (failure: Exception) { publish(ShellAccess.RETRYABLE_FAILURE, storageFailure = true); throw failure }
    }
    private fun checkRoomTicket(ticket: Ticket, scope: RoomsAccountScope, revision: Long) {
        if (!current(ticket) || epoch != scope.localEpoch || mutable.value.account?.id != scope.accountId ||
            mutable.value.access != ShellAccess.READY || accountPartition != scope.partition || roomRevision != revision)
            throw CancellationException("room_scope_changed")
        if (!ticket.credential.expiresAt.isAfter(clock.instant())) throw CancellationException("session_expired")
    }
    override suspend fun refreshRooms(scope: RoomsAccountScope) = refreshRooms(scope, null)
    private suspend fun refreshRooms(scope: RoomsAccountScope, owner: RoomCommandTicket?): Result<RoomDirectory> = roomOperation(scope, start = true, owner = owner) { ticket, revision ->
        val storage = requireNotNull(roomsStore)
        var resets = 0
        var complete = false
        var cursor: SyncCursor? = null
        var identity = roomCommit(ticket, scope, revision) { validate ->
            if (storage is ConversationStore) storage.authorize(scope, fingerprint(ticket.credential.token), requireNotNull(serverGeneration), validate)
            storage.begin(scope, validate).also { roomIdentity = it }
        }
        var pages = 0
        while (!complete) {
            if (++pages > 101) throw InvalidResponse()
            lock.withLock { checkRoomTicket(ticket, scope, revision) }
            currentCoroutineContext().ensureActive()
            val page = RoomsApi(api).manifest(ticket.credential.token, ManifestRequest(identity.deviceId, identity.cacheId, cursor))
            roomCommit(ticket, scope, revision) { validate -> storage.manifest(scope, identity, cursor, page, validate) }
            when (page) {
                MembershipPage.Reset -> {
                    if (++resets > 1) throw RoomsResetRequired()
                    identity = roomCommit(ticket, scope, revision) { validate -> storage.begin(scope, validate).also { roomIdentity = it } }
                    cursor = null
                }
                is MembershipPage.Success -> { complete = page.complete; cursor = page.next }
            }
        }
        lock.withLock { checkRoomTicket(ticket, scope, revision) }
        currentCoroutineContext().ensureActive()
        val page = RoomsApi(api).discover(ticket.credential.token, null)
        roomCommit(ticket, scope, revision) { validate -> storage.discovery(scope, identity, null, page, validate).also { roomDirectory = it } }
    }
    override suspend fun moreRooms(scope: RoomsAccountScope, continuation: DiscoveryContinuation): Result<RoomDirectory> =
        roomOperation(scope, start = false) { ticket, revision ->
            val identity = lock.withLock {
                checkRoomTicket(ticket, scope, revision)
                roomIdentity?.takeIf { it.cacheId == continuation.cacheId } ?: throw CancellationException("room_cycle_changed")
            }
            currentCoroutineContext().ensureActive()
            val page = RoomsApi(api).discover(ticket.credential.token, continuation.after)
            roomCommit(ticket, scope, revision) { validate ->
                requireNotNull(roomsStore).discovery(scope, identity, continuation.after, page, validate).also { roomDirectory = it }
            }
        }
    private suspend fun <T> roomCommit(ticket: Ticket, scope: RoomsAccountScope, revision: Long,
                                       action: suspend (() -> Unit) -> T): T = lock.withLock {
        checkRoomTicket(ticket, scope, revision)
        // Keep the lifecycle mutex through SQLite COMMIT. Logout/credential rotation linearizes after it.
        val result = action { checkRoomTicket(ticket, scope, revision) }
        if (!ticket.credential.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
        checkRoomTicket(ticket, scope, revision)
        result
    }
    private suspend fun <T> roomOperation(scope: RoomsAccountScope, start: Boolean, owner: RoomCommandTicket? = null,
                                          operation: suspend (Ticket, Long) -> T): Result<T> = outcome {
        currentCoroutineContext().ensureActive()
        val (ticket, revision) = lock.withLock {
            if (activeRoomCommand != null && activeRoomCommand !== owner) throw RoomCommandInProgress()
            if (owner != null && activeRoomCommand !== owner) throw CancellationException("room_command_changed")
            val saved = credential ?: throw CancellationException("room_scope_changed")
            if (!saved.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
            val ticket = Ticket(epoch, saved, scope.accountId, profileRevision)
            checkRoomTicket(ticket, scope, roomRevision)
            if (start) { roomRevision++; roomDirectory = null }
            ticket to roomRevision
        }
        try { operation(ticket, revision) }
        catch (failure: Exception) {
            withContext(NonCancellable) { lock.withLock {
                if (current(ticket) && roomRevision == revision) {
                    if (!ticket.credential.expiresAt.isAfter(clock.instant()) || failure is ApiException && failure.statusCode == 401) clearLocked()
                    else if (failure is ApiException && failure.statusCode == 403 && failure.code == "SOOP_LINK_REQUIRED") {
                        val own = mutable.value.account
                        epoch++; publish(ShellAccess.RESTORING); purgeRoomsLocked()
                        own?.let { publish(ShellAccess.LINK_REQUIRED, it.copy(soopConnected = false)) }
                    }
                }
            } }
            throw failure
        }
    }

    /** Admission returns locally; the session owns the one-shot command across screen cancellation. */
    override suspend fun submitRoomCommand(intent: RoomCommandIntent): Result<Unit> = outcome {
        currentCoroutineContext().ensureActive()
        lock.withLock {
            if (activeRoomCommand != null) throw RoomCommandInProgress()
            val saved = credential ?: throw CancellationException("room_scope_changed")
            if (!saved.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
            val ticket = Ticket(epoch, saved, intent.scope.accountId, profileRevision)
            checkRoomTicket(ticket, intent.scope, roomRevision)
            val directory = roomDirectory ?: throw StaleRoomSelection()
            if (directory.cycle != intent.cycle || roomIdentity?.cacheId != intent.cycle) throw StaleRoomSelection()
            val selected = when (intent.action) {
                RoomAction.JOIN -> intent.membership == null && directory.memberships.none { it.roomId == intent.roomId } &&
                    directory.discovered.any { it.roomId == intent.roomId }
                RoomAction.LEAVE -> directory.memberships.any { it.roomId == intent.roomId && it.membershipScope == intent.membership }
            }
            if (!selected) throw StaleRoomSelection()
            val command = RoomCommandTicket(ticket, intent)
            activeRoomCommand = command
            roomRevision++; roomDirectory = null
            mutableRoomCommands.value = RoomCommandState(intent.scope, RoomCommandPhase.SENDING, intent.action)
            roomCommandScope.launch { executeRoomCommand(command) }
            Unit
        }
    }
    private suspend fun checkRoomCommandLocked(command: RoomCommandTicket) {
        if (activeRoomCommand !== command) throw CancellationException("room_command_changed")
        if (current(command.ticket) && !command.ticket.credential.expiresAt.isAfter(clock.instant())) {
            clearLocked(); throw CancellationException("session_expired")
        }
        checkRoomTicket(command.ticket, command.intent.scope, roomRevision)
    }
    private suspend fun executeRoomCommand(command: RoomCommandTicket) {
        try {
            // Withdraw all-room authority before the POST; a failed commit sends nothing.
            lock.withLock {
                checkRoomCommandLocked(command)
                roomIdentity = requireNotNull(roomsStore).begin(command.intent.scope) {
                    checkRoomTicket(command.ticket, command.intent.scope, roomRevision)
                }
                checkRoomCommandLocked(command)
            }
            lock.withLock { checkRoomCommandLocked(command) }
            currentCoroutineContext().ensureActive()
            val network = RoomsApi(api)
            when (command.intent.action) {
                RoomAction.JOIN -> network.join(command.ticket.credential.token, command.intent.roomId)
                RoomAction.LEAVE -> network.leave(command.ticket.credential.token, command.intent.roomId)
            }
            // An acknowledgement is not an all-room manifest and never becomes an optimistic row.
            resolveRoomCommand(command)
        } catch (failure: Exception) {
            try { withContext(NonCancellable) { lock.withLock {
                if (activeRoomCommand === command && current(command.ticket)) {
                    if (!command.ticket.credential.expiresAt.isAfter(clock.instant()) || failure is ApiException && failure.statusCode == 401) clearLocked()
                    else if (failure is ApiException && failure.statusCode == 403 && failure.code == "SOOP_LINK_REQUIRED") {
                        val own = mutable.value.account
                        epoch++; publish(ShellAccess.RESTORING); purgeRoomsLocked()
                        own?.let { publish(ShellAccess.LINK_REQUIRED, it.copy(soopConnected = false)) }
                    } else {
                        mutableRoomCommands.value = mutableRoomCommands.value.copy(
                            phase = if (failure is CancellationException) RoomCommandPhase.UNVERIFIED else RoomCommandPhase.RECONCILING,
                            issue = roomCommandIssue(failure))
                        if (failure is CancellationException) scheduleRoomCommandVerification(command)
                    }
                }
            } } } catch (_: Exception) { return } // Durable teardown already publishes its storage error.
            if (failure !is CancellationException) resolveRoomCommand(command)
        }
    }
    private fun roomCommandIssue(failure: Exception) = when {
        failure is RoomsStorageException -> RoomCommandIssue.STORAGE
        failure is ApiException && failure.statusCode == 409 -> RoomCommandIssue.CONFLICT
        failure is ApiException && failure.statusCode == 403 -> RoomCommandIssue.FORBIDDEN
        failure is ApiException && failure.statusCode == 404 -> RoomCommandIssue.NOT_FOUND
        failure is ApiException && failure.statusCode in setOf(400, 413) -> RoomCommandIssue.REJECTED
        else -> RoomCommandIssue.UNKNOWN
    }
    /** The original command is never replayed; only the membership manifest is read again. */
    private fun scheduleRoomCommandVerification(command: RoomCommandTicket) {
        if (roomCommandRetry?.first === command && roomCommandRetry?.second?.isActive == true) return
        roomCommandRetry?.second?.cancel()
        roomCommandRetry = command to roomCommandScope.launch {
            var waitMs = 2_000L
            while (isActive) {
                delay(waitMs)
                val state = lock.withLock {
                    if (activeRoomCommand !== command) null else mutableRoomCommands.value.phase
                } ?: return@launch
                if (state == RoomCommandPhase.UNVERIFIED) recheckRoomCommand(command.intent.scope)
                else if (state != RoomCommandPhase.RECONCILING) return@launch
                waitMs = (waitMs * 2).coerceAtMost(30_000L)
            }
        }
    }
    override suspend fun recheckRoomCommand(scope: RoomsAccountScope): Result<Unit> = outcome {
        currentCoroutineContext().ensureActive()
        lock.withLock {
            val command = activeRoomCommand ?: throw StaleRoomSelection()
            if (command.intent.scope != scope) throw CancellationException("room_scope_changed")
            checkRoomCommandLocked(command)
            if (mutableRoomCommands.value.phase != RoomCommandPhase.UNVERIFIED || command.reconciling) throw RoomCommandInProgress()
            mutableRoomCommands.value = mutableRoomCommands.value.copy(phase = RoomCommandPhase.RECONCILING, verificationIssue = null)
            roomCommandScope.launch { resolveRoomCommand(command) }
            Unit
        }
    }
    private suspend fun resolveRoomCommand(command: RoomCommandTicket) {
        try {
            lock.withLock {
                checkRoomCommandLocked(command)
                if (command.reconciling) return
                command.reconciling = true
                mutableRoomCommands.value = mutableRoomCommands.value.copy(phase = RoomCommandPhase.RECONCILING, verificationIssue = null)
            }
            val result = refreshRooms(command.intent.scope, command)
            lock.withLock {
                checkRoomCommandLocked(command)
                command.reconciling = false
                result.fold({ directory ->
                    activeRoomCommand = null
                    mutableRoomCommands.value = mutableRoomCommands.value.copy(phase = RoomCommandPhase.VERIFIED, directory = directory)
                }, { failure ->
                    mutableRoomCommands.value = mutableRoomCommands.value.copy(phase = RoomCommandPhase.UNVERIFIED,
                        verificationIssue = if (failure is RoomsStorageException) RoomVerificationIssue.STORAGE else RoomVerificationIssue.UNAVAILABLE)
                    scheduleRoomCommandVerification(command)
                })
            }
        } catch (_: Exception) {
            withContext(NonCancellable) { lock.withLock {
                if (activeRoomCommand === command && current(command.ticket)) {
                    command.reconciling = false
                    mutableRoomCommands.value = mutableRoomCommands.value.copy(phase = RoomCommandPhase.UNVERIFIED, verificationIssue = RoomVerificationIssue.UNAVAILABLE)
                    scheduleRoomCommandVerification(command)
                }
            } }
        }
    }

    private suspend fun saveDeletionLocked(record: DeletionRecord) {
        val records = if (deletionRecords.any { it.operationId == record.operationId })
            deletionRecords.map { if (it.operationId == record.operationId) record else it }
        else deletionRecords + record
        if (records.size > 16) throw DeletionCapacityExceeded()
        withContext(NonCancellable) { requireNotNull(deletionStore).write(records) }
        deletionRecords = records
    }
    private fun deletionRecord(ticket: DeletionTicket): DeletionRecord = deletionRecords.find { it.operationId == ticket.intent.operationId }
        ?: DeletionRecord(ticket.intent.operationId, ticket.intent.accountId, fingerprint(ticket.original.token), null, accountPartition = ticket.partition?.value)
    /** Caller owns the lifecycle lock. Never call global purge against a different current token. */
    private suspend fun eraseDeletionOriginalLocked(record: DeletionRecord): String? = withContext(NonCancellable) {
        val saved = store.read()
        if (saved != null && fingerprint(saved.token) != record.fingerprint || credential != null && fingerprint(requireNotNull(credential).token) != record.fingerprint)
            throw DeletionStorageException()
        credential = null; loaded = true; serverGeneration = null; accountPartition = null; removalPending = true
        var failure: Exception? = null
        try {
            // During live admission no new proof can be installed. Cold recovery must not
            // consume a different account's unbound login merely because no token remains.
            val liveOwner = activeDeletion?.intent?.operationId == record.operationId
            val proof = if (saved == null && !liveOwner) auth?.pendingStore?.read() else null
            if (saved != null || liveOwner || proof?.credentialFingerprint == record.fingerprint || proof?.accountId == record.accountId)
                invalidateAuthLocked()
        } catch (error: Exception) { failure = error }
        // Retire UI/commands first; scoped disk cleanup refuses any foreign partition.
        roomRevision++; roomIdentity = null; roomDirectory = null
        activeRoomCommand = null; mutableRoomCommands.value = RoomCommandState()
        try { roomsStore?.clearForDeletion(record.accountPartition?.let(::AccountPartition)) } catch (error: Exception) { failure = error }
        // A missing token with a different stamp is not permission to clear any newer token.
        // read() already retries a prior credential tombstone; no extra clear is necessary then.
        try { if (saved != null) store.clear() } catch (error: Exception) { failure = error }
        failure?.let { throw it }
        removalPending = false
        store.clearStamp()
    }
    /** Runs before every credential/pending-auth restore. It never issues a DELETE or receipt GET. */
    private suspend fun deletionStartupLocked() {
        if (deletionStore == null || activeDeletion != null) return
        try {
            if (!deletionLoaded) {
                deletionRecords = deletionStore.read(); deletionLoaded = true
                mutableDeletion.value = DeletionState(deletionRecords.lastOrNull())
            }
            deletionRecords.singleOrNull { it.cleanupPending }?.let { record ->
                epoch++; publish(ShellAccess.RESTORING)
                // PREPARING includes clear() -> stamp write crashes. REAUTH_RESTORING includes
                // credential.write() -> journal completion crashes, with an absent clear marker.
                // Only the exact original fingerprint may be erased, never a newer token on mismatch.
                val stamp = eraseDeletionOriginalLocked(record)
                val phase = when (record.phase) {
                    DeletionPhase.PREPARING, DeletionPhase.CLEARED -> DeletionPhase.ABORTED
                    DeletionPhase.REAUTH_RESTORING -> DeletionPhase.REAUTH_DONE
                    DeletionPhase.SENDING -> DeletionPhase.UNKNOWN
                    else -> record.phase
                }
                val finished = record.copy(phase = phase, afterStamp = stamp, cleanupPending = false)
                saveDeletionLocked(finished); mutableDeletion.value = DeletionState(finished)
            }
        } catch (failure: Exception) {
            mutableDeletion.value = mutableDeletion.value.copy(busy = false, storageFailure = true)
            publish(ShellAccess.RETRYABLE_FAILURE, storageFailure = true)
            throw failure
        }
    }
    override suspend fun requestDeletion(intent: DeletionIntent): Result<Unit> = outcome {
        currentCoroutineContext().ensureActive()
        lock.withLock {
            // Check the original rendered scope BEFORE closing any UI or reading/changing storage.
            if (intent.epoch != epoch || intent.accountId != mutable.value.account?.id ||
                mutable.value.access !in setOf(ShellAccess.READY, ShellAccess.LINK_REQUIRED)) throw CancellationException("account_scope_changed")
            requireNotNull(deletionStore)
            if (activeDeletion != null || mutableDeletion.value.blocksSession) throw DeletionInProgress()
            require(deletionLoaded)
            if (deletionRecords.size >= 16) {
                mutableDeletion.value = mutableDeletion.value.copy(capacityReached = true)
                throw DeletionCapacityExceeded()
            }
            if (deletionRecords.any { it.operationId == intent.operationId }) throw DeletionInProgress()
            val saved = credential ?: throw CancellationException("account_scope_changed")
            if (!saved.expiresAt.isAfter(clock.instant())) { clearLocked(); throw CancellationException("session_expired") }
            epoch++; activeRefresh = null; profileRevision++
            val ticket = DeletionTicket(intent, saved, epoch, accountPartition)
            activeDeletion = ticket
            publish(ShellAccess.RESTORING)
            mutableDeletion.value = DeletionState(deletionRecord(ticket), busy = true)
            roomCommandScope.launch { executeDeletion(ticket) }
            Unit
        }
    }
    private fun deletionCurrent(ticket: DeletionTicket) = activeDeletion === ticket && epoch == ticket.epoch
    private suspend fun executeDeletion(ticket: DeletionTicket) {
        var sent = false
        try {
            lock.withLock {
                if (!deletionCurrent(ticket)) throw CancellationException("deletion_scope_changed")
                var record = deletionRecord(ticket).copy(beforeStamp = store.clearStamp())
                saveDeletionLocked(record)
                val stamp = eraseDeletionOriginalLocked(record)
                record = record.copy(phase = DeletionPhase.CLEARED, afterStamp = stamp)
                saveDeletionLocked(record)
                if (!deletionCurrent(ticket) || !ticket.original.expiresAt.isAfter(clock.instant())) throw CancellationException("deletion_scope_changed")
                record = record.copy(phase = DeletionPhase.SENDING)
                saveDeletionLocked(record)
                mutableDeletion.value = DeletionState(record, busy = true)
            }
            lock.withLock {
                // Every required disk suspension has finished. This is the dispatch permit,
                // so expiry/logout during the SENDING write still sends zero DELETE requests.
                if (!deletionCurrent(ticket) || !ticket.allowRestore || !ticket.original.expiresAt.isAfter(clock.instant()))
                    throw CancellationException("deletion_dispatch_rejected")
                currentCoroutineContext().ensureActive()
                sent = true
            }
            val receipt = AccountDeletionDto.receipt(api.deleteAccount(ticket.original.token))
            ticket.observedReceipt = receipt
            lock.withLock { finishDeletionLocked(ticket, DeletionPhase.BLOCKED, receipt) }
        } catch (failure: Exception) {
            try {
                if (sent && failure is ApiException && failure.statusCode == 403 && failure.code == "RECENT_AUTH_REQUIRED") {
                    ticket.recentAuthRejected = true
                    restoreDeletionRejection(ticket)
                } else withContext(NonCancellable) { lock.withLock {
                    finishDeletionLocked(ticket, if (ticket.observedReceipt != null) DeletionPhase.BLOCKED else if (sent) DeletionPhase.UNKNOWN else DeletionPhase.ABORTED,
                        ticket.observedReceipt)
                } }
            } catch (_: Exception) {
                withContext(NonCancellable) { lock.withLock {
                    if (activeDeletion === ticket) {
                        val record = deletionRecord(ticket).let { r -> ticket.observedReceipt?.let { r.copy(phase = DeletionPhase.BLOCKED, receipt = it) } ?: if (ticket.recentAuthRejected) r.copy(phase = DeletionPhase.REAUTH_RESTORING) else r }
                        mutableDeletion.value = DeletionState(record, storageFailure = true)
                        publish(ShellAccess.RETRYABLE_FAILURE, storageFailure = true)
                    }
                } }
            }
        } finally {
            withContext(NonCancellable) { lock.withLock {
                ticket.dispatching = false
                if (activeDeletion === ticket) {
                    mutableDeletion.value = mutableDeletion.value.copy(busy = false)
                    if (!mutableDeletion.value.storageFailure && mutableDeletion.value.record?.cleanupPending == false) activeDeletion = null
                }
            } }
        }
    }
    private suspend fun finishDeletionLocked(ticket: DeletionTicket, phase: DeletionPhase, receipt: DeletionReceipt? = null) {
        val existing = deletionRecords.find { it.operationId == ticket.intent.operationId }
        if (activeDeletion !== ticket) {
            // Late A may upgrade only its own unknown record; never clean current B or downgrade ACK.
            if (receipt != null && existing?.phase == DeletionPhase.UNKNOWN) saveDeletionLocked(existing.copy(phase = DeletionPhase.BLOCKED, receipt = receipt))
            return
        }
        val record = deletionRecord(ticket).copy(phase = phase, receipt = receipt)
        saveDeletionLocked(record)
        val stamp = eraseDeletionOriginalLocked(record)
        val finished = record.copy(afterStamp = stamp, cleanupPending = false)
        saveDeletionLocked(finished)
        credential = null; loaded = true
        mutableDeletion.value = DeletionState(finished, busy = ticket.dispatching)
        // Installation is still fenced by activeDeletion until dispatch finally has exited.
        publish(ShellAccess.SIGNED_OUT)
    }
    private suspend fun restoreDeletionRejection(ticket: DeletionTicket) {
        val permitted = lock.withLock {
            if (activeDeletion !== ticket) return@withLock false
            val record = deletionRecord(ticket).copy(phase = DeletionPhase.REAUTH_RESTORING)
            saveDeletionLocked(record) // durable phase BEFORE credential.write removes the clear marker.
            if (!deletionCurrent(ticket) || !ticket.allowRestore || !ticket.original.expiresAt.isAfter(clock.instant()) ||
                credential != null || store.clearStamp() != record.afterStamp) return@withLock false
            withContext(NonCancellable) { store.write(ticket.original) }
            credential = ticket.original; loaded = true
            true
        }
        if (!permitted) { lock.withLock { finishDeletionLocked(ticket, DeletionPhase.REAUTH_DONE) }; return }
        try {
            // Session validation proves access only; it is NOT a lookup of deletion admission.
            val session = NativeDtos.session(api.get(ApiRoute.SESSION, ticket.original.token))
            lock.withLock {
                if (!deletionCurrent(ticket) || !ticket.allowRestore || credential?.token != ticket.original.token ||
                    !ticket.original.expiresAt.isAfter(clock.instant())) { finishDeletionLocked(ticket, DeletionPhase.REAUTH_DONE); return@withLock }
                require(session.account.id == ticket.intent.accountId && session.expiresAt.toEpochMilli() == ticket.original.expiresAt.toEpochMilli())
                val record = deletionRecord(ticket).copy(phase = DeletionPhase.REAUTH_DONE, cleanupPending = false)
                saveDeletionLocked(record)
                serverGeneration = session.serverGeneration; accountPartition = session.accountPartition
                mutableDeletion.value = DeletionState(record, busy = ticket.dispatching)
                publish(session.access, session.account)
            }
        } catch (_: Exception) { withContext(NonCancellable) { lock.withLock { finishDeletionLocked(ticket, DeletionPhase.REAUTH_DONE) } } }
    }
    override suspend fun retryDeletionCleanup(): Result<Unit> = outcome {
        lock.withLock {
            val ticket = activeDeletion
            if (ticket?.dispatching == true) throw DeletionInProgress()
            if (ticket != null) {
                val current = deletionRecord(ticket)
                val phase = when {
                    ticket.observedReceipt != null -> DeletionPhase.BLOCKED
                    ticket.recentAuthRejected -> DeletionPhase.REAUTH_DONE
                    current.phase == DeletionPhase.SENDING -> DeletionPhase.UNKNOWN
                    current.phase in setOf(DeletionPhase.PREPARING, DeletionPhase.CLEARED) -> DeletionPhase.ABORTED
                    current.phase == DeletionPhase.REAUTH_RESTORING -> DeletionPhase.REAUTH_DONE
                    else -> current.phase
                }
                finishDeletionLocked(ticket, phase, ticket.observedReceipt ?: current.receipt)
                activeDeletion = null
            } else { deletionStartupLocked(); if (credential == null) publish(ShellAccess.SIGNED_OUT) }
        }
    }
    override suspend fun resetDeletionData(intent: DeletionResetIntent): Result<Unit> = outcome {
        lock.withLock {
            if (!intent.matches(mutable.value, mutableDeletion.value)) throw CancellationException("stale_deletion_reset")
            if (activeDeletion?.dispatching == true) throw DeletionInProgress()
            try {
                activeDeletion?.allowRestore = false
                clearLocked()
                withContext(NonCancellable) { deletionStore?.erase() }
                activeDeletion = null; deletionRecords = emptyList(); deletionLoaded = true; mutableDeletion.value = DeletionState()
            } catch (failure: Exception) {
                mutableDeletion.value = mutableDeletion.value.copy(busy = false, storageFailure = true)
                publish(ShellAccess.RETRYABLE_FAILURE, storageFailure = true)
                throw failure
            }
        }
    }

    private suspend fun invalidateAuthLocked(problem: AuthProblem? = null) {
        authRevision++
        attempt?.dispatchActive?.set(false)
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
    override suspend fun password(input: PasswordInput, expected: SessionIdentity, termsVersion: String): Result<Unit> = outcome {
        val support = requireNotNull(auth)
        val ticket = lock.withLock {
            deletionStartupLocked(); require(activeDeletion == null && activeRoomCommand == null && loaded && !removalPending && expected.matches(mutable.value))
            if (input.changing) require(credential != null && mutable.value.account != null)
            else require(credential == null && mutable.value.access == ShellAccess.SIGNED_OUT)
            invalidateAuthLocked()
            val previous = mutable.value
            epoch++; publish(ShellAccess.RESTORING); purgeRoomsLocked(); mutable.value = previous.copy(generation = epoch)
            AuthAttempt(authRevision, epoch, support.createProof(), if (input.changing) AuthIntent.LINK else AuthIntent.LOGIN,
                clock.instant(), credential?.token, mutable.value.account?.id, serverGeneration, store.clearStamp()).also { attempt = it }
        }
        var returned: NativeCredential? = null
        var installed = false
        val job = currentCoroutineContext()[Job]
        try {
            val admission = AuthHttpAdmission(clock, ticket.createdAt.plusSeconds(60)) { ticket.dispatchActive.get() }
            val body = api.postAuthAdmitted(if (input.changing) ApiRoute.PASSWORD_CHANGE else ApiRoute.PASSWORD_LOGIN,
                ticket.token, input.body(), admission::claim)
            // Retain a valid issuance for best-effort revoke even if its nested session is rejected.
            val issued = StrictAuthJson.objectValue(body)
            fun issuedString(key: String): String = (issued.getValue(key) as kotlinx.serialization.json.JsonPrimitive).let { require(it.isString); it.content }
            require(issuedString("tokenType") == "Bearer")
            returned = NativeCredential(issuedString("accessToken"),Instant.parse(issuedString("expiresAt")))
            val response = support.contract.exchange(body)
            lock.withLock {
                if (!authCurrent(ticket) || job?.isActive == false || !clock.instant().isBefore(ticket.createdAt.plusSeconds(60))) throw CancellationException("session_changed")
                require(response.credential.token != ticket.token && response.credential.expiresAt.isAfter(clock.instant()) &&
                    !response.credential.expiresAt.isAfter(clock.instant().plusSeconds(604860)))
                if (input.changing) require(response.session.account.id == ticket.accountId)
                withContext(NonCancellable) {
                    publish(ShellAccess.RESTORING); purgeRoomsLocked()
                    try { store.write(response.credential) } catch (failure: Exception) { try { clearLocked() } catch (_: Exception) {}; throw failure }
                    if (job?.isActive == false) { clearLocked(); throw CancellationException("cancelled") }
                    credential = response.credential; loaded = true; removalPending = false; serverGeneration = response.session.serverGeneration
                    accountPartition = response.session.accountPartition; epoch++; profileRevision++; attempt = null; authRevision++
                    publish(response.session.access,response.session.account); installed = true
                }
            }
        } finally {
            if (!installed) { authFailure(ticket, AuthProblem.FAILED); returned?.let { revokeReturned(it.token,ticket.token) } }
        }
    }
    override suspend fun access(request: AccessRequest, expected: SessionIdentity): Result<String> = outcome {
        val ticket = lock.withLock {
            require(expected.matches(mutable.value) && mutable.value.account != null && activeDeletion == null && activeRoomCommand == null && attempt == null)
            val saved = requireNotNull(credential); require(saved.expiresAt.isAfter(clock.instant()))
            if (request.mutation) { withdrawRoomsLocked(); mutableRoomRefresh.value++ }
            Ticket(epoch,saved,expected.accountId,profileRevision)
        }
        val admit = { if (!current(ticket) || !ticket.credential.expiresAt.isAfter(clock.instant())) throw CancellationException("session_changed") }
        try {
            val result = api.access(request,ticket.credential.token,admit)
            lock.withLock {
                admit()
                if (request.path.startsWith("rooms/") && request.path.endsWith("/capabilities")) {
                    val root = chat.rogi.rogichat.core.auth.StrictAuthJson.objectValue(result)
                    val temporary = root["temporaryStreamer"] as? kotlinx.serialization.json.JsonObject
                    val expiry = (temporary?.get("expiresAt") as? kotlinx.serialization.json.JsonPrimitive)?.content?.let(Instant::parse)
                    grantExpiryJob?.cancel(); grantExpiryJob = null
                    if (expiry != null && expiry.isAfter(clock.instant())) grantExpiryJob = roomCommandScope.launch {
                        delay(java.time.Duration.between(clock.instant(),expiry).toMillis().coerceAtLeast(1))
                        val timer = currentCoroutineContext()[Job]
                        val valid = lock.withLock {
                            if (current(ticket) && grantExpiryJob === timer) {
                                // The follow-up read may replace the timer; it must not cancel this in-flight revalidation.
                                grantExpiryJob = null
                                withdrawRoomsLocked(); mutableRoomRefresh.value++; true
                            } else false
                        }
                        if (valid) { access(request,expected); refresh(retainAuthorized = true, expectedEpoch = ticket.epoch, expectedToken = ticket.credential.token) }
                    }
                }
            }
            result
        } catch (failure: Exception) {
            if (failure is ApiException && failure.statusCode == 401) lock.withLock { if (current(ticket)) clearLocked() }
            throw failure
        } finally {
            if (request.mutation) lock.withLock { if (current(ticket)) { withdrawRoomsLocked(); mutableRoomRefresh.value++ } }
        }
    }
    override suspend fun startLogin(termsVersion: String): Result<Unit> = beginAuthentication(AuthIntent.LOGIN)

    override suspend fun startAppleLogin(termsVersion: String): Result<Unit> = beginAuthentication(AuthIntent.LOGIN, AuthProvider.APPLE)

    private fun authProblem(provider: AuthProvider, code: String?, status: Int? = null): AuthProblem =
        if (provider == AuthProvider.APPLE && code == "APPLE_LINK_CONFLICT") AuthProblem.APPLE_CONFLICT
        else if (provider == AuthProvider.APPLE && (code == "AUTH_UNAVAILABLE" || status in setOf(404, 503))) AuthProblem.APPLE_UNAVAILABLE
        else SoopAuthContract.problem(code, status)

    private suspend fun beginAuthentication(intent: AuthIntent, provider: AuthProvider = AuthProvider.SOOP): Result<Unit> = outcome {
        val support = auth ?: throw IllegalStateException("operation_unavailable")
        val ticket = lock.withLock {
            deletionStartupLocked()
            if (activeDeletion != null) throw DeletionInProgress()
            require(loaded && !removalPending)
            if (intent == AuthIntent.LOGIN) require(mutable.value.access == ShellAccess.SIGNED_OUT && credential == null)
            else {
                require(mutable.value.access == ShellAccess.LINK_REQUIRED && mutable.value.account != null && credential != null)
                if (!requireNotNull(credential).expiresAt.isAfter(clock.instant())) { clearLocked(); return@outcome }
            }
            try { invalidateAuthLocked() }
            catch (failure: Exception) { mutableAuth.value = AuthUiState(error = AuthProblem.STORAGE); throw failure }
            val priorScope = mutable.value
            epoch++; publish(ShellAccess.RESTORING); purgeRoomsLocked()
            mutable.value = priorScope.copy(generation = epoch)
            val proof = support.createProof()
            val stamp = try { store.clearStamp() }
                catch (failure: Exception) { mutableAuth.value = AuthUiState(error = AuthProblem.STORAGE); throw failure }
            AuthAttempt(authRevision, epoch, proof, intent, clock.instant(), credential?.token,
                mutable.value.account?.id, serverGeneration, stamp, provider).also {
                attempt = it; mutableAuth.value = AuthUiState(AuthPhase.STARTING, expiresAt = it.createdAt.plusSeconds(600), provider = provider)
            }
        }
        try {
            val admission = AuthHttpAdmission(clock, ticket.createdAt.plusSeconds(600)) { ticket.dispatchActive.get() }
            val start = if (provider == AuthProvider.APPLE) {
                val contract = AppleIdentityContract(support.contract.environment)
                val response = contract.start(api.performAppleAdmitted(AppleIdentityRoute.START, IdentityIntent.valueOf(intent.name), ticket.token,
                    contract.startBody(IdentityIntent.valueOf(intent.name), ticket.proof), admission::claim))
                AuthStart(response.transactionId, response.authorizeUrl)
            } else support.contract.start(api.postAuthAdmitted(ApiRoute.SOOP_START, ticket.token, support.contract.startBody(intent, ticket.proof), admission::claim))
            lock.withLock {
                if (attempt !== ticket) return@withLock
                if (!authCurrent(ticket)) { invalidateAuthLocked(AuthProblem.SESSION_CHANGED); return@withLock }
                val record = PendingAuth(start.transactionId, intent, ticket.proof, ticket.createdAt,
                    ticket.token?.let(::fingerprint), ticket.accountId, ticket.serverGeneration, ticket.clearStamp, ticket.provider)
                if (!record.active(clock.instant()) || !clock.instant().isBefore(record.launchDeadline)) {
                    invalidateAuthLocked(AuthProblem.EXPIRED); return@withLock
                }
                withContext(NonCancellable) { support.pendingStore.write(record) }
                pending = record
                mutableAuth.value = AuthUiState(AuthPhase.AWAITING_BROWSER, expiresAt = record.expiresAt, provider = record.provider)
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
                is ApiException -> if (ticket.intent == AuthIntent.LOGIN && failure.statusCode == 401) AuthProblem.FAILED else authProblem(ticket.provider, failure.code, failure.statusCode)
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
            deletionStartupLocked()
            if (activeDeletion != null) throw DeletionInProgress()
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
                credential?.token, record.accountId, record.serverGeneration, record.clearStamp, record.provider)
            mutableAuth.value = AuthUiState(AuthPhase.AWAITING_BROWSER, expiresAt = record.expiresAt, provider = record.provider)
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
        restorePending().getOrThrow()
        // Provider comes only from encrypted pending proof, never an untrusted callback parameter.
        // Wrong-origin/path/duplicate/unknown/wrong-state callbacks leave the rightful proof intact.
        val callback = lock.withLock {
            val record = pending ?: return@outcome
            try {
                if (record.provider == AuthProvider.APPLE) {
                    val parsed = AppleIdentityContract(support.contract.environment).callback(url, record.proof.state)
                    AuthCallback(record.proof.state, parsed.code, if (parsed.failed) "AUTH_FAILED" else null)
                } else support.contract.callback(url)
            } catch (_: Exception) { return@outcome }
        }
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
                invalidateAuthLocked(authProblem(ticket.provider, callback.error))
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
            mutableAuth.value = AuthUiState(AuthPhase.EXCHANGING, expiresAt = deadline, provider = record.provider)
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
            val admission = AuthHttpAdmission(clock, deadline) { ticket.dispatchActive.get() }
            val response = if (record.provider == AuthProvider.APPLE) {
                val contract = AppleIdentityContract(support.contract.environment)
                contract.exchange(api.performAppleAdmitted(AppleIdentityRoute.EXCHANGE, IdentityIntent.valueOf(record.intent.name), ticket.token,
                    contract.exchangeBody(record.transactionId, requireNotNull(callback.code), record.proof), admission::claim))
            } else support.contract.exchange(api.postAuthAdmitted(ApiRoute.SOOP_EXCHANGE, ticket.token,
                support.contract.exchangeBody(record, requireNotNull(callback.code)), admission::claim))
            returned = response.credential
            lock.withLock {
                if (!authCurrent(ticket) || operationJob?.isActive == false || !clock.instant().isBefore(deadline)) return@withLock
                require(response.credential.token != ticket.token)
                require(response.credential.expiresAt.isAfter(clock.instant()))
                // Fixed seven-day issuance, with at most one minute of device/server clock skew.
                require(!response.credential.expiresAt.isAfter(clock.instant().plusSeconds(604_860)))
                if (ticket.intent == AuthIntent.LINK) require(response.session.account.id == ticket.accountId)
                withContext(NonCancellable) {
                    // Purge can fail. Complete it before installing the newly issued credential.
                    publish(ShellAccess.RESTORING); purgeRoomsLocked()
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
                    accountPartition = response.session.accountPartition
                    attempt = null; authRevision++; mutableAuth.value = AuthUiState()
                    publish(response.session.access, response.session.account)
                    installed = true
                }
            }
        } catch (cancelled: CancellationException) { authFailure(ticket, AuthProblem.LOST_RESPONSE); throw cancelled }
        catch (failure: Exception) {
            authFailure(ticket, when (failure) {
                is ApiException -> authProblem(ticket.provider, failure.code, failure.statusCode)
                is CredentialStoreException, is RoomsStorageException -> AuthProblem.STORAGE
                else -> AuthProblem.LOST_RESPONSE
            })
            if (ticket.intent == AuthIntent.LINK && failure is ApiException && failure.code == "LINK_SESSION_CHANGED") {
                refresh(retainAuthorized = true, expectedEpoch = ticket.epoch, expectedToken = ticket.token)
            }
            throw failure
        } finally {
            if (!installed) {
                try { authFailure(ticket, AuthProblem.LOST_RESPONSE) }
                finally { returned?.let { revokeReturned(it.token, ticket.token) } }
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
