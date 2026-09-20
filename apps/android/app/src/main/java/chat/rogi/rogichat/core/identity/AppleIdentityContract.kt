package chat.rogi.rogichat.core.identity

import chat.rogi.rogichat.core.auth.AuthProof
import chat.rogi.rogichat.core.auth.StrictAuthJson
import chat.rogi.rogichat.core.auth.SoopAuthContract
import java.net.URI
import java.util.Base64
import kotlinx.serialization.json.*

enum class AppleIdentityRoute(val path: String) { START("auth/apple/start"), EXCHANGE("auth/apple/exchange") }
class AppleIdentityStart(val transactionId: String, val state: String, val nonce: String, val authorizeUrl: String) {
    override fun toString() = "AppleIdentityStart([redacted])"
}
class AppleIdentityCallback(val code: String?, val failed: Boolean) {
    override fun toString() = "AppleIdentityCallback([redacted])"
}
/** Real Apple DTO, no codeChallengeMethod field (SOOP start has a different contract). */
class AppleIdentityContract(private val environment: String) {
    init { require(environment == "qa" || environment == "prod") }
    fun startBody(intent: IdentityIntent, proof: AuthProof): String = buildJsonObject {
        put("clientId", "android"); put("intent", intent.name.lowercase())
        put("codeChallenge", proof.challenge); put("returnState", proof.state)
        if (intent == IdentityIntent.LOGIN) put("termsVersion", "2026-09-20")
    }.toString()
    fun start(text: String): AppleIdentityStart {
        val root = StrictAuthJson.objectValue(text)
        require(root.keys == setOf("transactionId", "state", "nonce", "authorizeUrl", "expiresIn"))
        require(root["expiresIn"] == JsonPrimitive(600))
        val id = root.string("transactionId"); require(uuid(id))
        val state = root.string("state"); val nonce = root.string("nonce")
        require(opaque(state) && opaque(nonce))
        val url = root.string("authorizeUrl"); val uri = URI(url)
        require(url.length <= 8192 && uri.scheme == "https" && uri.rawAuthority == "appleid.apple.com" &&
            uri.rawPath == "/auth/authorize" && uri.rawFragment == null)
        // Never allow a response with a substituted transaction state/nonce.
        val query = requireNotNull(uri.rawQuery).split('&').map {
            val pair = it.split('=', limit = 2); require(pair.size == 2)
            java.net.URLDecoder.decode(pair[0], "UTF-8") to java.net.URLDecoder.decode(pair[1], "UTF-8")
        }
        require(query.map { it.first }.distinct().size == query.size)
        require(query.toMap()["state"] == state && query.toMap()["nonce"] == nonce)
        return AppleIdentityStart(id, state, nonce, url)
    }
    fun callback(url: String, expectedReturnState: String): AppleIdentityCallback {
        require(opaque(expectedReturnState) && url.length <= 2048)
        val uri = URI(url)
        val host = if (environment == "qa") "qa.rogi.chat" else "rogi.chat"
        require(uri.scheme == "https" && uri.rawAuthority == host && uri.rawPath == "/mobile/auth/complete" && uri.rawFragment == null)
        val pairs = requireNotNull(uri.rawQuery).split('&').map {
            val pair = it.split('='); require(pair.size == 2 && pair.all { part -> part.matches(Regex("[A-Za-z0-9_-]+")) })
            pair[0] to pair[1]
        }
        require(pairs.size == 2 && pairs.map { it.first }.distinct().size == 2)
        val fields = pairs.toMap(); require(fields["state"] == expectedReturnState)
        return when {
            fields.keys == setOf("state", "code") -> AppleIdentityCallback(fields.getValue("code").also { require(opaque(it)) }, false)
            fields.keys == setOf("state", "error") && fields["error"] == "AUTH_FAILED" -> AppleIdentityCallback(null, true)
            else -> throw IllegalArgumentException("invalid_apple_callback")
        }
    }
    fun exchangeBody(transactionId: String, code: String, proof: AuthProof): String = buildJsonObject {
        require(uuid(transactionId) && opaque(code))
        put("clientId", "android"); put("transactionId", transactionId)
        put("code", code); put("codeVerifier", proof.verifier)
    }.toString()
    fun exchange(text: String) = SoopAuthContract(environment).exchange(text)
    private fun JsonObject.string(key: String) = getValue(key).jsonPrimitive.let { require(it.isString); it.content }
    private fun uuid(value: String) = value.matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"))
    private fun opaque(value: String): Boolean = value.matches(Regex("[A-Za-z0-9_-]{43}")) &&
        Base64.getUrlEncoder().withoutPadding().encodeToString(Base64.getUrlDecoder().decode(value)) == value
}
