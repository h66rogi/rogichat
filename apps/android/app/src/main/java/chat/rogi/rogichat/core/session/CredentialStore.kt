package chat.rogi.rogichat.core.session

import java.nio.ByteBuffer
import java.time.Instant
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext

class NativeCredential(val token: String, val expiresAt: Instant) {
    init { require(token.matches(Regex("[A-Za-z0-9_-]{43}"))); require(expiresAt.toEpochMilli() > 0) }
    override fun toString() = "NativeCredential([redacted])"
}
class CredentialStoreException : Exception("protected_storage_unavailable")
interface CredentialStore {
    suspend fun read(): NativeCredential?
    suspend fun write(credential: NativeCredential)
    suspend fun clear()
}
interface CredentialDisk {
    fun read(): ByteArray?
    fun write(value: ByteArray)
    fun isCleared(): Boolean
    fun markCleared()
    fun removeClearMarker()
    fun erase()
}

/** Meloming TokenStorage's protected persistence boundary, adapted to a single expiring native
 * credential. Platform Keystore replaces deprecated EncryptedSharedPreferences. A durable clear
 * marker prevents a failed erase from restoring an old login after process death.
 */
class ProtectedCredentialStore(private val disk: CredentialDisk, private val cipher: CredentialCipher,
                               private val io: CoroutineDispatcher = Dispatchers.IO) : CredentialStore {
    override suspend fun read(): NativeCredential? = guarded {
        if (disk.isCleared()) { disk.erase(); null } else disk.read()?.let(cipher::open)
    }
    override suspend fun write(credential: NativeCredential) = guarded {
        disk.write(cipher.seal(credential))
        disk.removeClearMarker()
    }
    override suspend fun clear() = guarded {
        disk.markCleared()
        disk.erase()
    }
    private suspend fun <T> guarded(block: () -> T): T = withContext(io) {
        try { block() } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { throw CredentialStoreException() }
    }
}

/** New authenticated envelope needed for Rogichat's exact environment and fixed expiry. */
class CredentialCipher(private val environment: String, private val key: (create: Boolean) -> SecretKey) {
    init { require(environment in setOf("qa", "prod")) }
    private val aad get() = "chat.rogi.rogichat/native/android/$environment/v1".toByteArray(Charsets.UTF_8)
    fun seal(value: NativeCredential): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(true))
        cipher.updateAAD(aad)
        val plain = ByteBuffer.allocate(51).putLong(value.expiresAt.toEpochMilli()).put(value.token.toByteArray(Charsets.US_ASCII)).array()
        return try { byteArrayOf(1) + cipher.iv + cipher.doFinal(plain) } finally { plain.fill(0) }
    }
    fun open(envelope: ByteArray): NativeCredential {
        require(envelope.size == 80 && envelope[0] == 1.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, envelope.copyOfRange(1, 13)))
        cipher.updateAAD(aad)
        val plain = cipher.doFinal(envelope, 13, envelope.size - 13)
        return try {
            val value = ByteBuffer.wrap(plain)
            val expires = Instant.ofEpochMilli(value.long)
            val token = ByteArray(43).also(value::get).toString(Charsets.US_ASCII)
            NativeCredential(token, expires)
        } finally { plain.fill(0) }
    }
}
