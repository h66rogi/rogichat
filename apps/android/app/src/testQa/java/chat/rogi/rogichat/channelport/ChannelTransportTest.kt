package chat.rogi.rogichat.channelport

import chat.rogi.rogichat.channelport.core.network.api.ApiClient
import chat.rogi.rogichat.core.session.CredentialStore
import chat.rogi.rogichat.core.session.NativeCredential
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ChannelTransportTest {
    private class Store(var value: NativeCredential? = null) : CredentialStore {
        var stamp = "0"
        override suspend fun read() = value
        override suspend fun write(credential: NativeCredential) { value = credential }
        override suspend fun clear() { value = null; stamp = "1" }
        override suspend fun clearStamp() = stamp
    }
    @Test fun publicReadOmitsBothNativeHeaders() = runTest {
        val api = ApiClient(Store(), HttpClient(MockEngine { request ->
            assertEquals("/v1/channel/h66rogi", request.url.encodedPath)
            assertNull(request.headers[HttpHeaders.Authorization])
            assertNull(request.headers["X-Rogi-Client"])
            respond("1")
        }))
        assertEquals(1, api.get<Int>("/v1/channel/h66rogi"))
    }
    @Test fun privateReadPairsBearerWithBoundClient() = runTest {
        val token = "t".repeat(43)
        val api = ApiClient(Store(NativeCredential(token, Instant.now().plusSeconds(600))), HttpClient(MockEngine { request ->
            assertEquals("Bearer $token", request.headers[HttpHeaders.Authorization])
            assertEquals("android", request.headers["X-Rogi-Client"])
            respond("1")
        }))
        assertEquals(1, api.get<Int>("/v1/user/me"))
    }
    @Test fun logoutDiscardsAnAlreadyDispatchedResponse() = runTest {
        val store = Store(NativeCredential("t".repeat(43), Instant.now().plusSeconds(600)))
        val api = ApiClient(store, HttpClient(MockEngine { store.clear(); respond("1") }))
        assertTrue(runCatching { api.get<Int>("/v1/user/me") }.isFailure)
    }
    @Test fun emptyConsoleResponseIsNullable() = runTest {
        val api = ApiClient(Store(), HttpClient(MockEngine { respond("") }))
        assertNull(api.getNullable<Int>("/v1/song-live/sessions/active"))
    }
}
