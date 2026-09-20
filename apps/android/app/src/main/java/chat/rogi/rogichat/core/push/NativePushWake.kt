package chat.rogi.rogichat.core.push

/** FCM vendor data values are strings; never treat a push as a route or message. */
object NativePushWake {
    fun accepts(data: Map<String, String>): Boolean = data == mapOf("type" to "sync_required", "version" to "1")
}
