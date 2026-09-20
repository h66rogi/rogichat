package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.auth.*
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.session.*
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Clock
import java.time.ZoneOffset

@OptIn(ExperimentalCoroutinesApi::class)
class AccountAccessTest {
    @Test fun expiryWithdrawsCachedAuthorityAndRequeriesServerWithoutMutation() = runTest {
        var reads = 0
        val clock = object : Clock() {
            override fun getZone() = ZoneOffset.UTC
            override fun withZone(zone: java.time.ZoneId): Clock = this
            override fun instant() = NOW.plusMillis(testScheduler.currentTime)
        }
        val api = object : NativeApi by TestApi() {
            override suspend fun access(request: AccessRequest, token: String, admission: () -> Unit): String {
                admission(); assertEquals("GET",request.method); reads++
                return if (reads == 1) """{"temporaryStreamer":{"grantId":"$OTHER","expiresAt":"${NOW.plusSeconds(60)}"}}""" else """{"temporaryStreamer":null}"""
            }
        }
        val db = RoomTestStore()
        val model = NativeSessionCoordinator(TestStore(),api,clock,roomsStore=db,roomCommandScope=backgroundScope)
        model.restore(); val prior = db.clears
        assertTrue(model.access(AccessRequest.room(OWN),SessionIdentity.from(model.session.value)).isSuccess)
        runCurrent(); advanceTimeBy(60000); runCurrent()
        assertEquals(2,reads); assertTrue(db.clears > prior); assertTrue(model.roomRefreshRequests.value > 0)
    }

    @Test fun closedRequestsEnforceNativeHeadersStatusesAndSelfOnlyGrantPayload() = runTest {
        val calls = mutableListOf<String>()
        val api = ApiClient("https://api.qa.rogi.chat/v1/",MockEngine { request ->
            calls += request.url.encodedPath
            assertEquals("android",request.headers["X-Rogi-Client"])
            assertEquals("Bearer $TOKEN",request.headers["Authorization"])
            assertNull(request.headers["Cookie"]); assertNull(request.headers["Origin"])
            when {
                request.url.encodedPath.endsWith("/revoke") -> respond("",HttpStatusCode.NoContent)
                request.method == HttpMethod.Post -> respond("{}",HttpStatusCode.Created,headersOf(HttpHeaders.ContentType,"application/json"))
                else -> respond("{}",HttpStatusCode.OK,headersOf(HttpHeaders.ContentType,"application/json"))
            }
        })
        val issue = AccessRequest.issue(OWN,OTHER,900,"기능 확인")
        val body = Json.parseToJsonElement(issue.body!!).jsonObject
        assertEquals(setOf("requestId","durationSeconds","reason"),body.keys)
        api.access(issue,TOKEN,{})
        api.access(AccessRequest.grants(OWN,OTHER),TOKEN,{})
        api.access(AccessRequest.revoke(OWN,OTHER,"확인 종료"),TOKEN,{})
        assertEquals(3,calls.size)
        assertThrows(IllegalArgumentException::class.java) { AccessRequest.issue(OWN,OTHER,3601,"확인") }
        assertThrows(IllegalArgumentException::class.java) { AccessRequest.revoke("../me",OTHER,"확인") }
        assertThrows(IllegalArgumentException::class.java) { AccessRequest.issue(OWN,OTHER,60,"\n") }
    }
    @Test fun staleCapabilityResponseCannotEnterAnotherSessionAndMutationIsNotRetried() = runTest {
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>(); var requests = 0
        val base = TestApi()
        val api = object : NativeApi by base {
            override suspend fun access(request: AccessRequest, token: String, admission: () -> Unit): String {
                admission(); requests++; entered.complete(Unit); release.await(); return "{}"
            }
        }
        val model = NativeSessionCoordinator(TestStore(),api,Clock.fixed(NOW,ZoneOffset.UTC))
        model.restore(); val identity = SessionIdentity.from(model.session.value)
        val pending = async { model.access(AccessRequest.issue(OWN,OTHER,60,"확인"),identity) }
        entered.await(); model.signOut(identity); release.complete(Unit)
        try { assertTrue(pending.await().isFailure) } catch (_: CancellationException) {}
        assertEquals(1,requests); assertNull(model.session.value.account)
        assertTrue(model.access(AccessRequest.me(),identity).isFailure)
        assertEquals(1,requests)
    }
}
