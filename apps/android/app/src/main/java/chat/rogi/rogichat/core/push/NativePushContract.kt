package chat.rogi.rogichat.core.push

import chat.rogi.rogichat.core.auth.StrictAuthJson
import java.util.Base64
import kotlinx.serialization.json.*

class NativePushInstallation(val installationId: String, val bindingSecret: String) {
    init { require(NativePushContract.uuid(installationId) && NativePushContract.opaque(bindingSecret)) }
    override fun toString() = "NativePushInstallation([redacted])"
}
data class NativePushGeneration(val value: String) {
    init { require(value.matches(Regex("[1-9][0-9]{0,19}")) && (value.length < 20 || value <= "18446744073709551615")) }
}
data class NativePushRegistration(val id: String, val generation: NativePushGeneration)
data class NativePushBinding(val id: String, val generation: NativePushGeneration, val revoked: Boolean)
object NativePushContract {
    internal fun uuid(value: String) = value.matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"))
    internal fun opaque(value: String) = value.matches(Regex("[A-Za-z0-9_-]{43}")) &&
        Base64.getUrlEncoder().withoutPadding().encodeToString(Base64.getUrlDecoder().decode(value)) == value
    fun register(installation: NativePushInstallation, token: DevicePushToken, generation: NativePushGeneration?): String = buildJsonObject {
        require(token.value.matches(Regex("[A-Za-z0-9_:.-]{16,4096}")))
        put("provider", "FCM"); put("token", token.value); put("installationId", installation.installationId)
        put("bindingSecret", installation.bindingSecret)
        generation?.let { put("generation", it.value) }
    }.toString()
    fun resolve(installation: NativePushInstallation): String = buildJsonObject {
        put("installationId", installation.installationId); put("bindingSecret", installation.bindingSecret)
    }.toString()
    fun remove(installation: NativePushInstallation, generation: NativePushGeneration): String = buildJsonObject {
        put("generation", generation.value); put("bindingSecret", installation.bindingSecret)
    }.toString()
    fun registration(text: String): NativePushRegistration {
        val root = StrictAuthJson.objectValue(text)
        val id = root.string("id").also { require(uuid(it)) }
        return NativePushRegistration(id, NativePushGeneration(root.string("generation")))
    }
    fun binding(text: String): NativePushBinding? {
        val body = StrictAuthJson.objectValue(text).getValue("binding")
        if (body == JsonNull) return null
        val root = body.jsonObject
        val id = root.string("id").also { require(uuid(it)) }
        return NativePushBinding(id, NativePushGeneration(root.string("generation")), root.boolean("revoked"))
    }
    fun available(text: String): Boolean {
        val root = StrictAuthJson.objectValue(text)
        require(root.string("provider") == "FCM")
        return root.boolean("available")
    }
    private fun JsonObject.string(key: String) = getValue(key).jsonPrimitive.let { require(it.isString); it.content }
    private fun JsonObject.boolean(key: String) = getValue(key).jsonPrimitive.let { require(!it.isString); requireNotNull(it.booleanOrNull) }
}
