package chat.rogi.rogichat.core.session

import android.content.Context
import chat.rogi.rogichat.core.auth.*
import java.security.SecureRandom
import java.io.ByteArrayOutputStream
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

internal fun androidCredentialStore(context: Context, environment: String): CredentialStore {
    val alias = "chat.rogi.rogichat.native.$environment.v1"
    val disk = AndroidCredentialDisk(File(context.noBackupFilesDir, "native-$environment"))
    return ProtectedCredentialStore(disk, CredentialCipher(environment) { create -> androidCredentialKey(alias, create) })
}

internal fun androidPendingAuthStore(context: Context, environment: String): PendingAuthStore {
    val alias = "chat.rogi.rogichat.native.$environment.soop-pending.v1"
    return ProtectedPendingAuthStore(AndroidCredentialDisk(File(context.noBackupFilesDir, "native-$environment-soop"), 4096, false),
        environment, { create -> androidCredentialKey(alias, create) })
}

internal fun androidAccountDeletionStore(context: Context, environment: String): chat.rogi.rogichat.core.deletion.AccountDeletionStore =
    chat.rogi.rogichat.core.deletion.ProtectedAccountDeletionStore(
        AndroidCredentialDisk(File(context.noBackupFilesDir, "native-$environment-account-deletion"), 16384, false), environment,
        { create -> androidCredentialKey("chat.rogi.rogichat.native.$environment.account-deletion.v1", create) })

internal fun androidCredentialKey(alias: String, create: Boolean): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = store.getKey(alias, null) as? SecretKey
    return existing ?: if (create) KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build())
    }.generateKey() else throw CredentialStoreException()
}

internal class AndroidCredentialDisk(directory: File, private val maximumBytes: Int = 80, private val exactSize: Boolean = true) : CredentialDisk {
    private val file = AtomicFile(File(directory, "credential"))
    private val marker = AtomicFile(File(directory, "cleared"))
    override fun read(): ByteArray? {
        if (!file.existsRecord()) return null
        return file.openRead().use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(512)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                require(output.size() + count <= maximumBytes)
                output.write(buffer, 0, count)
            }
            require(!exactSize || output.size() == maximumBytes)
            output.toByteArray()
        }
    }

    override fun write(value: ByteArray) = atomicWrite(file, value)
    override fun isCleared() = marker.existsRecord()
    override fun markCleared() = atomicWrite(marker, ByteArray(32).also(SecureRandom()::nextBytes))
    override fun clearStamp(): ByteArray? {
        if (!marker.existsRecord()) return null
        // Legacy one-byte markers remain valid; each subsequent clear creates a fresh durable stamp.
        return marker.openRead().use { input ->
            val bytes = ByteArray(33); val count = input.read(bytes)
            require(count in 1..32 && input.read() == -1)
            bytes.copyOf(count)
        }
    }
    override fun removeClearMarker() {
        marker.delete()
        check(!marker.existsRecord())
    }
    override fun erase() {
        file.delete()
        check(!file.existsRecord())
    }
    private fun atomicWrite(target: AtomicFile, bytes: ByteArray) {
        val stream = target.startWrite()
        try { stream.write(bytes); target.finishWrite(stream) }
        catch (failure: Exception) { target.failWrite(stream); throw failure }
    }
    private fun AtomicFile.existsRecord() = baseFile.exists() || File(baseFile.path + ".bak").exists() || File(baseFile.path + ".new").exists()
}
