package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.push.*
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.feature.settings.NotificationAccountScope
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import java.util.UUID
import javax.crypto.KeyGenerator
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PushCoordinatorTest {
    private fun installation(): ProtectedPushInstallation {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val disk = object : CredentialDisk {
            var bytes: ByteArray? = null
            override fun read() = bytes
            override fun write(value: ByteArray) { bytes = value }
            override fun isCleared() = false
            override fun markCleared() = Unit
            override fun removeClearMarker() = Unit
            override fun erase() { bytes = null }
        }
        return ProtectedPushInstallation(disk, "qa", { key })
    }
    private class Gateway(val api: NativeApi) : PushGateway {
        var beforeRequest: suspend () -> Unit = {}
        override suspend fun admitPush(account: NotificationAccountScope, installation: NativePushInstallation) =
            PushPermit(PushScope("qa", account.accountId, "server-generation", UUID.randomUUID(), UUID.fromString(installation.installationId)), account, Any()) {}
        override suspend fun <T> pushRequest(permit: PushPermit, request: suspend (NativeApi, String, () -> Unit) -> T): T {
            beforeRequest(); return request(api, TOKEN, permit::check)
        }
    }
    private val account = NotificationAccountScope(OWN, 1)
    private fun session() = MutableStateFlow(SessionSnapshot(ShellAccess.READY, AccountSummary(OWN, "계정", null, true), 1))
    private val provider = object : DevicePushProvider {
        override val available = true
        override suspend fun token() = DevicePushToken("isolated-test-device-token")
    }
    @Test fun oldPermissionCallbackCannotReplaceNewAccountPresentationOrCreateInstallation() = runTest {
        val current = MutableStateFlow(SessionSnapshot(ShellAccess.READY, AccountSummary(OTHER, "새 계정", null, true), 2))
        val api = object : NativeApi {
            override suspend fun get(route: ApiRoute, token: String): String = error("must not send")
            override suspend fun patch(route: ApiRoute, token: String, body: String): String = error("must not send")
            override suspend fun postWithoutResponse(route: ApiRoute, token: String, body: String) = error("must not send")
        }
        val model = NativePushCoordinator(Gateway(api), installation(), provider, { PushPermission.DENIED }, current, backgroundScope)
        model.connect(account); runCurrent()
        assertNull(model.state.value.account); assertNull(model.state.value.error)
    }
    @Test fun osRevokedWhileResolveWaitsPreventsRegisterAtActualHttpSend() = runTest {
        var permission = PushPermission.AUTHORIZED
        var register = 0
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val client = ApiClient("https://api.qa.rogi.chat/v1/", MockEngine { request -> when (request.url.encodedPath) {
            "/v1/me/native-push-capabilities" -> respond("""{"provider":"FCM","available":true}""", HttpStatusCode.OK)
            "/v1/me/native-push-subscriptions/resolve" -> { entered.complete(Unit); release.await(); respond("""{"binding":null}""", HttpStatusCode.OK) }
            "/v1/me/native-push-subscriptions" -> { register++; error("registration must not reach network") }
            else -> error("unexpected route")
        } })
        val model = NativePushCoordinator(Gateway(client), installation(), provider, { permission }, session(), backgroundScope)
        model.connect(account); entered.await(); permission = PushPermission.DENIED; release.complete(Unit)
        model.state.first { !it.busy && it.error != null }
        assertEquals(0, register); assertNotEquals(PushRegistrationState.REGISTERED, model.state.value.phase)
        client.close()
    }
    @Test fun osRevokedInOnQueuePreventsActualPutAndReconcilesWithGetOnly() = runTest {
        var permission = PushPermission.AUTHORIZED
        var put = 0; var reads = 0
        val client = ApiClient("https://api.qa.rogi.chat/v1/", MockEngine { request -> when (request.url.encodedPath) {
            "/v1/me/native-push-capabilities" -> respond("""{"provider":"FCM","available":true}""", HttpStatusCode.OK)
            "/v1/me/native-push-subscriptions/resolve" -> respond("""{"binding":null}""", HttpStatusCode.OK)
            "/v1/me/native-push-subscriptions" -> respond("""{"id":"$OTHER","generation":"1"}""", HttpStatusCode.Created)
            "/v1/me/notification-preferences" -> {
                if (request.method == HttpMethod.Put) put++ else reads++
                respond("""{"pushEnabled":false,"generation":"1"}""", HttpStatusCode.OK)
            }
            else -> error("unexpected route")
        } })
        val gateway = Gateway(client)
        val model = NativePushCoordinator(gateway, installation(), provider, { permission }, session(), backgroundScope)
        model.connect(account); model.state.first { it.phase == PushRegistrationState.REGISTERED && !it.busy }
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        gateway.beforeRequest = { gateway.beforeRequest = {}; entered.complete(Unit); release.await() }
        model.enable(account, PreferenceGeneration("1")); entered.await(); permission = PushPermission.DENIED; release.complete(Unit)
        model.state.first { !it.busy && it.error != null }
        assertEquals(0, put); assertEquals(2, reads); assertEquals(false, model.state.value.preferences?.pushEnabled)
        client.close()
    }
}
