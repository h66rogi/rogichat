package chat.rogi.rogichat.core.media

import java.net.URI
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*

/** Executed by the existing authenticated gateway under its original immutable permit.
 * It must guard admission, HTTP and commit, cancel on revocation, reject redirects, bound JSON
 * to 1 MiB, enforce expectedStatus and stream upload as exact application/octet-stream.
 * No API bearer may be forwarded to object storage. */
fun interface MediaTransport { suspend fun perform(request: MediaRequest, scope: MediaScope): String }
class MediaRequest internal constructor(val method: String, val path: String, val expectedStatus: Int,
                                       val jsonBody: String? = null, val upload: MediaFile? = null)
class MediaClient(private val transport: MediaTransport, val scope: MediaScope) {
    private suspend fun request(method: String, path: String, status: Int, body: String? = null, upload: MediaFile? = null): String {
        scope.check(); upload?.validate()
        val result = transport.perform(MediaRequest(method, path, status, body, upload), scope)
        scope.check(); require(result.toByteArray(Charsets.UTF_8).size <= 1_048_576)
        return result
    }
    private fun json(body: String) = body
    suspend fun reserve(file: MediaFile): MediaReceipt {
        require(file.kind != MediaKind.AVATAR || scope.roomId == null)
        file.validate()
        return MediaReceipt.decode(request("POST", "media/upload-intents", 201,
            json(MediaIntent(file.kind, file.contentType, file.byteLength, if (file.kind == MediaKind.AVATAR) null else scope.roomId).json())))
            .also { check(it.status == MediaStatus.reserved) }
    }
    suspend fun upload(assetId: String, file: MediaFile): MediaReceipt {
        mediaId(assetId); file.validate()
        return MediaReceipt.decode(request("POST", "media/upload-intents/$assetId/content", 202, upload = file))
            .also { check(it.assetId == assetId && it.status == MediaStatus.processing) }
    }
    suspend fun status(assetId: String): MediaReceipt = MediaReceipt.decode(request("GET", "media/upload-intents/${mediaId(assetId)}", 200))
        .also { check(it.assetId == assetId) }
    /** Bounded wait; a timeout leaves a recoverable asset ID, never invents success or reuploads. */
    suspend fun awaitReady(assetId: String, attempts: Int = 60): MediaReceipt {
        require(attempts in 1..120)
        repeat(attempts) { val receipt = status(assetId)
            when (receipt.status) { MediaStatus.ready -> return receipt
                MediaStatus.deleting, MediaStatus.deleted -> throw MediaUnavailable()
                else -> delay(2000) }
        }
        throw MediaProcessingTimeout()
    }
    suspend fun access(assetId: String, context: MediaAccess): MediaLease {
        val room = when (context) { is MediaAccess.Message -> context.roomId; is MediaAccess.Avatar -> context.roomId
            is MediaAccess.Sticker -> context.roomId; is MediaAccess.Preview -> null }
        require(room == null || room == scope.roomId)
        val started = System.nanoTime()
        val result = Json.parseToJsonElement(request("POST", "media/assets/${mediaId(assetId)}/access", 200, json(context.json()))).jsonObject
        check(result.getValue("expiresIn").jsonPrimitive.int == 60)
        val url = result.getValue("url").jsonPrimitive.content
        val uri = URI(url); require(uri.scheme == "https" && !uri.host.isNullOrEmpty() && uri.userInfo == null && uri.fragment == null)
        return MediaLease(url, started + 55_000_000_000L, context.variant)
    }
    suspend fun renewAccess(assetId: String, context: MediaAccess, replacing: MediaLease): MediaLease {
        replacing.checkedURL(scope)
        return kotlinx.coroutines.withTimeout(replacing.renewalBudgetMillis()) {
            access(assetId, context).also { it.checkedURL(scope) }
        }
    }
    suspend fun stickers(after: String? = null): MediaStickerPage {
        val room = mediaId(requireNotNull(scope.roomId))
        val path = "rooms/$room/stickers" + (after?.let { "?after=${mediaId(it)}" } ?: "")
        val o = Json.parseToJsonElement(request("GET", path, 200)).jsonObject
        val items = o.getValue("items").jsonArray.map { val s = it.jsonObject
            MediaSticker(s.getValue("id").jsonPrimitive.content, s.getValue("label").jsonPrimitive.content, s.getValue("assetId").jsonPrimitive.content) }
        val next = o.getValue("nextCursor").jsonPrimitive.contentOrNull?.let(::mediaId)
        return MediaStickerPage(items, next)
    }
    /** PATCH only the avatar field so concurrent nickname/birthday edits are not overwritten. */
    suspend fun updateAvatar(ready: MediaReceipt?) {
        require(scope.roomId == null)
        require(ready == null || ready.status == MediaStatus.ready)
        val raw = request("PATCH", "me/profile", 200, json(buildJsonObject { put("avatarAssetId", ready?.assetId?.let(::JsonPrimitive) ?: JsonNull) }.toString()))
        val result = Json.parseToJsonElement(raw).jsonObject
        mediaId(result.getValue("id").jsonPrimitive.content)
        val avatar = result.getValue("avatar")
        check(if (ready == null) avatar == JsonNull else avatar.jsonObject.getValue("assetId").jsonPrimitive.content == ready.assetId)
    }
}
