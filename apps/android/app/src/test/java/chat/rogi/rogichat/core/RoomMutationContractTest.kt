package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.network.*
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import io.ktor.http.content.TextContent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

internal fun joinJson(version: String = "1") = """{"actorId":"$OWN","historyPolicy":"SINCE_JOIN","policyVersion":$version,"membershipScope":"${MEMBERSHIP.value}","authorizationRevision":"${AUTHORIZATION.value}"}"""

class RoomMutationContractTest {
    @Test fun joinUsesLosslessUnsignedPolicyNumberAndCanonicalScope() {
        assertEquals(4_294_967_295L, RoomDtos.join(joinJson("4294967295")).policyVersion)
        assertEquals(0L, RoomDtos.join(joinJson("0")).policyVersion)
        for (invalid in listOf("-1", "4294967296", "1.0", "1e2", "\"1\"", "null"))
            assertThrows(InvalidResponse::class.java) { RoomDtos.join(joinJson(invalid)) }
        for (invalid in listOf(joinJson().replace("SINCE_JOIN", "UNKNOWN"), joinJson().replace(MEMBERSHIP.value, "A".repeat(42)),
            joinJson().replace("\"actorId\":\"$OWN\",", ""), joinJson().replace("\"policyVersion\":1", "\"policyVersion\":1,\"policyVersion\":2")))
            assertThrows(InvalidResponse::class.java) { RoomDtos.join(invalid) }
    }
    @Test fun nativePostsHaveExactBodyOriginAndStatusWithoutRetryOrRedirect() = runTest {
        val requests = mutableListOf<io.ktor.client.request.HttpRequestData>()
        val api = ApiClient("https://api.qa.rogi.chat/v1/", MockEngine {
            requests += it
            if (it.url.encodedPath.endsWith("join")) respond(joinJson(), HttpStatusCode.OK) else respond("", HttpStatusCode.NoContent)
        })
        RoomsApi(api).join(TOKEN, RoomId(ROOM)); RoomsApi(api).leave(TOKEN, RoomId(ROOM))
        assertEquals(listOf("/v1/rooms/$ROOM/join", "/v1/rooms/$ROOM/leave"), requests.map { it.url.encodedPath })
        requests.forEach {
            assertEquals(HttpMethod.Post, it.method); assertEquals("api.qa.rogi.chat", it.url.host)
            assertEquals("{}", (it.body as TextContent).text); assertEquals("Bearer $TOKEN", it.headers[HttpHeaders.Authorization])
            assertEquals("android", it.headers["X-Rogi-Client"]); assertNull(it.headers[HttpHeaders.Cookie])
            assertNull(it.headers[HttpHeaders.Origin]); assertNull(it.headers["X-CSRF-Token"])
        }
        api.close()
    }
    @Test fun leaveRequires204AndJoinRequires200AndFailuresAreNotReplayed() = runTest {
        for ((join, status, body) in listOf(Triple(true, HttpStatusCode.NoContent, ""), Triple(false, HttpStatusCode.OK, "{}"),
            Triple(false, HttpStatusCode.NoContent, "{}"), Triple(false, HttpStatusCode.NoContent, " "),
            Triple(false, HttpStatusCode.NoContent, "\n"), Triple(false, HttpStatusCode.Conflict, """{"error":{"code":"CONFLICT"}}"""),
            Triple(true, HttpStatusCode.ServiceUnavailable, "{}"), Triple(true, HttpStatusCode.Found, "{}"))) {
            var requests = 0
            val api = ApiClient("https://api.rogi.chat/v1/", MockEngine { requests++; respond(body, status, headersOf(HttpHeaders.Location, "https://example.com")) })
            assertTrue(runCatching { if (join) RoomsApi(api).join(TOKEN, RoomId(ROOM)) else RoomsApi(api).leave(TOKEN, RoomId(ROOM)) }.isFailure)
            assertEquals(1, requests); api.close()
        }
    }
}
