package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.network.*
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

internal val PARTITION = AccountPartition("A".repeat(43))
internal val MEMBERSHIP = RoomScopeToken("B".repeat(42) + "A")
internal val AUTHORIZATION = RoomScopeToken("C".repeat(42) + "A")
internal const val ROOM = "00000000-0000-4000-8000-000000000011"
internal const val ROOM_TWO = "00000000-0000-4000-8000-000000000012"
internal fun roomJson(id: String = ROOM) = """{"roomId":"$id","name":"실제 방","mode":"FAN","actorId":"$OWN","role":"FAN","membershipScope":"${MEMBERSHIP.value}","authorizationRevision":"${AUTHORIZATION.value}"}"""
internal fun manifestJson(rooms: String = roomJson(), generation: String = "one", complete: Boolean = true, next: String? = null) =
    """{"schemaVersion":2,"resetRequired":false,"rooms":[$rooms],"generation":"$generation","complete":$complete,"nextCursor":${next?.let { "\"$it\"" } ?: "null"}}"""
internal fun discoveryJson(rooms: String = """{"roomId":"$ROOM_TWO","name":"다른 방","mode":"GROUP","joined":false}""", next: String? = null) =
    """{"rooms":[$rooms],"next":${next?.let { "\"$it\"" } ?: "null"}}"""
internal val resetManifest = """{"schemaVersion":2,"resetRequired":true,"rooms":[],"generation":null,"complete":false,"nextCursor":null}"""
internal fun partitionProjection(partition: AccountPartition = PARTITION, generation: String = "g".repeat(43)) =
    projection(generation = generation).replace("\"authenticated\":true", "\"authenticated\":true,\"accountPartition\":\"${partition.value}\"")

class RoomContractTest {
    @Test fun sessionPreservesValidatedOptionalPartitionWithoutUserIdFallback() {
        assertEquals(PARTITION, NativeDtos.session(partitionProjection()).accountPartition)
        assertNull(NativeDtos.session(projection()).accountPartition)
        assertThrows(InvalidResponse::class.java) { NativeDtos.session(partitionProjection().replace(PARTITION.value, "B".repeat(43))) }
        assertThrows(IllegalArgumentException::class.java) { AccountPartition(OWN) }
        assertFalse(PARTITION.toString().contains(PARTITION.value))
    }
    @Test fun completeEmptyAndResetAreDifferentAndAllResetNullFieldsAreRequired() {
        assertEquals(MembershipPage.Reset, RoomDtos.manifest(resetManifest))
        assertEquals(emptyList<Membership>(), (RoomDtos.manifest(manifestJson(rooms = "")) as MembershipPage.Success).rooms)
        listOf(resetManifest.replace("\"generation\":null,", ""), resetManifest.replace("\"nextCursor\":null", "\"nextCursor\":\"null\""),
            resetManifest.replace("\"complete\":false", "\"complete\":true"), resetManifest.replace("\"rooms\":[]", "\"rooms\":[${roomJson()}]")).forEach {
            assertThrows(InvalidResponse::class.java) { RoomDtos.manifest(it) }
        }
    }
    @Test fun schemaOneUnknownAndQuotedVersionsAreRejected() {
        listOf("1", "3", "\"2\"", "2.5").forEach { value ->
            assertThrows(InvalidResponse::class.java) { RoomDtos.manifest(manifestJson().replace("\"schemaVersion\":2", "\"schemaVersion\":$value")) }
        }
    }
    @Test fun eachManifestRoomRequiresIndependentCanonicalScopesAndKnownRole() {
        val valid = RoomDtos.manifest(manifestJson()) as MembershipPage.Success
        assertEquals(MEMBERSHIP, valid.rooms.single().membershipScope)
        listOf(manifestJson().replace("\"membershipScope\":\"${MEMBERSHIP.value}\",", ""),
            manifestJson().replace(AUTHORIZATION.value, "X".repeat(43)), manifestJson().replace("\"role\":\"FAN\"", "\"role\":\"ADMIN\""),
            manifestJson().replace(ROOM, ROOM.uppercase().replace("00000000", "ABCDEF00"))).forEach {
            assertThrows(InvalidResponse::class.java) { RoomDtos.manifest(it) }
        }
    }
    @Test fun manifestIncompleteNeedsCursorAndItemsAndRejectsDuplicateIdsOrOverBound() {
        listOf(manifestJson(complete = false), manifestJson(next = "cursor"), manifestJson(rooms = "", complete = false, next = "cursor"),
            manifestJson(rooms = "${roomJson()},${roomJson()}"), manifestJson(rooms = List(101) { roomJson() }.joinToString(","))).forEach {
            assertThrows(InvalidResponse::class.java) { RoomDtos.manifest(it) }
        }
        assertFalse((RoomDtos.manifest(manifestJson(complete = false, next = "opaque")) as MembershipPage.Success).complete)
    }
    @Test fun discoveryUnjoinedMustOmitScopesAndJoinedMustHaveAllThree() {
        val unjoined = RoomDtos.discovery(discoveryJson()).rooms.single()
        assertNull(unjoined.actorId); assertNull(unjoined.membershipScope)
        val joined = roomJson().replace("\"role\":\"FAN\",", "\"joined\":true,")
        assertEquals(MEMBERSHIP, RoomDtos.discovery(discoveryJson(joined)).rooms.single().membershipScope)
        assertThrows(InvalidResponse::class.java) { RoomDtos.discovery(discoveryJson(joined.replace("\"joined\":true", "\"joined\":false"))) }
        assertThrows(InvalidResponse::class.java) { RoomDtos.discovery(discoveryJson().replace("\"joined\":false", "\"joined\":true")) }
        assertThrows(InvalidResponse::class.java) { RoomDtos.discovery(discoveryJson(next = ROOM)) }
    }
    @Test fun strictJsonDuplicateKeysMissingNextAndInvalidUuidFail() {
        assertThrows(InvalidResponse::class.java) { RoomDtos.discovery(discoveryJson().replace("\"next\":null", "\"next\":null,\"next\":null")) }
        assertThrows(InvalidResponse::class.java) { RoomDtos.discovery(discoveryJson().replace(",\"next\":null", "")) }
        assertThrows(IllegalArgumentException::class.java) { RoomId("../auth/session") }
        assertThrows(IllegalArgumentException::class.java) { SyncCursor("x".repeat(4097)) }
    }
    @Test fun closedTransportUsesExactNativeHeadersAndEncodedOpaqueQuery() = runTest {
        val requests = mutableListOf<io.ktor.client.request.HttpRequestData>()
        val api = ApiClient("https://api.qa.rogi.chat/v1/", MockEngine { request ->
            requests += request
            respond(if (request.url.encodedPath.endsWith("sync")) manifestJson() else discoveryJson(), HttpStatusCode.OK)
        })
        RoomsApi(api).discover(TOKEN, RoomId(ROOM))
        RoomsApi(api).manifest(TOKEN, ManifestRequest(RoomId(OWN), RoomId(OTHER), SyncCursor("a&cursor=other/+")))
        assertEquals("/v1/rooms", requests[0].url.encodedPath)
        assertEquals(ROOM, requests[0].url.parameters["after"])
        assertEquals("/v1/sync", requests[1].url.encodedPath)
        assertEquals("a&cursor=other/+", requests[1].url.parameters["cursor"])
        assertEquals(setOf("deviceId", "cacheId", "limit", "cursor"), requests[1].url.parameters.names())
        requests.forEach {
            assertEquals(HttpMethod.Get, it.method); assertEquals("api.qa.rogi.chat", it.url.host)
            assertEquals("Bearer $TOKEN", it.headers[HttpHeaders.Authorization]); assertEquals("android", it.headers["X-Rogi-Client"])
            assertNull(it.headers[HttpHeaders.Cookie]); assertNull(it.headers[HttpHeaders.Origin]); assertNull(it.headers["X-CSRF-Token"])
        }
        api.close()
    }
    @Test fun transportDoesNotTurn503Or401IntoEmptySuccess() = runTest {
        for (status in listOf(HttpStatusCode.ServiceUnavailable, HttpStatusCode.Unauthorized, HttpStatusCode.Found)) {
            var calls = 0
            val api = ApiClient("https://api.rogi.chat/v1/", MockEngine { calls++; respond("{}", status, headersOf(HttpHeaders.Location, "https://example.com")) })
            val failure = runCatching { RoomsApi(api).discover(TOKEN, null) }.exceptionOrNull()
            assertTrue(failure is ApiException); assertEquals(status.value, (failure as ApiException).statusCode); assertEquals(1, calls)
            api.close()
        }
    }
}
