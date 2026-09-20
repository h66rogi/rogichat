package chat.rogi.rogichat.core.push

import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.session.SessionSnapshot
import chat.rogi.rogichat.feature.settings.NotificationAccountScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class PushPermit internal constructor(val scope: PushScope, val account: NotificationAccountScope,
                                     internal val handle: Any, private val validate: () -> Unit) {
    fun check() = validate()
}
interface PushGateway {
    suspend fun admitPush(account: NotificationAccountScope, installation: NativePushInstallation): PushPermit
    suspend fun <T> pushRequest(permit: PushPermit, request: suspend (NativeApi, String, () -> Unit) -> T): T
}
data class DevicePushState(val account: NotificationAccountScope? = null, val phase: PushRegistrationState = PushRegistrationState.INACTIVE,
                           val busy: Boolean = false, val preferences: NotificationPreferences? = null, val error: String? = null)
/** One enrollment at a time. CAS conflict/lost ACK only resolves and reads; no command replay. */
class NativePushCoordinator(private val gateway: PushGateway, private val installations: ProtectedPushInstallation,
                            private val provider: DevicePushProvider, private val permission: () -> PushPermission,
                            private val session: StateFlow<SessionSnapshot>, private val owner: CoroutineScope) {
    private val lock = Mutex()
    private val lifecycle = PushLifecycle()
    private val mutable = MutableStateFlow(DevicePushState())
    val state = mutable.asStateFlow()
    val providerAvailable get() = provider.available
    private var permit: PushPermit? = null
    private var installation: NativePushInstallation? = null
    private var binding: NativePushRegistration? = null
    init {
        owner.launch { session.map { it.account?.id to it.generation }.distinctUntilChanged().collect {
            lock.withLock {
                if (mutable.value.account?.let { scope -> scope.accountId != it.first || scope.localEpoch != it.second } == true) {
                    lifecycle.bind(null, PushPermission.UNKNOWN, false); permit = null; binding = null
                    mutable.value = DevicePushState()
                }
            }
        } }
    }
    private fun status(account: NotificationAccountScope, error: String? = null) {
        mutable.value = mutable.value.copy(account = account, phase = lifecycle.state, busy = false, error = error)
    }
    fun connect(account: NotificationAccountScope) { owner.launch { connectNow(account) } }
    private suspend fun connectNow(account: NotificationAccountScope) {
        if (!lock.tryLock()) return
        var request: PushTicket? = null
        try {
            val original = session.value
            if (original.account?.id != account.accountId || original.generation != account.localEpoch || original.access != chat.rogi.rogichat.core.navigation.ShellAccess.READY) return
            if (permission() != PushPermission.AUTHORIZED) {
                mutable.value = DevicePushState(account, error = "기기에서 알림을 허용한 뒤 연결해 주세요."); return
            }
            if (!provider.available) {
                mutable.value = DevicePushState(account, PushRegistrationState.UNAVAILABLE, error = "이 기기의 푸시 연결 설정을 사용할 수 없어요."); return
            }
            val custody = installations.readOrCreate()
            val admitted = gateway.admitPush(account, custody); admitted.check()
            mutable.value = DevicePushState(account, busy = true)
            val available = gateway.pushRequest(admitted) { api, token, gate ->
                NativePushContract.available(api.nativePushAdmitted(NativePushRoute.CAPABILITIES, token, null, gate))
            }
            lifecycle.bind(admitted.scope, permission(), available)
            if (!available) { status(account, "지금은 푸시 연결을 사용할 수 없어요."); return }
            val fetch = lifecycle.beginTokenFetch() ?: return; request = fetch
            val device = provider.token(); admitted.check()
            if (permission() != PushPermission.AUTHORIZED || !lifecycle.tokenReceived(fetch, device)) return
            val existing = gateway.pushRequest(admitted) { api, token, gate ->
                NativePushContract.binding(api.nativePushAdmitted(NativePushRoute.RESOLVE, token, NativePushContract.resolve(custody), gate))
            }
            val registered = gateway.pushRequest(admitted) { api, token, gate ->
                // Exactly one register for this explicit command; resolve supplies opaque generation.
                NativePushContract.registration(api.nativePushAdmitted(NativePushRoute.REGISTER, token,
                    NativePushContract.register(custody, requireNotNull(lifecycle.registrationToken(fetch)), existing?.generation), authorizedAdmission(gate)))
            }
            admitted.check(); check(permission() == PushPermission.AUTHORIZED)
            check(lifecycle.registered(fetch))
            permit = admitted; installation = custody; binding = registered
            val prefs = preferences(admitted)
            mutable.value = DevicePushState(account, PushRegistrationState.REGISTERED, preferences = prefs)
        } catch (cancelled: CancellationException) {
            request?.let(lifecycle::failed)
            if (mutable.value.account == account) mutable.value = DevicePushState()
            throw cancelled
        } catch (_: Exception) {
            request?.let(lifecycle::failed)
            // No replay. Any next explicit attempt first resolves the protected installation again.
            if (mutable.value.account == account) status(account, "푸시 연결 결과를 확인하지 못했어요. 다시 확인해 주세요.")
        } finally { if (mutable.value.account == account && mutable.value.busy) mutable.value = mutable.value.copy(busy = false); lock.unlock() }
    }
    private fun authorizedAdmission(original: () -> Unit): () -> Unit = {
        original()
        check(permission() == PushPermission.AUTHORIZED) { "notification_permission_changed" }
    }
    private suspend fun preferences(admitted: PushPermit) = gateway.pushRequest(admitted) { api, token, _ ->
        M11Dtos.preferences(api.get(ApiRoute.NOTIFICATION_PREFERENCES, token))
    }
    fun refresh(account: NotificationAccountScope) { owner.launch {
        lock.withLock {
            val admitted = permit?.takeIf { it.account == account } ?: return@withLock
            try {
                admitted.check()
                mutable.value = mutable.value.copy(preferences = preferences(admitted), error = null)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { mutable.value = mutable.value.copy(error = "계정 알림 설정을 확인하지 못했어요.") }
        }
    } }
    fun enable(account: NotificationAccountScope, expected: PreferenceGeneration) { owner.launch {
        lock.withLock {
            val admitted = permit?.takeIf { it.account == account } ?: return@withLock
            if (state.value.busy || state.value.phase != PushRegistrationState.REGISTERED || state.value.preferences?.generation != expected || state.value.preferences?.pushEnabled != false) return@withLock
            admitted.check(); if (permission() != PushPermission.AUTHORIZED) { status(account, "기기에서 알림을 먼저 허용해 주세요."); return@withLock }
            mutable.value = mutable.value.copy(busy = true, error = null)
            try {
                val actual = gateway.pushRequest(admitted) { api, token, gate ->
                    M11Dtos.preferences(api.putAdmitted(ApiRoute.NOTIFICATION_PREFERENCES, token,
                        buildJsonObject { put("pushEnabled", true); put("expectedGeneration", expected.value) }.toString(), authorizedAdmission(gate)))
                }
                check(actual.pushEnabled); mutable.value = mutable.value.copy(preferences = actual, busy = false)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                val actual = try { preferences(admitted) } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { null }
                mutable.value = mutable.value.copy(preferences = actual, busy = false,
                    error = "설정 변경 결과를 확인하지 못했어요. 표시된 현재 상태를 확인하고 다시 선택해 주세요.")
            } finally { if (mutable.value.account == account) mutable.value = mutable.value.copy(busy = false) }
        }
    } }
    fun disconnect(account: NotificationAccountScope) { owner.launch {
        lock.withLock {
            val admitted = permit?.takeIf { it.account == account } ?: return@withLock
            val custody = installation ?: return@withLock; val registered = binding ?: return@withLock
            mutable.value = mutable.value.copy(busy = true, error = null)
            try {
                gateway.pushRequest(admitted) { api, token, gate -> api.removePushAdmitted(registered.id, token, NativePushContract.remove(custody, registered.generation), gate) }
                lifecycle.bind(null, permission(), false); permit = null; binding = null
                mutable.value = DevicePushState(account, error = "이 기기의 푸시 연결을 해제했어요. 계정 전체 알림 설정은 유지돼요.")
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { status(account, "연결 해제 결과를 확인하지 못했어요. 다시 확인해 주세요.") }
            finally { if (mutable.value.account == account) mutable.value = mutable.value.copy(busy = false) }
        }
    } }
    fun tokenChanged() {
        // Only an explicitly enrolled current session may maintain its token. Never consume callback token directly.
        val current = mutable.value
        if (current.phase == PushRegistrationState.REGISTERED && !current.busy) current.account?.let(::connect)
    }
}
