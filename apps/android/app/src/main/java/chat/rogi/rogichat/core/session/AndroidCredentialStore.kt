package chat.rogi.rogichat.core.session

import android.content.Context
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

internal fun androidCredentialKey(alias: String, create: Boolean): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = store.getKey(alias, null) as? SecretKey
    return existing ?: if (create) KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build())
    }.generateKey() else throw CredentialStoreException()
}

internal class AndroidCredentialDisk(directory: File) : CredentialDisk {
    private val file = AtomicFile(File(directory, "credential"))
    private val marker = AtomicFile(File(directory, "cleared"))
    override fun read(): ByteArray? {
        if (!file.existsRecord()) return null
        return file.openRead().use { input ->
            val bytes = ByteArray(80)
            var offset = 0
            while (offset < bytes.size) {
                val count = input.read(bytes, offset, bytes.size - offset)
                require(count > 0)
                offset += count
            }
            require(input.read() == -1)
            bytes
        }
    }
    override fun write(value: ByteArray) = atomicWrite(file, value)
    override fun isCleared() = marker.existsRecord()
    override fun markCleared() = atomicWrite(marker, byteArrayOf(1))
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
