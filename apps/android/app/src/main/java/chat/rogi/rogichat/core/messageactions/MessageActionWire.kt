package chat.rogi.rogichat.core.messageactions

import chat.rogi.rogichat.core.auth.StrictAuthJson
import kotlinx.serialization.json.*

/** Relative v1 routes only; parent transports with the ORIGINAL admitted session credential.
 * No redirects, automatic mutation retries, cookie fallback or credential refresh. */
data class ActionRequest(val method: String, val path: String, val body: String?, val successStatus: Int)
data class ReactionCount(val emoji: String, val count: Long)
data class MessageReactions(val counts: List<ReactionCount>, val mine: String?)
object MessageActionWire {
    fun mutation(permit: ActionPermit): ActionRequest {
        val record = permit.record
        val path = "rooms/${record.selection.scope.roomId}/messages/${record.selection.messageId}"
        return when (record.action) {
            MessageAction.REPORT, MessageAction.BLOCK_ACTOR -> ModerationWire.mutation(record)
            MessageAction.SET_REACTION -> setReaction(record.selection, record.emoji)
            MessageAction.REMOVE_REACTION -> setReaction(record.selection, null)
            MessageAction.DELETE -> ActionRequest("POST", "$path/delete", "{}", 200)
            MessageAction.PUBLISH -> ActionRequest("POST", "$path/publications", "{}", 202)
        }
    }
    fun publication(scope: ActionScope, id: String): ActionRequest {
        actionId(id); return ActionRequest("GET", "rooms/${scope.roomId}/publications/$id", null, 200)
    }
    fun reactions(selection: ActionSelection) = ActionRequest("GET", "rooms/${selection.scope.roomId}/messages/${selection.messageId}/reactions", null, 200)
    /** Live-message readability is required; mutation always reauthorizes on the server. */
    fun setReaction(selection: ActionSelection, emoji: String?): ActionRequest {
        if (emoji != null) require(emoji.isNotBlank() && emoji.toByteArray(Charsets.UTF_8).size <= 64 && emoji.codePointCount(0, emoji.length) <= 32)
        val path = "rooms/${selection.scope.roomId}/messages/${selection.messageId}/reactions/me"
        return if (emoji == null) ActionRequest("DELETE", path, "{}", 200)
        else ActionRequest("PUT", path, buildJsonObject { put("emoji", emoji) }.toString(), 200)
    }
    fun result(action: MessageAction, status: Int, body: String): ActionResult = try {
        val root = StrictAuthJson.objectValue(body)
        when {
            action == MessageAction.REPORT && status == 200 -> ActionResult.Reported(ModerationWire.receipt(body))
            action == MessageAction.BLOCK_ACTOR && status == 200 -> ActionResult.ActorBlocked(ModerationWire.blockReceipt(body))
            action in setOf(MessageAction.SET_REACTION, MessageAction.REMOVE_REACTION) && status == 200 -> ActionResult.Reacted(reactionResult(body))
            action == MessageAction.DELETE && status == 200 -> {
                require(root.keys == setOf("requestId", "status") && root.text("status") == "blocked")
                val id = root.text("requestId")
                require(id.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")))
                ActionResult.Deleted(id)
            }
            action == MessageAction.PUBLISH && status == 202 -> publicationResult(body)
            else -> {
                require(root.keys == setOf("error"))
                val error = root.getValue("error").jsonObject
                require(error.keys == setOf("code"))
                val codes = mapOf(400 to setOf("INVALID_REQUEST", "BAD_REQUEST"), 401 to setOf("UNAUTHENTICATED"),
                    403 to setOf("FORBIDDEN", "SOOP_LINK_REQUIRED"), 404 to setOf("NOT_FOUND"),
                    413 to setOf("PAYLOAD_TOO_LARGE"), 429 to setOf("RATE_LIMITED", "BAD_REQUEST"))
                if (codes[status]?.contains(error.text("code")) == true) ActionResult.Rejected else ActionResult.Unknown
            }
        }
    } catch (_: Exception) { ActionResult.Unknown }
    fun publicationResult(body: String): ActionResult.Publication {
        val root = StrictAuthJson.objectValue(body)
        val status = when (root.text("status")) {
            "preparing" -> ActionPhase.PREPARING; "published" -> ActionPhase.PUBLISHED; "revoked" -> ActionPhase.REVOKED
            else -> error("invalid_publication")
        }
        require(root.keys == if (status == ActionPhase.PUBLISHED) setOf("publicationId", "status", "messageId") else setOf("publicationId", "status"))
        val id = root.text("publicationId").also(::actionId)
        val message = if (status == ActionPhase.PUBLISHED) root.text("messageId").also(::actionId) else null
        return ActionResult.Publication(id, status, message)
    }
    fun reactionResult(body: String): MessageReactions {
        val root = StrictAuthJson.objectValue(body)
        require(root.keys == setOf("counts", "mine"))
        val counts = root.getValue("counts").jsonArray.map {
            val item = it.jsonObject; require(item.keys == setOf("emoji", "count"))
            val count = item.getValue("count").jsonPrimitive
            require(!count.isString)
            ReactionCount(item.text("emoji"), requireNotNull(count.longOrNull).also { value -> require(value > 0) })
        }
        require(counts.map { it.emoji }.distinct().size == counts.size)
        return MessageReactions(counts, if (root.getValue("mine") == JsonNull) null else root.text("mine"))
    }
    private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.let { require(it.isString); it.content }
}
/** Mount onto the shared transport; claim at its final serialized admission, not before an await. */
interface MessageActionTransport { suspend fun execute(request: ActionRequest, permit: ActionPermit): ActionResult }
class MessageActionRunner(private val state: MessageActionState, private val transport: MessageActionTransport) {
    suspend fun execute(permit: ActionPermit): ActionEffect? {
        val result = try { transport.execute(MessageActionWire.mutation(permit), permit) }
        catch (_: Exception) { ActionResult.Unknown }
        return state.finish(permit, result)
    }
}
