package chat.rogi.rogichat.core.auth

import chat.rogi.rogichat.core.session.SessionIdentity
import kotlinx.serialization.json.*

/** Passwords exist only for this request, never in preferences or saved UI state. */
class PasswordInput(val loginId: String? = null, val password: String, val newPassword: String? = null) {
    val changing get() = newPassword != null
    init {
        require(validPassword(password))
        if (changing) { require(loginId == null); require(validPassword(requireNotNull(newPassword))) }
        else require(loginId != null && loginId.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{2,63}")))
    }
    fun body() = buildJsonObject {
        put("clientId", "android")
        if (changing) { put("currentPassword", password); put("newPassword", newPassword) }
        else { put("loginId", loginId); put("password", password); put("termsVersion", CURRENT_TERMS) }
    }.toString()
    override fun toString() = "PasswordInput([redacted])"
    companion object {
        fun validPassword(value: String): Boolean = value.codePointCount(0, value.length) >= 12 &&
            value.toByteArray(Charsets.UTF_8).size <= 256 && value.toByteArray(Charsets.UTF_8).toString(Charsets.UTF_8) == value &&
            value.none { it.code < 32 || it.code == 127 }
    }
}
interface AccountAccessActions {
    suspend fun password(input: PasswordInput, expected: SessionIdentity, termsVersion: String = CURRENT_TERMS): Result<Unit>
    suspend fun access(request: AccessRequest, expected: SessionIdentity): Result<String>
}
class AccessRequest private constructor(val method: String, val path: String, val body: String? = null, val status: Int = 200) {
    val mutation get() = method == "POST"
    companion object {
        private fun id(value: String): String { require(value.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))); return value }
        private fun reason(value: String): String { require(value.isNotBlank() && value.codePointCount(0,value.length) <= 200 && value.none { it.code < 32 || it.code == 127 }); return value }
        fun me() = AccessRequest("GET", "me/capabilities")
        fun rooms(after: String? = null) = AccessRequest("GET", "rooms" + (after?.let { "?after=" + id(it) } ?: ""))
        fun room(room: String) = AccessRequest("GET", "rooms/${id(room)}/capabilities")
        fun grants(room: String, after: String? = null) = AccessRequest("GET", "admin/rooms/${id(room)}/test-grants" + (after?.let { "?after="+id(it) } ?: ""))
        fun issue(room: String, request: String, seconds: Int, why: String): AccessRequest {
            require(seconds in 60..3600)
            return AccessRequest("POST", "admin/rooms/${id(room)}/test-grants", buildJsonObject {
                put("requestId",id(request)); put("durationSeconds",seconds); put("reason",reason(why))
            }.toString(),201)
        }
        fun revoke(room: String, grant: String, why: String) = AccessRequest("POST", "admin/rooms/${id(room)}/test-grants/${id(grant)}/revoke", buildJsonObject { put("reason",reason(why)) }.toString(),204)
    }
}
