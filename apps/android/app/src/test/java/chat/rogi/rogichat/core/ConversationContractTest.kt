package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.conversation.*
import chat.rogi.rogichat.core.network.*
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import io.ktor.http.content.TextContent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

internal val CONVERSATION_ID = RoomId("00000000-0000-4000-8000-000000000001")
internal val MESSAGE_ID = RoomId("00000000-0000-4000-8000-000000000002")
internal val ACTOR_ID = RoomId("00000000-0000-4000-8000-000000000003")
internal val SCOPE_M = RoomScopeToken("A".repeat(43))
internal val SCOPE_A = RoomScopeToken("B".repeat(42) + "A")
internal fun messageProjection(id: RoomId = MESSAGE_ID, version: String = "7") = """{"id":"${id.value}","version":"$version","createdAt":"2026-09-20T00:00:00.000Z","audience":"SHARED","author":{"kind":"member","actorId":"${ACTOR_ID.value}","nickname":"이름","avatar":null},"content":{"type":"TEXT","text":"실제 본문"},"quote":null,"counterpart":null,"allowedActions":{"reply":true,"publish":false,"delete":false}}"""
internal fun snapshotProjection() = """{"schemaVersion":2,"resetRequired":false,"membershipScope":"${SCOPE_M.value}","authorizationRevision":"${SCOPE_A.value}","messages":[${messageProjection()}],"nextCursor":"events-one","historyCursor":null}"""
class ConversationContractTest {
    @Test fun initialProjectionKeepsReactionsAndQuotedAuthorThroughCache() {
        val source = messageProjection().replace("\"quote\":null", "\"quote\":{\"id\":\"${CONVERSATION_ID.value}\",\"authorName\":\"원문 작성자\",\"content\":{\"type\":\"TEXT\",\"text\":\"원문\"}}")
            .replace("\"counterpart\":null", "\"reactions\":{\"counts\":[{\"emoji\":\"👍\",\"count\":3}],\"mine\":\"👍\"},\"counterpart\":null")
        val message = ConversationDtos.message(source)
        assertEquals("원문 작성자", message.quote?.authorName)
        assertEquals(3L, message.reactions.counts.single().count)
        assertEquals("👍", message.reactions.mine)
        assertEquals(message, ConversationDtos.message(ConversationDtos.encode(message)))
    }
    @Test fun reactionSummarySurvivesConversationProjectionAndLocalEncoding() {
        val original = messageProjection().dropLast(1) + ",\"reactions\":{\"counts\":[{\"emoji\":\"👍\",\"count\":2}],\"mine\":\"👍\"}}"
        val message = ConversationDtos.message(original)
        assertEquals("👍", message.reactions.mine)
        assertEquals(2L, message.reactions.counts.single().count)
        assertEquals(message.reactions, ConversationDtos.message(ConversationDtos.encode(message)).reactions)
    }
    @Test fun roomOwnerCommandIsActorFreeAndRoundTripsThroughDurableOutbox() {
        val pending = ConversationDtos.message(messageProjection().replace("\"SHARED\"", "\"PRIVATE\"").replace("\"reply\":true", "\"reply\":false"))
        assertNull(pending.counterpart); assertNull(pending.replyTarget)
        val command = TextCommand(CONVERSATION_ID, SCOPE_M, "ROOM_OWNER", null, null, "방장에게")
        val body = command.body()
        assertFalse("recipientActorId" in body); assertFalse("quoteId" in body)
        val row = ConversationOutboxRow(CONVERSATION_ID.value, command.clientMessageId.value, SCOPE_M.value, SCOPE_A.value,
            command.intent, null, null, command.text, 1, OutboxPhase.UNKNOWN.name)
        assertEquals(command, row.domain().command)
        for ((recipient, quote) in listOf(ACTOR_ID to null, null to MESSAGE_ID)) {
            assertTrue(runCatching { TextCommand(CONVERSATION_ID, SCOPE_M, "ROOM_OWNER", recipient, quote, "본문") }.isFailure)
        }
        val media = chat.rogi.rogichat.core.media.MediaContent.Attachment(chat.rogi.rogichat.core.media.MediaKind.PHOTO,
            listOf(chat.rogi.rogichat.core.media.MediaReceipt(MESSAGE_ID.value, chat.rogi.rogichat.core.media.MediaStatus.ready)))
        assertFalse("recipientActorId" in TextCommand(CONVERSATION_ID, SCOPE_M, "ROOM_OWNER", null, null, "", media).body())
    }
    @Test fun c05RequiredHintsAndPrivateVersusSharedReplyTargetsAreExact() {
        val shared = ConversationDtos.message(messageProjection())
        assertEquals(ACTOR_ID, shared.replyTarget); assertNull(shared.counterpart)
        val privateMessage = ConversationDtos.message(messageProjection().replace("\"SHARED\"", "\"PRIVATE\"").replace("\"counterpart\":null", "\"counterpart\":{\"actorId\":\"${CONVERSATION_ID.value}\"}"))
        assertEquals(CONVERSATION_ID, privateMessage.replyTarget)
        for (key in listOf("counterpart", "allowedActions")) {
            val fields = Json.parseToJsonElement(messageProjection()).jsonObject.toMutableMap().apply { remove(key) }
            assertThrows(InvalidResponse::class.java) { ConversationDtos.message(JsonObject(fields).toString()) }
        }
        assertNull(ConversationDtos.message(messageProjection().replace("\"reply\":true", "\"reply\":false")).replyTarget)
        assertEquals(shared, ConversationDtos.message(ConversationDtos.encode(shared)))
    }
    @Test fun uint64VersionAndDisplayMillisecondsNeverUseSignedLongCounters() {
        assertTrue(MessageVersion("18446744073709551615") > MessageVersion("9223372036854775808"))
        for (bad in listOf("-1", "01", "1.0", "18446744073709551616")) assertThrows(IllegalArgumentException::class.java) { MessageVersion(bad) }
        assertEquals(Instant.parse("2026-09-20T00:00:00Z"), ConversationDtos.message(messageProjection()).createdAt)
        assertThrows(InvalidResponse::class.java) { ConversationDtos.message(messageProjection().replace("00.000Z", "00.000001Z")) }
    }
    @Test fun schemaTwoResetIsNullScopeAndEmptyDataAndSnapshotNeverAcceptsReset() {
        assertEquals(1, ConversationDtos.snapshot(snapshotProjection()).messages.size)
        assertThrows(InvalidResponse::class.java) { ConversationDtos.snapshot(snapshotProjection().replace("\"schemaVersion\":2", "\"schemaVersion\":1")) }
        val reset = """{"schemaVersion":2,"resetRequired":true,"membershipScope":null,"authorizationRevision":null,"events":[],"hasMore":false,"nextCursor":null}"""
        assertEquals(EventPage.Reset, ConversationDtos.events(reset))
        assertThrows(InvalidResponse::class.java) { ConversationDtos.events(reset.replace("\"membershipScope\":null", "\"membershipScope\":\"${SCOPE_M.value}\"")) }
        assertThrows(InvalidResponse::class.java) { ConversationDtos.snapshot(snapshotProjection().replace("\"resetRequired\":false", "\"resetRequired\":true")) }
    }
    @Test fun receiptShapesRemainDifferentAndDeletedContainsNoLookupMessageId() {
        val lookup = """{"clientMessageId":"${CONVERSATION_ID.value}","status":"deleted"}"""
        assertNull((ConversationDtos.receipt(lookup, true) as CommandReceipt.Deleted).messageId)
        val send = lookup.dropLast(1) + ",\"messageId\":\"${MESSAGE_ID.value}\"}"
        assertEquals(MESSAGE_ID, (ConversationDtos.receipt(send, false) as CommandReceipt.Deleted).messageId)
        assertThrows(InvalidResponse::class.java) { ConversationDtos.receipt(send, true) }
        assertThrows(InvalidResponse::class.java) { ConversationDtos.receipt(lookup, false) }
    }
    @Test fun textNormalizationPreservesContentAndUsesScalarUtf8AndEcmascriptBlankRules() {
        assertEquals(" é ", TextCommand.normalizeText(" e\u0301 "))
        assertEquals(4000, TextCommand.normalizeText("😀".repeat(4000)).codePointCount(0, 8000))
        for (value in listOf("\uFEFF\u00A0", "a\u0000", "a".repeat(4001), "\uD800")) assertTrue(runCatching { TextCommand.normalizeText(value) }.isFailure)
        val command = TextCommand(CONVERSATION_ID, SCOPE_M, "SHARED", null, null, "hello")
        val body = Json.parseToJsonElement(command.body()).jsonObject
        assertFalse("recipientActorId" in body); assertEquals(SCOPE_M.value, body["membershipScope"]!!.jsonPrimitive.content)
        assertFalse(command.toString().contains("hello"))
    }
    @Test fun closedTransportUsesBearerOnceAndSnapshotNeverCarriesCursor() = runTest {
        val requests = mutableListOf<io.ktor.client.request.HttpRequestData>()
        val client = ApiClient("https://api.qa.rogi.chat/v1/", MockEngine { request -> requests += request; respond(snapshotProjection(), HttpStatusCode.OK) })
        client.getConversation(TOKEN, CONVERSATION_ID, ConversationRoute.SNAPSHOT, ManifestRequest(MESSAGE_ID, ACTOR_ID))
        assertEquals("/v1/rooms/${CONVERSATION_ID.value}/snapshot", requests.single().url.encodedPath)
        assertNull(requests.single().url.parameters["cursor"]); assertEquals("20", requests.single().url.parameters["limit"])
        assertEquals("Bearer $TOKEN", requests.single().headers[HttpHeaders.Authorization]); assertEquals("android", requests.single().headers["X-Rogi-Client"])
        assertNull(requests.single().headers[HttpHeaders.Origin]); assertNull(requests.single().headers[HttpHeaders.Cookie])
        assertTrue(runCatching { client.getConversation(TOKEN, CONVERSATION_ID, ConversationRoute.SNAPSHOT, ManifestRequest(MESSAGE_ID, ACTOR_ID, SyncCursor("bad"))) }.isFailure)
        assertEquals(1, requests.size)
        client.sendText(TOKEN, CONVERSATION_ID, TextCommand(MESSAGE_ID, SCOPE_M, "SHARED", null, null, "hello"))
        assertEquals(HttpMethod.Post, requests.last().method); assertTrue((requests.last().body as TextContent).text.contains("membershipScope"))
        client.close()
    }
    @Test fun profileAbsentBirthdayIsRemovedAndRecipientListsRemainSeparate() {
        val profile = """{"schemaVersion":2,"resetRequired":false,"membershipScope":"${SCOPE_M.value}","authorizationRevision":"${SCOPE_A.value}","profiles":[{"actorId":"${ACTOR_ID.value}","nickname":"이름","avatar":null,"role":"MEMBER"}],"generation":"opaque","complete":true,"nextCursor":null}"""
        assertNull((ConversationDtos.profiles(profile) as ProfilePage.Success).profiles.single().birthday)
        assertThrows(InvalidResponse::class.java) { ConversationDtos.profiles(profile.replace("\"role\":\"MEMBER\"", "\"role\":\"MEMBER\",\"birthday\":null")) }
        assertEquals(emptyList<PrivateRecipient>(), ConversationDtos.recipients("""{"recipients":[],"next":null}""").recipients)
    }
}
