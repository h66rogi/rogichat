package chat.rogi.rogichat.core.auth

import chat.rogi.rogichat.core.session.CredentialDisk
import chat.rogi.rogichat.core.session.CredentialStoreException
import java.time.Instant
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

enum class AuthProvider { SOOP, APPLE }
class PendingAuth(val transactionId: String, val intent: AuthIntent, val proof: AuthProof,
                  val createdAt: Instant, val credentialFingerprint: String?, val accountId: String?,
                  val serverGeneration: String?, val clearStamp: String?, val provider: AuthProvider = AuthProvider.SOOP) {
    val expiresAt: Instant get() = createdAt.plusSeconds(600)
    val launchDeadline: Instant get() = createdAt.plusSeconds(60)
    fun active(now: Instant) = !now.isBefore(createdAt) && now.isBefore(expiresAt)
    init {
        require(transactionId.matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")))
        require(createdAt.toEpochMilli() > 0)
        require(clearStamp == null || opaque(clearStamp))
        if (intent == AuthIntent.LOGIN) require(credentialFingerprint == null && accountId == null && serverGeneration == null)
        else {
            require(credentialFingerprint != null && opaque(credentialFingerprint))
            require(accountId != null && accountId.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")))
            require(serverGeneration != null && opaque(serverGeneration))
        }
    }
    override fun toString() = "PendingAuth([redacted])"
}
interface PendingAuthStore {
    suspend fun read(): PendingAuth?
    suspend fun write(value: PendingAuth)
    /** Must persist a tombstone before erasing bytes. Failure must prevent exchange. */
    suspend fun clear()
}

/** Meloming StoredMfaChallengeRecordCodec's expiring protected-record boundary, adapted to PKCE.
 * New encoding is needed for independent proof, same-account binding and durable one-shot consume.
 */
class ProtectedPendingAuthStore(private val disk: CredentialDisk, environment: String,
                                private val key: (Boolean) -> SecretKey,
                                private val io: CoroutineDispatcher = Dispatchers.IO) : PendingAuthStore {
    init { require(environment in setOf("qa", "prod")) }
    private val aad = "chat.rogi.rogichat/native/android/$environment/soop-pending/v1".toByteArray()
    override suspend fun read(): PendingAuth? = guarded {
        if (disk.isCleared()) { disk.erase(); null }
        else disk.read()?.let { bytes ->
            require(bytes.size in 30..4096 && bytes[0] == 1.toByte())
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
            cipher.updateAAD(aad)
            val plain = cipher.doFinal(bytes, 13, bytes.size - 13)
            try {
                val text = plain.toString(Charsets.UTF_8)
                if (StrictAuthJson.objectValue(text) == buildJsonObject { put("consumed", true) }) { disk.erase(); null }
                else decode(text)
            } finally { plain.fill(0) }
        }
    }
    private fun encrypt(text: String): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(true)); cipher.updateAAD(aad)
        val plain = text.toByteArray(Charsets.UTF_8)
        return try { byteArrayOf(1) + cipher.iv + cipher.doFinal(plain) } finally { plain.fill(0) }
    }
    override suspend fun write(value: PendingAuth) = guarded {
        disk.write(encrypt(encode(value))); disk.removeClearMarker()
    }
    override suspend fun clear() = guarded {
        try { disk.markCleared() }
        catch (_: Exception) {
            // Independent durable fallback if the small marker cannot be written. An authenticated
            // consumed record never restores proof; if both writes fail, report unconfirmed cancel.
            disk.write(encrypt("{\"consumed\":true}"))
        }
        disk.erase()
    }
    private suspend fun <T> guarded(block: () -> T): T = withContext(io) {
        try { block() } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { throw CredentialStoreException() }
    }
    private fun encode(value: PendingAuth) = buildJsonObject {
        if (value.provider != AuthProvider.SOOP) put("provider", value.provider.name)
        put("transactionId", value.transactionId); put("intent", value.intent.name)
        put("verifier", value.proof.verifier); put("state", value.proof.state); put("createdAt", value.createdAt.toString())
        put("credentialFingerprint", value.credentialFingerprint); put("accountId", value.accountId)
        put("serverGeneration", value.serverGeneration); put("clearStamp", value.clearStamp)
    }.toString()
    private fun decode(text: String): PendingAuth {
        val root = StrictAuthJson.objectValue(text)
        val keys = setOf("transactionId", "intent", "verifier", "state", "createdAt", "credentialFingerprint", "accountId", "serverGeneration", "clearStamp")
        require(root.keys == keys || root.keys == keys + "provider")
        fun optional(key: String) = if (root.getValue(key) == JsonNull) null else root.string(key)
        return PendingAuth(root.string("transactionId"), AuthIntent.valueOf(root.string("intent")),
            AuthProof(root.string("verifier"), root.string("state")), Instant.parse(root.string("createdAt")),
            optional("credentialFingerprint"), optional("accountId"), optional("serverGeneration"), optional("clearStamp"), if ("provider" in root) AuthProvider.valueOf(root.string("provider")) else AuthProvider.SOOP)
    }
}
