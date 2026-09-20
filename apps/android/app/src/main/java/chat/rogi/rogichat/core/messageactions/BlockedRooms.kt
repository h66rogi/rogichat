package chat.rogi.rogichat.core.messageactions

import chat.rogi.rogichat.core.auth.StrictAuthJson
import kotlinx.serialization.json.*

data class BlockedRoom(val id: String, val displayName: String?) {
    init { actionId(id) }
    val label get() = displayName ?: "이름을 확인할 수 없는 대화"
}
data class BlockedRoomPage(val rooms: List<BlockedRoom>, val next: String?)
object BlockedRoomsWire {
    private fun cursor(value: String): String { require(value.length in 1..2200 && value.matches(Regex("[A-Za-z0-9_.-]+"))); return value }
    fun request(next: String?) = ActionRequest("GET", "blocked-rooms", null, 200, next?.let { mapOf("cursor" to cursor(it)) }.orEmpty())
    fun page(body: String): BlockedRoomPage {
        val o = StrictAuthJson.objectValue(body); require(o.keys == setOf("rooms", "nextCursor"))
        fun text(e: JsonElement) = e.jsonPrimitive.let { require(it.isString); it.content }
        val rooms = o.getValue("rooms").jsonArray.map { raw ->
            val row = raw.jsonObject; require(row.keys == setOf("roomId", "displayName"))
            BlockedRoom(text(row.getValue("roomId")), row.getValue("displayName").let { if (it == JsonNull) null else text(it) })
        }
        require(rooms.size <= 50 && rooms.map { it.id }.distinct().size == rooms.size)
        return BlockedRoomPage(rooms, o.getValue("nextCursor").let { if (it == JsonNull) null else cursor(text(it)) })
    }
}
internal object UnblockCodec {
    fun encode(r: UnblockRecord) = buildJsonObject {
        put("id", r.id); put("sessionEpoch", r.scope.sessionEpoch); put("roomId", r.scope.roomId); put("viewEpoch", r.scope.viewEpoch)
        put("actorId", r.actorId); put("outcome", r.outcome.name); put("observedBlocked", r.observedBlocked)
    }.toString()
    fun decode(body: String, environment: String, account: String): UnblockRecord {
        val o = StrictAuthJson.objectValue(body)
        fun s(k: String) = o.getValue(k).jsonPrimitive.let { require(it.isString); it.content }
        val observed = o.getValue("observedBlocked").let { if (it == JsonNull) null else it.jsonPrimitive.let { v -> require(!v.isString); requireNotNull(v.booleanOrNull) } }
        return UnblockRecord(s("id"), BlockScope(environment, account, s("sessionEpoch"), s("roomId"), s("viewEpoch")), s("actorId"), UnblockOutcome.valueOf(s("outcome")), observed)
    }
}
internal class BlockJournalSlot : BlockJournal {
    private var value: BlockJournal? = null
    fun <T> transaction(journal: BlockJournal, operation: () -> T): T { check(value == null); value = journal; return try { operation() } finally { value = null } }
    override fun records() = requireNotNull(value).records()
    override fun put(record: UnblockRecord) = requireNotNull(value).put(record)
}
