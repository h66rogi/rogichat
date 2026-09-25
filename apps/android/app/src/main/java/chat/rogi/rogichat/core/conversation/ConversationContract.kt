package chat.rogi.rogichat.core.conversation

import chat.rogi.rogichat.core.auth.StrictAuthJson
import chat.rogi.rogichat.core.media.*
import chat.rogi.rogichat.core.messageactions.MessageActionWire
import chat.rogi.rogichat.core.messageactions.MessageReactions
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.rooms.RoomsAccountScope
import chat.rogi.rogichat.feature.settings.ProfileEditor
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.text.Normalizer
import java.time.Instant
import kotlinx.serialization.json.*

/** Wire counters remain decimal strings; SQLite and display ordering never coerce them to Long. */
data class MessageVersion(val value: String) : Comparable<MessageVersion> {
    init { require(value.matches(Regex("0|[1-9][0-9]{0,19}"))); require(value.length < 20 || value <= "18446744073709551615") }
    override fun compareTo(other: MessageVersion) = value.length.compareTo(other.value.length).takeIf { it != 0 } ?: value.compareTo(other.value)
}
data class ConversationSelection(val account: RoomsAccountScope, val membership: Membership, val directoryCycle: RoomId)
data class ConversationScope(val selection: ConversationSelection, val cacheId: RoomId)
data class MessageActions(val reply: Boolean, val publish: Boolean, val delete: Boolean)
sealed interface MessageAuthor {
    data object Anonymous : MessageAuthor
    data class Member(val actorId: RoomId, val nickname: String, val avatarAssetId: RoomId?) : MessageAuthor
}
sealed interface MessageContent {
    data class Text(val text: String?) : MessageContent
    data class Media(val type: String, val attachments: List<Attachment>, val caption: String? = null) : MessageContent
    data class Sticker(val stickerId: RoomId, val assetId: RoomId, val width: Int, val height: Int) : MessageContent
}
data class Attachment(val assetId: RoomId, val width: Int, val height: Int, val variant: String)
data class MessageQuote(val id: RoomId, val text: String, val authorName: String = "사용자")
data class ConversationMessage(val id: RoomId, val version: MessageVersion, val createdAt: Instant,
                               val audience: String, val author: MessageAuthor, val content: MessageContent,
                               val quote: MessageQuote?, val counterpart: RoomId?, val actions: MessageActions,
                               val reactions: MessageReactions = MessageReactions(emptyList(), null)) {
    // C05 reply semantics differ by audience. Hints never bypass send authorization.
    val replyTarget: RoomId? get() = if (!actions.reply) null else when (audience) {
        "PRIVATE" -> counterpart
        "SHARED" -> (author as? MessageAuthor.Member)?.actorId
        else -> null
    }
}
sealed interface MessageEvent {
    data class Upsert(val message: ConversationMessage) : MessageEvent
    data class Deleted(val messageId: RoomId, val version: MessageVersion) : MessageEvent
}
data class SnapshotPage(val membership: RoomScopeToken, val authorization: RoomScopeToken,
                        val messages: List<ConversationMessage>, val next: SyncCursor, val history: SyncCursor?)
sealed interface EventPage {
    data object Reset : EventPage
    data class Success(val membership: RoomScopeToken, val authorization: RoomScopeToken,
                       val events: List<MessageEvent>, val hasMore: Boolean, val next: SyncCursor) : EventPage
}
sealed interface HistoryPage {
    data object Reset : HistoryPage
    data class Success(val membership: RoomScopeToken, val authorization: RoomScopeToken,
                       val messages: List<ConversationMessage>, val next: SyncCursor?) : HistoryPage
}
data class ActorBirthday(val month: Int, val day: Int) {
    init { require(month in 1..12 && day in 1..java.time.Month.of(month).length(true)) }
}
data class ConversationProfile(val actorId: RoomId, val nickname: String, val avatar: RoomId?, val role: RoomRole, val birthday: ActorBirthday?, val providerAvatarAvailable: Boolean = false)
sealed interface ProfilePage {
    data object Reset : ProfilePage
    data class Success(val membership: RoomScopeToken, val authorization: RoomScopeToken,
                       val profiles: List<ConversationProfile>, val generation: String, val complete: Boolean, val next: SyncCursor?) : ProfilePage
}
data class PrivateRecipient(val actorId: RoomId, val nickname: String, val avatar: RoomId?)
data class RecipientPage(val recipients: List<PrivateRecipient>, val next: RoomId?)
sealed interface CommandReceipt {
    val clientMessageId: RoomId
    data class Committed(override val clientMessageId: RoomId, val messageId: RoomId, val version: MessageVersion) : CommandReceipt
    // POST includes messageId. GET deliberately does not expose it for a deleted command.
    data class Deleted(override val clientMessageId: RoomId, val messageId: RoomId?) : CommandReceipt
}

/** Immutable normalized user command. It is never rebound to another membership or recipient. */
data class TextCommand(val clientMessageId: RoomId, val membership: RoomScopeToken, val intent: String,
                       val recipient: RoomId?, val quote: RoomId?, val text: String, val media: MediaContent? = null) {
    init {
        require(intent in setOf("SHARED", "PRIVATE", "ROOM_OWNER") && ((intent == "PRIVATE") == (recipient != null)))
        require(intent != "ROOM_OWNER" || quote == null)
        require(if (media == null) text == normalizeText(text) else text.isEmpty())
    }
    override fun toString() = "TextCommand([redacted])"
    fun body() = buildJsonObject {
        put("membershipScope", membership.value); put("clientMessageId", clientMessageId.value); put("intent", intent)
        recipient?.let { put("recipientActorId", it.value) }; quote?.let { put("quoteId", it.value) }
        put("content", media?.json() ?: buildJsonObject { put("type", "TEXT"); put("text", text) })
    }.toString()
    companion object {
        private val trimSet = setOf(9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279) + (8192..8202)
        fun normalizeText(value: String): String {
            val normalized = Normalizer.normalize(value, Normalizer.Form.NFC)
            require(normalized.trim { it.code in trimSet }.isNotEmpty() && '\u0000' !in normalized)
            require(normalized.codePointCount(0, normalized.length) <= 4000)
            val bytes = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(normalized))
            require(bytes.remaining() <= 16384)
            return normalized
        }
    }
}

/** C04+C05 live projection and C06 schema 2, with known fields validated and additive fields tolerated. */
object ConversationDtos {
    fun message(text: String): ConversationMessage = decode { message(StrictAuthJson.objectValue(text)) }
    fun snapshot(text: String): SnapshotPage = decode {
        val root = root(text); require(!root.flag("resetRequired"))
        SnapshotPage(root.scope("membershipScope"), root.scope("authorizationRevision"), root.messages(),
            SyncCursor(root.string("nextCursor")), root.cursor("historyCursor"))
    }
    fun events(text: String): EventPage = decode {
        val root = root(text); val values = root.list("events", 100)
        if (root.flag("resetRequired")) { root.resetScopes(); require(values.isEmpty() && !root.flag("hasMore")); root.nil("nextCursor"); EventPage.Reset }
        else {
            val events = values.map { element -> val event = element.jsonObject
                when (event.string("type")) {
                    "message.upsert" -> MessageEvent.Upsert(message(event.getValue("message").jsonObject))
                    "message.deleted" -> { require(event.keys == setOf("type", "messageId", "version")); MessageEvent.Deleted(event.id("messageId"), MessageVersion(event.string("version"))) }
                    else -> error("unsupported_event")
                }
            }
            EventPage.Success(root.scope("membershipScope"), root.scope("authorizationRevision"), events, root.flag("hasMore"), SyncCursor(root.string("nextCursor")))
        }
    }
    fun history(text: String): HistoryPage = decode {
        val root = root(text)
        if (root.flag("resetRequired")) { root.resetScopes(); require(root.list("messages", 100).isEmpty()); root.nil("nextCursor"); HistoryPage.Reset }
        else HistoryPage.Success(root.scope("membershipScope"), root.scope("authorizationRevision"), root.messages(), root.cursor("nextCursor"))
    }
    fun profiles(text: String): ProfilePage = decode {
        val root = root(text); val values = root.list("profiles", 100)
        if (root.flag("resetRequired")) {
            root.resetScopes(); require(values.isEmpty() && !root.flag("complete")); root.nil("generation"); root.nil("nextCursor"); ProfilePage.Reset
        } else {
            val profiles = values.map { element -> val value = element.jsonObject
                val birthday = value["birthday"]?.let { birth -> val fields = birth.jsonObject; ActorBirthday(fields.number("month"), fields.number("day")) }
                ConversationProfile(value.id("actorId"), value.nickname(), value.avatar(), RoomRole.valueOf(value.string("role")), birthday, if ("providerAvatarAvailable" in value) value.flag("providerAvatarAvailable") else false)
            }
            require(profiles.map { it.actorId }.distinct().size == profiles.size)
            val next = root.cursor("nextCursor"); val complete = root.flag("complete")
            require(complete == (next == null) && (complete || profiles.isNotEmpty()))
            ProfilePage.Success(root.scope("membershipScope"), root.scope("authorizationRevision"), profiles,
                root.string("generation").also { require(it.isNotEmpty() && it.length <= 4096) }, complete, next)
        }
    }
    fun recipients(text: String): RecipientPage = decode {
        val root = StrictAuthJson.objectValue(text)
        val values = root.list("recipients", 50).map { value -> val row = value.jsonObject; PrivateRecipient(row.id("actorId"), row.nickname(), row.avatar()) }
        require(values.map { it.actorId }.distinct().size == values.size)
        RecipientPage(values, root.optional("next")?.let(::RoomId)).also { page ->
            if (page.next != null) require(values.isNotEmpty() && values.last().actorId == page.next)
        }
    }
    fun receipt(text: String, fromLookup: Boolean): CommandReceipt = decode {
        val root = StrictAuthJson.objectValue(text); val client = root.id("clientMessageId")
        when (root.string("status")) {
            "committed" -> { require(root.keys == setOf("clientMessageId", "messageId", "status", "version")); CommandReceipt.Committed(client, root.id("messageId"), MessageVersion(root.string("version"))) }
            "deleted" -> {
                require(root.keys == if (fromLookup) setOf("clientMessageId", "status") else setOf("clientMessageId", "messageId", "status"))
                CommandReceipt.Deleted(client, if (fromLookup) null else root.id("messageId"))
            }
            else -> error("unknown_receipt")
        }
    }
    fun encode(message: ConversationMessage): String = buildJsonObject {
        put("id", message.id.value); put("version", message.version.value); put("createdAt", message.createdAt.toString()); put("audience", message.audience)
        put("counterpart", message.counterpart?.let { buildJsonObject { put("actorId", it.value) } } ?: JsonNull)
        put("allowedActions", buildJsonObject { put("reply", message.actions.reply); put("publish", message.actions.publish); put("delete", message.actions.delete) })
        put("author", when (val author = message.author) {
            MessageAuthor.Anonymous -> buildJsonObject { put("kind", "anonymous") }
            is MessageAuthor.Member -> buildJsonObject { put("kind", "member"); put("actorId", author.actorId.value); put("nickname", author.nickname); put("avatar", avatarJson(author.avatarAssetId)) }
        })
        put("content", when (val content = message.content) {
            is MessageContent.Text -> buildJsonObject { put("type", "TEXT"); put("text", content.text?.let(::JsonPrimitive) ?: JsonNull) }
            is MessageContent.Media -> buildJsonObject { put("type", content.type); put("attachments", buildJsonArray { content.attachments.forEach { attachment -> add(buildJsonObject {
                put("assetId", attachment.assetId.value); put("width", attachment.width); put("height", attachment.height); put("variant", attachment.variant)
            }) } }); content.caption?.let { put("caption", it) } }
            is MessageContent.Sticker -> buildJsonObject { put("type", "STICKER"); put("stickerId", content.stickerId.value); put("assetId", content.assetId.value); put("width", content.width); put("height", content.height) }
        })
        put("quote", message.quote?.let { buildJsonObject { put("id", it.id.value); put("authorName", it.authorName); put("content", buildJsonObject { put("type", "TEXT"); put("text", it.text) }) } } ?: JsonNull)
        put("reactions", buildJsonObject { put("mine", message.reactions.mine?.let(::JsonPrimitive) ?: JsonNull); put("counts", buildJsonArray {
            message.reactions.counts.forEach { count -> add(buildJsonObject { put("emoji", count.emoji); put("count", count.count) }) }
        }) })
    }.toString()
    private fun avatarJson(id: RoomId?): JsonElement = id?.let { buildJsonObject { put("assetId", it.value) } } ?: JsonNull
    private fun message(root: JsonObject): ConversationMessage {
        val created = Instant.parse(root.string("createdAt")).also { require(it.nano % 1_000_000 == 0) }
        val audience = root.string("audience").also { require(it in setOf("SHARED", "PRIVATE")) }
        val authorObject = root.getValue("author").jsonObject
        val author = when (authorObject.string("kind")) {
            "anonymous" -> { require(authorObject.keys == setOf("kind")); MessageAuthor.Anonymous }
            "member" -> MessageAuthor.Member(authorObject.id("actorId"), authorObject.nickname(), authorObject.avatar())
            else -> error("unknown_author")
        }
        val content = root.getValue("content").jsonObject
        val body = when (val type = content.string("type")) {
            "TEXT" -> MessageContent.Text(content.optional("text"))
            "PHOTO", "VIDEO" -> MessageContent.Media(type, content.list("attachments", if (type == "PHOTO") 4 else 1).map { item ->
                val attachment = item.jsonObject
                Attachment(attachment.id("assetId"), attachment.dimension("width"), attachment.dimension("height"), attachment.string("variant").also { require(it.isNotEmpty()) })
            }, content["caption"]?.jsonPrimitive?.let { require(it.isString); TextCommand.normalizeText(it.content) })
            "STICKER" -> MessageContent.Sticker(content.id("stickerId"), content.id("assetId"), content.dimension("width"), content.dimension("height"))
            else -> error("unsupported_content")
        }
        val quote = root.getValue("quote").takeUnless { it == JsonNull }?.jsonObject?.let {
            val quoted = it.getValue("content").jsonObject; require(quoted.string("type") == "TEXT"); MessageQuote(it.id("id"), quoted.string("text"), if ("authorName" in it) it.string("authorName") else "사용자")
        }
        val counterpart = root.getValue("counterpart").takeUnless { it == JsonNull }?.jsonObject?.id("actorId")
        val actions = root.getValue("allowedActions").jsonObject
        return ConversationMessage(root.id("id"), MessageVersion(root.string("version")), created, audience, author, body, quote,
            counterpart, MessageActions(actions.flag("reply"), actions.flag("publish"), actions.flag("delete")),
            root["reactions"]?.let { MessageActionWire.reactionResult(it.toString()) } ?: MessageReactions(emptyList(), null))
    }
    private fun root(text: String) = StrictAuthJson.objectValue(text).also {
        val version = it.getValue("schemaVersion").jsonPrimitive; require(!version.isString && version.intOrNull == 2)
    }
    private fun JsonObject.resetScopes() { nil("membershipScope"); nil("authorizationRevision") }
    private fun JsonObject.messages() = list("messages", 100).map { message(it.jsonObject) }.also { require(it.map { item -> item.id }.distinct().size == it.size) }
    private fun JsonObject.nil(key: String) { require(getValue(key) == JsonNull) }
    private fun JsonObject.string(key: String) = getValue(key).jsonPrimitive.let { require(it.isString); it.content }
    private fun JsonObject.optional(key: String) = if (getValue(key) == JsonNull) null else string(key)
    private fun JsonObject.flag(key: String) = getValue(key).jsonPrimitive.let { require(!it.isString); requireNotNull(it.booleanOrNull) }
    private fun JsonObject.number(key: String) = getValue(key).jsonPrimitive.let { require(!it.isString); requireNotNull(it.intOrNull) }
    private fun JsonObject.dimension(key: String) = number(key).also { require(it >= 0) }
    private fun JsonObject.id(key: String) = RoomId(string(key))
    private fun JsonObject.scope(key: String) = RoomScopeToken(string(key))
    private fun JsonObject.cursor(key: String) = optional(key)?.let(::SyncCursor)
    private fun JsonObject.list(key: String, limit: Int) = getValue(key).jsonArray.also { require(it.size <= limit) }
    private fun JsonObject.nickname() = string("nickname").also { require(ProfileEditor(it).error == null) }
    private fun JsonObject.avatar() = getValue("avatar").takeUnless { it == JsonNull }?.jsonObject?.id("assetId")
    private inline fun <T> decode(block: () -> T): T = try { block() } catch (_: Exception) { throw InvalidResponse() }
}
