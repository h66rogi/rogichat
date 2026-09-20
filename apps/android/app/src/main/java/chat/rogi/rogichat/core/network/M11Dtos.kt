package chat.rogi.rogichat.core.network

import chat.rogi.rogichat.core.auth.StrictAuthJson
import java.util.Base64
import kotlinx.serialization.json.*

/** Account preference CAS is unrelated to session, subscription or account generations. */
data class PreferenceGeneration(val value: String) {
    init {
        require(value.matches(Regex("[1-9][0-9]{0,19}")))
        require(value.length < 20 || value <= "18446744073709551615")
    }
}
data class NotificationPreferences(val pushEnabled: Boolean, val generation: PreferenceGeneration)
data class ReadStateId(val value: String) {
    init { require(value.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"))) }
}
data class ReadContext(val value: String) {
    init {
        require(value.matches(Regex("[A-Za-z0-9_-]{43}")))
        val bytes = Base64.getUrlDecoder().decode(value)
        require(bytes.size == 32 && Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == value)
    }
    override fun toString() = "ReadContext([redacted])"
}
data class OwnReadState(val messageId: ReadStateId?)
data class OwnReadStates(val readContext: ReadContext, val items: List<OwnReadState>)

/** Frozen M11 DTOs. Read state is own display progress, not unread counts or a sync cursor. */
object M11Dtos {
    fun preferences(text: String): NotificationPreferences = decode {
        val root = StrictAuthJson.objectValue(text)
        val enabled = root.getValue("pushEnabled").jsonPrimitive.let {
            require(!it.isString); requireNotNull(it.booleanOrNull)
        }
        NotificationPreferences(enabled, PreferenceGeneration(root.string("generation")))
    }
    fun disable(expected: PreferenceGeneration) = buildJsonObject {
        put("pushEnabled", false); put("expectedGeneration", expected.value)
    }.toString()
    fun readStates(text: String): OwnReadStates = decode {
        val root = StrictAuthJson.objectValue(text)
        val items = root.getValue("items").jsonArray
        require(items.size <= 100)
        OwnReadStates(ReadContext(root.string("readContext")), items.map { readItem(it.jsonObject) })
    }
    fun readState(text: String): OwnReadState = decode { readItem(StrictAuthJson.objectValue(text)) }
    fun displayed(messageId: ReadStateId, context: ReadContext) = buildJsonObject {
        put("messageId", messageId.value); put("readContext", context.value)
    }.toString()
    private fun readItem(root: JsonObject) = OwnReadState(
        if (root.getValue("messageId") == JsonNull) null else ReadStateId(root.string("messageId")))
    private fun JsonObject.string(key: String) = getValue(key).jsonPrimitive.let { require(it.isString); it.content }
    private inline fun <T> decode(block: () -> T): T = try { block() } catch (_: Exception) { throw InvalidResponse() }
}

/** Meloming NotificationApi's typed preference request/response wrapper, adapted to required CAS. */
class NotificationApi(private val api: NativeApi) {
    suspend fun getPreferences(token: String) = M11Dtos.preferences(api.get(ApiRoute.NOTIFICATION_PREFERENCES, token))
    suspend fun disablePush(token: String, expected: PreferenceGeneration): NotificationPreferences {
        val result = M11Dtos.preferences(api.put(ApiRoute.NOTIFICATION_PREFERENCES, token, M11Dtos.disable(expected)))
        if (result.pushEnabled) throw InvalidResponse()
        return result
    }
}

/** Transport foundation only. No product screen reports messages until C05/C06 supply display events. */
class ReadStateApi(private val api: NativeApi) {
    suspend fun get(token: String, room: ReadStateId) = M11Dtos.readStates(api.getReadState(room, token))
    suspend fun reportDisplayed(token: String, room: ReadStateId, message: ReadStateId, context: ReadContext) =
        M11Dtos.readState(api.putReadState(room, token, M11Dtos.displayed(message, context)))
}
