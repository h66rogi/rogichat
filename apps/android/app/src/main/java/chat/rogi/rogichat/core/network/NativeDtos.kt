package chat.rogi.rogichat.core.network

import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.session.AccountSummary
import chat.rogi.rogichat.feature.settings.*
import java.time.Instant
import java.util.Base64
import kotlinx.serialization.json.*

data class NativeSessionProjection(val account: AccountSummary, val access: ShellAccess,
                                   val expiresAt: Instant, val serverGeneration: String)

/** Explicit DTO projections from committed backend native transport/profile contracts. */
object NativeDtos {
    private val json = Json { isLenient = false; coerceInputValues = false }
    fun session(text: String): NativeSessionProjection = decode {
        val root = json.parseToJsonElement(text).jsonObject
        require(root.bool("authenticated"))
        if ("accountPartition" in root) {
            val partition = root.string("accountPartition")
            require(partition.matches(Regex("[A-Za-z0-9_-]{43}")))
            val bytes = Base64.getUrlDecoder().decode(partition)
            require(bytes.size == 32 && Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == partition)
        }
        val own = root.getValue("account").jsonObject
        val linked = when (root.string("soopLinkStatus")) { "VERIFIED" -> true; "REQUIRED" -> false; else -> error("invalid") }
        require(root.string("onboardingState") == if (linked) "READY" else "SOOP_LINK_REQUIRED")
        require(root.getValue("capabilities").jsonObject.bool("chat") == linked)
        val generation = root.string("accountGeneration").also { require(it.matches(Regex("[A-Za-z0-9_-]{43}"))) }
        val account = AccountSummary(own.uuid("userId"), own.nickname(), null, linked, own.nullableUuid("avatarAssetId"))
        NativeSessionProjection(account, if (linked) ShellAccess.READY else ShellAccess.LINK_REQUIRED,
            Instant.parse(root.string("expiresAt")), generation)
    }
    fun profile(text: String): UserProfile = decode {
        val root = json.parseToJsonElement(text).jsonObject
        val birthday = when (val value = root.getValue("birthday")) {
            JsonNull -> null
            else -> value.jsonObject.let { Birthday(it.integer("month"), it.integer("day")) }
        }
        val avatar = when (val value = root.getValue("avatar")) { JsonNull -> null; else -> value.jsonObject.uuid("assetId") }
        UserProfile(root.uuid("id"), root.nickname(), birthday, root.bool("birthdayVisibleToStreamers"), avatar)
    }
    fun profilePatch(changes: ProfileChanges): String {
        val value = buildJsonObject {
            changes.nickname?.let { put("nickname", it) }
            when (val birthday = changes.birthday) {
                FieldChange.Unchanged -> Unit
                is FieldChange.Set -> put("birthday", birthday.value?.let { buildJsonObject { put("month", it.month); put("day", it.day) } } ?: JsonNull)
            }
            changes.birthdayVisibleToStreamers?.let { put("birthdayVisibleToStreamers", it) }
        }
        require(value.isNotEmpty())
        return value.toString()
    }
    private fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.let { require(it.isString); it.content }
    private fun JsonObject.bool(key: String): Boolean = getValue(key).jsonPrimitive.let { require(!it.isString); requireNotNull(it.booleanOrNull) }
    private fun JsonObject.integer(key: String): Int = getValue(key).jsonPrimitive.let { require(!it.isString); requireNotNull(it.intOrNull) }
    private fun JsonObject.uuid(key: String): String = string(key).also { require(it.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))) }
    private fun JsonObject.nullableUuid(key: String): String? = if (getValue(key) == JsonNull) null else uuid(key)
    private fun JsonObject.nickname(): String = string("nickname").also { value ->
        require(ProfileEditor(value).let { it.error == null && it.normalized == value })
        var index = 0
        while (index < value.length) {
            val char = value[index++]
            if (char.isHighSurrogate()) { require(index < value.length && value[index].isLowSurrogate()); index++ }
            else require(!char.isLowSurrogate())
        }
    }
    private inline fun <T> decode(block: () -> T): T = try { block() } catch (_: Exception) { throw InvalidResponse() }
}
