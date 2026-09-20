package chat.rogi.rogichat.core.media

import java.io.File
import java.util.UUID
import kotlinx.serialization.json.*

/** Parent adapter captures the existing immutable account/ConversationScope, including epoch,
 * cache generation and original server M/A bindings. check must fail closed after invalidation. */
interface MediaScope {
    val presentationID: String
    val roomId: String?
    fun check()
}
fun mediaId(value: String): String { require(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}").matches(value)); UUID.fromString(value); return value }
enum class MediaKind(val maxBytes: Long, val types: Set<String>) {
    PHOTO(10L * 1024 * 1024, setOf("image/jpeg", "image/png", "image/webp")),
    VIDEO(50L * 1024 * 1024, setOf("video/mp4", "video/quicktime")),
    AVATAR(10L * 1024 * 1024, setOf("image/jpeg", "image/png", "image/webp"))
}
enum class MediaStatus { reserved, uploading, processing, ready, deleting, deleted }
data class MediaReceipt(val assetId: String, val status: MediaStatus) {
    init { mediaId(assetId) }
    companion object { fun decode(raw: String): MediaReceipt { val o = Json.parseToJsonElement(raw).jsonObject
        return MediaReceipt(o.getValue("assetId").jsonPrimitive.content, MediaStatus.valueOf(o.getValue("status").jsonPrimitive.content)) } }
}
class MediaFile(val file: File, val kind: MediaKind, val contentType: String) : AutoCloseable {
    val byteLength = file.length()
    init { require(file.isFile && byteLength in 1..kind.maxBytes && contentType in kind.types) }
    fun validate() { require(file.isFile && file.length() == byteLength) }
    override fun close() { file.delete() }
}
data class MediaIntent(val kind: MediaKind, val contentType: String, val byteLength: Long, val roomId: String?) {
    init { require(byteLength in 1..kind.maxBytes && contentType in kind.types)
        require((kind == MediaKind.AVATAR) == (roomId == null)); roomId?.let(::mediaId) }
    fun json() = buildJsonObject { put("kind", kind.name); put("contentType", contentType); put("byteLength", byteLength); roomId?.let { put("roomId", it) } }.toString()
}
/** Only content; existing room outbox owns the SEND envelope, intent and idempotency key. */
sealed interface MediaContent {
    fun json(): JsonObject
    class Attachment(val kind: MediaKind, receipts: List<MediaReceipt>) : MediaContent {
        val assetIds = receipts.map { it.assetId }
        init { require(kind != MediaKind.AVATAR && receipts.all { it.status == MediaStatus.ready })
            require(assetIds.size in 1..(if (kind == MediaKind.PHOTO) 4 else 1) && assetIds.distinct().size == assetIds.size) }
        override fun json() = buildJsonObject { put("type", kind.name); put("assetIds", JsonArray(assetIds.map(::JsonPrimitive))) }
    }
    class Sticker(val stickerId: String) : MediaContent {
        init { mediaId(stickerId) }
        override fun json() = buildJsonObject { put("type", "STICKER"); put("stickerId", stickerId) }
    }
}
enum class MediaVariant { image, video, poster }
sealed interface MediaAccess {
    val variant: MediaVariant
    fun json(): String
    data class Preview(override val variant: MediaVariant) : MediaAccess {
        override fun json() = buildJsonObject { put("variant", variant.name) }.toString()
    }
    data class Message(val roomId: String, val messageId: String, override val variant: MediaVariant) : MediaAccess {
        init { mediaId(roomId); mediaId(messageId) }
        override fun json() = buildJsonObject { put("roomId", roomId); put("messageId", messageId); put("variant", variant.name) }.toString()
    }
    data class Avatar(val roomId: String, val actorId: String) : MediaAccess {
        override val variant = MediaVariant.image
        init { mediaId(roomId); mediaId(actorId) }
        override fun json() = buildJsonObject { put("roomId", roomId); put("actorId", actorId); put("variant", variant.name) }.toString()
    }
    data class Sticker(val roomId: String, val stickerId: String, val messageId: String? = null) : MediaAccess {
        override val variant = MediaVariant.image
        init { mediaId(roomId); mediaId(stickerId); messageId?.let(::mediaId) }
        override fun json() = buildJsonObject { put("roomId", roomId); put("stickerId", stickerId); put("variant", variant.name); messageId?.let { put("messageId", it) } }.toString()
    }
}
data class MediaSticker(val id: String, val label: String, val assetId: String) { init { mediaId(id); mediaId(assetId) } }
data class MediaStickerPage(val items: List<MediaSticker>, val nextCursor: String?)
class MediaUnavailable : Exception("media_unavailable")
class MediaProcessingTimeout : Exception("media_processing")
class MediaFailure(val status: Int, val code: String?) : Exception("media_request_failed")
/** Deliberately not a data class: signed URLs must not appear in generated toString/logs. */
class MediaLease internal constructor(internal val url: String, private val expiresAtNanos: Long, val variant: MediaVariant) {
    fun renewalBudgetMillis(nowNanos: Long = System.nanoTime()): Long = minOf(5000, (expiresAtNanos - nowNanos) / 1_000_000).coerceAtLeast(0)
    fun needsRenewal(nowNanos: Long = System.nanoTime()): Boolean = nowNanos >= expiresAtNanos - 20_000_000_000L
    fun checkedURL(scope: MediaScope): String { scope.check(); check(System.nanoTime() < expiresAtNanos) { "media_access_expired" }; return url }
}

data class MediaPresentationIdentity(val scopeID: String, val assetId: String, val access: MediaAccess)
