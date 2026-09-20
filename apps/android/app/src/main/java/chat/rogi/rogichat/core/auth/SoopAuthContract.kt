package chat.rogi.rogichat.core.auth

import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.session.NativeCredential
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64
import kotlinx.serialization.json.*

const val CURRENT_TERMS = "2026-09-20"
const val TERMS_CONSENT = "이용 안내를 확인했으며, 개인 메시지가 방장에 의해 전체 공개될 수 있음을 이해합니다. (2026-09-20)"
enum class AuthIntent { LOGIN, LINK }
enum class AuthPhase { IDLE, STARTING, AWAITING_BROWSER, EXCHANGING }
data class AuthUiState(val phase: AuthPhase = AuthPhase.IDLE, val error: AuthProblem? = null,
                       val expiresAt: Instant? = null, val provider: AuthProvider = AuthProvider.SOOP) {
    val active get() = phase != AuthPhase.IDLE
}
enum class AuthProblem(val message: String) {
    UNAVAILABLE("지금은 SOOP 로그인에 연결할 수 없어요. 잠시 후 다시 시도해 주세요."),
    APPLE_UNAVAILABLE("지금은 Apple 로그인에 연결할 수 없어요. 잠시 후 다시 시도해 주세요."),
    APPLE_CONFLICT("이 Apple 계정은 다른 로기챗 계정에 연결되어 있어요. 현재 계정은 변경하지 않았어요."),
    NETWORK("연결을 확인하고 새로 로그인을 시작해 주세요."),
    EXPIRED("로그인 시간이 만료되었어요. 새로 시작해 주세요."),
    FAILED("로그인을 완료하지 못했어요. 새로 시작해 주세요."),
    SESSION_CHANGED("로그인 상태가 바뀌어 계정 연결을 중단했어요. 현재 계정을 확인해 주세요."),
    RECENT_AUTH("계정을 연결하려면 다시 로그인이 필요해요. 로그아웃 후 다시 로그인해 주세요."),
    TERMS("새 이용 안내 확인이 필요해요. 로그아웃 후 이용 안내에 동의하고 다시 로그인해 주세요."),
    CONFLICT("이 SOOP 계정은 다른 로기챗 계정에 연결되어 있어요. 현재 계정은 변경하지 않았어요."),
    RATE_LIMITED("요청이 많아 잠시 기다려야 해요. 잠시 후 새로 시작해 주세요."),
    STORAGE("로그인 정보를 안전하게 저장하거나 지우지 못했어요. 다시 시도해 주세요."),
    CANCEL_UNCONFIRMED("로그인 취소를 완료하지 못했어요. 다시 취소해 주세요."),
    BROWSER("브라우저를 열지 못했어요. 사용할 수 있는 브라우저를 확인하고 다시 시도해 주세요."),
    LOST_RESPONSE("로그인 결과를 확인하지 못했어요. 안전하게 새로 로그인해 주세요.")
}
class AuthProof(val verifier: String, val state: String) {
    init { require(opaque(verifier)); require(opaque(state)); require(verifier != state) }
    val challenge: String get() = fingerprint(verifier)
    override fun toString() = "AuthProof([redacted])"
    companion object {
        fun create(): AuthProof {
            val random = SecureRandom()
            fun secret() = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also(random::nextBytes))
            return AuthProof(secret(), secret())
        }
    }
}
fun opaque(value: String) = value.matches(Regex("[A-Za-z0-9_-]{43}"))
fun fingerprint(value: String): String = Base64.getUrlEncoder().withoutPadding()
    .encodeToString(MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.US_ASCII)))
class BrowserLaunch(val state: String, val url: String) { override fun toString() = "BrowserLaunch([redacted])" }
class AuthCallback(val state: String, val code: String?, val error: String?) { override fun toString() = "AuthCallback([redacted])" }
class AuthStart(val transactionId: String, val authorizeUrl: String) { override fun toString() = "AuthStart([redacted])" }
class AuthExchange(val credential: NativeCredential, val session: NativeSessionProjection) { override fun toString() = "AuthExchange([redacted])" }

class SoopAuthContract(val environment: String) {
    init { require(environment in setOf("qa", "prod")) }
    val webOrigin = if (environment == "qa") "https://qa.rogi.chat" else "https://rogi.chat"
    private val apiOrigin = if (environment == "qa") "https://api.qa.rogi.chat" else "https://api.rogi.chat"
    val rulesUrl = "$webOrigin/rules"
    private val callbackErrors = setOf("NATIVE_CALLBACK_FAILED", "RECENT_AUTH_REQUIRED", "TERMS_REQUIRED", "LINK_SESSION_CHANGED", "SOOP_LINK_CONFLICT", "AUTH_UNAVAILABLE")
    fun authorize(url: String): String {
        val fields = query(url, apiOrigin, "/v1/auth/native/soop/launch")
        require(fields.keys == setOf("request") && opaque(fields.getValue("request")))
        return url
    }
    fun callback(url: String): AuthCallback {
        val fields = query(url, webOrigin, "/mobile/auth/complete")
        require(fields.keys == setOf("code", "state") || fields.keys == setOf("error", "state"))
        val state = fields.getValue("state").also { require(opaque(it)) }
        val code = fields["code"]?.also { require(opaque(it)) }
        val error = fields["error"]?.also { require(it in callbackErrors) }
        return AuthCallback(state, code, error)
    }
    private fun query(url: String, origin: String, path: String): Map<String, String> {
        require(url.length <= 2048)
        val uri = URI(url)
        require(uri.scheme == "https" && uri.rawAuthority == URI(origin).rawAuthority && uri.rawPath == path && uri.rawFragment == null)
        val pairs = requireNotNull(uri.rawQuery).split('&')
        val result = linkedMapOf<String, String>()
        pairs.forEach { pair ->
            val parts = pair.split('='); require(parts.size == 2 && parts[0] !in result)
            // Every contract field is unreserved ASCII; encoded aliases/duplicate grammar are unnecessary.
            require(parts.all { it.isNotEmpty() && it.all { c -> c.isLetterOrDigit() && c.code < 128 || c in "_-" } })
            result[parts[0]] = parts[1]
        }
        return result
    }
    fun startBody(intent: AuthIntent, proof: AuthProof): String = buildJsonObject {
        put("clientId", "android"); put("intent", intent.name.lowercase()); put("codeChallenge", proof.challenge)
        put("codeChallengeMethod", "S256"); put("returnState", proof.state)
        if (intent == AuthIntent.LOGIN) put("termsVersion", CURRENT_TERMS)
    }.toString()
    fun start(text: String): AuthStart = decode {
        val root = StrictAuthJson.objectValue(text)
        require(root.keys == setOf("transactionId", "authorizeUrl", "expiresIn"))
        val id = root.string("transactionId").also { require(it.matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"))) }
        require(root.getValue("expiresIn") == JsonPrimitive(600))
        AuthStart(id, authorize(root.string("authorizeUrl")))
    }
    fun exchangeBody(pending: PendingAuth, code: String): String = buildJsonObject {
        require(opaque(code)); put("clientId", "android"); put("transactionId", pending.transactionId)
        put("code", code); put("codeVerifier", pending.proof.verifier)
    }.toString()
    fun exchange(text: String): AuthExchange = decode {
        val root = StrictAuthJson.objectValue(text)
        require(root.keys == setOf("tokenType", "accessToken", "expiresAt", "session"))
        require(root.string("tokenType") == "Bearer")
        val sessionObject = root.getValue("session").jsonObject
        // Session projection is additive: validate known fields without granting unknown capabilities.
        val session = NativeDtos.session(sessionObject.toString())
        val expiry = Instant.parse(root.string("expiresAt")); require(expiry == session.expiresAt)
        AuthExchange(NativeCredential(root.string("accessToken"), expiry), session)
    }
    companion object {
        fun problem(code: String?, status: Int? = null): AuthProblem = when (code) {
            "LINK_SESSION_CHANGED", "UNAUTHENTICATED" -> AuthProblem.SESSION_CHANGED
            "TERMS_REQUIRED" -> AuthProblem.TERMS
            "RECENT_AUTH_REQUIRED" -> AuthProblem.RECENT_AUTH
            "SOOP_LINK_CONFLICT" -> AuthProblem.CONFLICT
            "AUTH_UNAVAILABLE" -> AuthProblem.UNAVAILABLE
            "RATE_LIMITED" -> AuthProblem.RATE_LIMITED
            else -> if (status == 404 || status == 503) AuthProblem.UNAVAILABLE else AuthProblem.FAILED
        }
    }
}
internal fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.let { require(it.isString); it.content }
private inline fun <T> decode(block: () -> T): T = try { block() } catch (_: Exception) { throw InvalidResponse() }

/** Reject duplicate object keys before JsonObject can collapse them, including escaped aliases. */
internal object StrictAuthJson {
    fun objectValue(text: String): JsonObject {
        require(text.length <= 1_048_576)
        var offset = 0
        fun whitespace() { while (offset < text.length && text[offset].isWhitespace()) offset++ }
        fun string(): String {
            whitespace(); val start = offset; require(text[offset++] == '"')
            while (offset < text.length) {
                val c = text[offset++]
                if (c == '\\') offset++ else if (c == '"') return Json.parseToJsonElement(text.substring(start, offset)).jsonPrimitive.content
            }
            error("invalid_json")
        }
        fun value(depth: Int) {
            require(depth < 32); whitespace()
            when (text[offset]) {
                '{' -> {
                    offset++; whitespace(); val keys = mutableSetOf<String>()
                    if (text[offset] == '}') { offset++; return }
                    while (true) {
                        require(keys.add(string())); whitespace(); require(text[offset++] == ':'); value(depth + 1); whitespace()
                        val next = text[offset++]; if (next == '}') break; require(next == ',')
                    }
                }
                '[' -> {
                    offset++; whitespace(); if (text[offset] == ']') { offset++; return }
                    while (true) { value(depth + 1); whitespace(); val next = text[offset++]; if (next == ']') break; require(next == ',') }
                }
                '"' -> string()
                else -> while (offset < text.length && text[offset] !in ",]} \r\n\t") offset++
            }
        }
        value(0); whitespace(); require(offset == text.length)
        return Json.parseToJsonElement(text).jsonObject
    }
}
