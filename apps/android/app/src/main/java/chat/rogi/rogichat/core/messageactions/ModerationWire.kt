package chat.rogi.rogichat.core.messageactions

import chat.rogi.rogichat.core.auth.StrictAuthJson
import java.time.Instant
import kotlinx.serialization.json.*

enum class ReportReason(val wire: String, val label: String) {
    SPAM("spam", "스팸"), HARASSMENT("harassment", "괴롭힘"), SEXUAL("sexual", "성적인 내용"), VIOLENCE("violence", "폭력"), OTHER("other", "기타")
}
data class ReportReceipt(val reportId: String, val status: String, val createdAt: String)
/** Moderation v1 source contract; mount only alongside the corresponding deployed backend. */
object ModerationWire {
    fun mutation(record: ActionRecord): ActionRequest {
        val selected = record.selection
        return when (record.action) {
            MessageAction.REPORT -> ActionRequest("POST", "rooms/${selected.scope.roomId}/messages/${selected.messageId}/reports",
                buildJsonObject { put("idempotencyKey", record.id); put("reason", requireNotNull(record.reportReason).wire) }.toString(), 200)
            MessageAction.BLOCK_ACTOR -> {
                val actor = requireNotNull(selected.visibleActorId); actionId(actor)
                require(!selected.anonymous && actor != selected.scope.actorId)
                ActionRequest("PUT", "rooms/${selected.scope.roomId}/blocks/$actor", "{}", 200)
            }
            else -> error("not_moderation")
        }
    }
    fun recoverReport(record: ActionRecord): ActionRequest {
        require(record.action == MessageAction.REPORT); actionId(record.id)
        return ActionRequest("GET", "report-receipts/${record.id}", null, 200)
    }
    fun receipt(body: String): ReportReceipt {
        val root = StrictAuthJson.objectValue(body)
        require(root.keys == setOf("reportId", "status", "createdAt"))
        val id = root.text("reportId").also(::actionId); val status = root.text("status")
        require(status in setOf("received", "resolved", "dismissed"))
        val date = root.text("createdAt"); Instant.parse(date)
        return ReportReceipt(id, status, date)
    }
    fun blockReceipt(body: String): String {
        val root = StrictAuthJson.objectValue(body)
        require(root.keys == setOf("actorId", "blocked", "resetRequired"))
        listOf("blocked", "resetRequired").forEach { val v = root.getValue(it).jsonPrimitive; require(!v.isString && v.booleanOrNull == true) }
        return root.text("actorId").also(::actionId)
    }
    private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.let { require(it.isString); it.content }
}
