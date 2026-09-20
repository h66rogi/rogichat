package chat.rogi.rogichat.core.deletion

import chat.rogi.rogichat.core.auth.StrictAuthJson
import chat.rogi.rogichat.core.auth.string
import chat.rogi.rogichat.core.session.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.*
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

private val uuid = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
private val receiptUuid = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
private fun proof(value: String): Boolean = try {
    value.length == 43 && java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(java.util.Base64.getUrlDecoder().decode(value)) == value && java.util.Base64.getUrlDecoder().decode(value).size == 32
} catch (_: Exception) { false }
data class DeletionIntent(val accountId: String, val epoch: Long, val operationId: String) {
    init { require(uuid.matches(operationId)); require(accountId.isNotBlank()) }
}
data class DeletionResetIntent(val session: SessionIdentity, val operationId: String?) {
    fun matches(snapshot: SessionSnapshot, state: DeletionState) = session.matches(snapshot) && operationId == state.record?.operationId
    companion object {
        fun from(snapshot: SessionSnapshot, state: DeletionState) = DeletionResetIntent(SessionIdentity.from(snapshot), state.record?.operationId)
    }
}
data class DeletionReceipt(val requestId: String) {
    init { require(receiptUuid.matches(requestId)) }
    override fun toString() = "DeletionReceipt([redacted])"
}
enum class DeletionPhase { PREPARING, CLEARED, SENDING, UNKNOWN, BLOCKED, REAUTH_RESTORING, REAUTH_DONE, ABORTED }
data class DeletionRecord(val operationId: String, val accountId: String, val fingerprint: String,
                          val beforeStamp: String?, val afterStamp: String? = null,
                          val phase: DeletionPhase = DeletionPhase.PREPARING,
                          val cleanupPending: Boolean = true, val receipt: DeletionReceipt? = null, val accountPartition: String? = null) {
    init {
        require(uuid.matches(operationId) && accountId.matches(Regex("[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}")) && proof(fingerprint))
        require(accountPartition == null || proof(accountPartition))
        require(beforeStamp == null || proof(beforeStamp)); require(afterStamp == null || proof(afterStamp))
        require((phase == DeletionPhase.BLOCKED) == (receipt != null))
        require(phase !in setOf(DeletionPhase.PREPARING, DeletionPhase.CLEARED, DeletionPhase.SENDING, DeletionPhase.REAUTH_RESTORING) || cleanupPending)
    }
    override fun toString() = "DeletionRecord([redacted])"
}
data class DeletionState(val record: DeletionRecord? = null, val busy: Boolean = false, val storageFailure: Boolean = false,
                         val capacityReached: Boolean = false) {
    val visible get() = record != null || storageFailure || capacityReached
    val blocksSession get() = busy || storageFailure || record?.cleanupPending == true
    fun presentedFor(accountId: String?, dismissedKey: String?): DeletionState {
        val sameAccount = accountId == null || record?.accountId == accountId
        val showRecord = sameAccount && (blocksSession || (record?.operationId != dismissedKey && !(capacityReached && dismissedKey == "capacity")))
        return copy(record = record.takeIf { showRecord }, capacityReached = capacityReached && dismissedKey != "capacity")
    }
}
interface AccountDeletionActions {
    val deletionState: StateFlow<DeletionState>
    suspend fun requestDeletion(intent: DeletionIntent): Result<Unit>
    suspend fun retryDeletionCleanup(): Result<Unit>
    /** Explicit local reset, never a server cancellation or receipt lookup. */
    suspend fun resetDeletionData(intent: DeletionResetIntent): Result<Unit>
}
class DeletionInProgress : Exception("account_deletion_in_progress")
class DeletionCapacityExceeded : Exception("local_deletion_record_limit")
class DeletionStorageException : Exception("deletion_storage_unavailable")
interface AccountDeletionStore {
    suspend fun read(): List<DeletionRecord>
    suspend fun write(records: List<DeletionRecord>)
    suspend fun erase()
}

/** New receipt/unknown journal. Reuses protected AtomicFile/Keystore primitives; auth formats stay v1. */
class ProtectedAccountDeletionStore(private val disk: CredentialDisk, environment: String,
                                   private val key: (Boolean) -> SecretKey,
                                   private val io: CoroutineDispatcher = Dispatchers.IO) : AccountDeletionStore {
    init { require(environment in setOf("qa", "prod")) }
    private val aad = "chat.rogi.rogichat/native/android/$environment/account-deletion/v1".toByteArray()
    override suspend fun read(): List<DeletionRecord> = guarded {
        val bytes = disk.read() ?: return@guarded emptyList()
        require(bytes.size in 30..16384 && bytes[0] == 1.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(1, 13))); cipher.updateAAD(aad)
        val plain = cipher.doFinal(bytes, 13, bytes.size - 13)
        try { DeletionJournalCodec.decode(Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(plain)).toString()) }
        finally { plain.fill(0) }
    }
    override suspend fun write(records: List<DeletionRecord>) = guarded {
        val plain = DeletionJournalCodec.encode(records).toByteArray(Charsets.UTF_8)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(true)); cipher.updateAAD(aad)
            val bytes = byteArrayOf(1) + cipher.iv + cipher.doFinal(plain)
            require(bytes.size <= 16384); disk.write(bytes)
        } finally { plain.fill(0) }
    }
    override suspend fun erase() = guarded { disk.erase() }
    private suspend fun <T> guarded(block: () -> T): T = withContext(io) {
        try { block() } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { throw DeletionStorageException() }
    }
}
object DeletionJournalCodec {
    private val keys = setOf("operationId", "accountId", "fingerprint", "beforeStamp", "afterStamp", "phase", "cleanupPending", "receipt", "accountPartition")
    private fun validate(records: List<DeletionRecord>) {
        require(records.size <= 16 && records.map { it.operationId }.toSet().size == records.size)
        require(records.count { it.cleanupPending } <= 1)
    }
    fun encode(records: List<DeletionRecord>): String {
        validate(records)
        return buildJsonObject {
            put("version", 1); putJsonArray("records") { records.forEach { r -> add(buildJsonObject {
                put("operationId", r.operationId); put("accountId", r.accountId); put("fingerprint", r.fingerprint)
                put("beforeStamp", r.beforeStamp); put("afterStamp", r.afterStamp); put("phase", r.phase.name)
                put("cleanupPending", r.cleanupPending); put("receipt", r.receipt?.requestId); put("accountPartition", r.accountPartition)
            }) } }
        }.toString()
    }
    fun decode(text: String): List<DeletionRecord> {
        val root = StrictAuthJson.objectValue(text)
        require(root.keys == setOf("version", "records") && root["version"] == JsonPrimitive(1))
        return root.getValue("records").jsonArray.map { value ->
            val r = value.jsonObject; require(r.keys == keys)
            fun optional(key: String) = if (r.getValue(key) == JsonNull) null else r.string(key)
            val cleanup = r.getValue("cleanupPending").jsonPrimitive
            require(!cleanup.isString)
            DeletionRecord(r.string("operationId"), r.string("accountId"), r.string("fingerprint"), optional("beforeStamp"),
                optional("afterStamp"), DeletionPhase.valueOf(r.string("phase")), requireNotNull(cleanup.booleanOrNull), optional("receipt")?.let(::DeletionReceipt), optional("accountPartition"))
        }.also(::validate)
    }
}
object AccountDeletionDto {
    fun receipt(text: String): DeletionReceipt {
        try {
            val root = StrictAuthJson.objectValue(text)
            require(root.keys == setOf("requestId", "status") && root.string("status") == "blocked")
            return DeletionReceipt(root.string("requestId"))
        } catch (_: Exception) { throw chat.rogi.rogichat.core.network.InvalidResponse() }
    }
    fun errorCode(text: String): String? = try {
        val root = StrictAuthJson.objectValue(text); require(root.keys == setOf("error"))
        val error = root.getValue("error").jsonObject; require(error.keys == setOf("code"))
        error.string("code").takeIf { it.matches(Regex("[A-Z_]{1,64}")) }
    } catch (_: Exception) { null }
}
