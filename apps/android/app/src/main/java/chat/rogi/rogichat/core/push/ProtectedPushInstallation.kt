package chat.rogi.rogichat.core.push

import android.content.Context
import chat.rogi.rogichat.core.auth.AuthProof
import chat.rogi.rogichat.core.auth.StrictAuthJson
import chat.rogi.rogichat.core.session.*
import java.io.File
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

/** Separate environment-private installation custody. Retained across account logout/rebind.
 * Never reuse login/deletion clear markers or persist the FCM token. */
class ProtectedPushInstallation(private val disk: CredentialDisk, environment: String, private val key: (Boolean) -> SecretKey) {
    private val aad = "chat.rogi.rogichat/native/android/$environment/push-installation/v1".toByteArray()
    init { require(environment in setOf("qa", "prod")) }
    suspend fun readOrCreate(): NativePushInstallation = withContext(Dispatchers.IO) {
        try {
            val stored = disk.read()
            if (stored != null) {
                require(stored.size in 30..1024 && stored[0] == 1.toByte())
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, stored.copyOfRange(1, 13))); cipher.updateAAD(aad)
                val bytes = cipher.doFinal(stored, 13, stored.size - 13)
                try {
                    val o = StrictAuthJson.objectValue(bytes.toString(Charsets.UTF_8)); require(o.keys == setOf("installationId", "bindingSecret"))
                    NativePushInstallation(o.getValue("installationId").jsonPrimitive.content, o.getValue("bindingSecret").jsonPrimitive.content)
                } finally { bytes.fill(0) }
            } else {
                val value = NativePushInstallation(UUID.randomUUID().toString(), AuthProof.create().verifier)
                val plain = buildJsonObject { put("installationId", value.installationId); put("bindingSecret", value.bindingSecret) }.toString().toByteArray()
                val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(true)); cipher.updateAAD(aad)
                try { disk.write(byteArrayOf(1) + cipher.iv + cipher.doFinal(plain)) } finally { plain.fill(0) }
                value
            }
        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (_: Exception) { throw CredentialStoreException() }
    }
}
internal fun androidPushInstallation(context: Context, environment: String) = ProtectedPushInstallation(
    AndroidCredentialDisk(File(context.noBackupFilesDir, "native-$environment-push-installation"), 1024, false), environment,
    { create -> androidCredentialKey("chat.rogi.rogichat.native.$environment.push-installation.v1", create) })
