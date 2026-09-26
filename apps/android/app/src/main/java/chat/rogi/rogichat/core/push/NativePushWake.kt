package chat.rogi.rogichat.core.push

/** Only opaque IDs are accepted; the tap must recheck current server authority. */
object NativePushWake {
    private val id = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
    fun target(data: Map<String, String>): Pair<String, String>? =
        if (data.keys == setOf("type", "version", "roomId", "messageId") &&
            data["type"] == "sync_required" && data["version"] == "1" &&
            id.matches(data["roomId"].orEmpty()) && id.matches(data["messageId"].orEmpty()))
            data.getValue("roomId") to data.getValue("messageId") else null
    fun accepts(data: Map<String, String>): Boolean = data == mapOf("type" to "sync_required", "version" to "1") || target(data) != null
}
