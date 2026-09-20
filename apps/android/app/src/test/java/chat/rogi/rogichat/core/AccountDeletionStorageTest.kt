package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.auth.fingerprint
import chat.rogi.rogichat.core.deletion.*
import chat.rogi.rogichat.core.session.CredentialDisk
import java.util.UUID
import javax.crypto.KeyGenerator
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

internal class DeletionDisk : CredentialDisk {
    var bytes: ByteArray? = null
    var failWrite = false; var failErase = false
    override fun read() = bytes?.clone()
    override fun write(value: ByteArray) { if (failWrite) error("isolated_write_failure"); bytes = value.clone() }
    override fun erase() { if (failErase) error("isolated_erase_failure"); bytes = null }
    override fun isCleared() = false
    override fun markCleared() = error("journal_is_not_a_login_tombstone")
    override fun removeClearMarker() = error("journal_cannot_remove_credential_marker")
}
internal fun deletionRecord(phase: DeletionPhase = DeletionPhase.UNKNOWN) = DeletionRecord(UUID.randomUUID().toString(), OWN,
    fingerprint(TOKEN), null, fingerprint("clear"), phase, cleanupPending = false,
    receipt = if (phase == DeletionPhase.BLOCKED) DeletionReceipt(RECEIPT) else null)
class AccountDeletionStorageTest {
    @Test fun purposeEnvironmentEnvelopeColdRestoreAndAuthenticatedTamperFailure() = runTest {
        val disk = DeletionDisk(); val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        fun store(environment: String = "qa") = ProtectedAccountDeletionStore(disk, environment, { key }, StandardTestDispatcher(testScheduler))
        assertTrue(store().read().isEmpty())
        val records = listOf(deletionRecord(), deletionRecord(DeletionPhase.BLOCKED))
        store().write(records); assertEquals(records, store().read())
        val encrypted = disk.read()!!
        assertFalse(encrypted.toString(Charsets.ISO_8859_1).contains(OWN))
        assertFalse(encrypted.toString(Charsets.ISO_8859_1).contains(RECEIPT))
        assertTrue(runCatching { store("prod").read() }.exceptionOrNull() is DeletionStorageException)
        assertEquals(records, store().read())
        encrypted[encrypted.lastIndex] = (encrypted.last().toInt() xor 1).toByte(); disk.bytes = encrypted
        assertTrue(runCatching { store().read() }.exceptionOrNull() is DeletionStorageException)
    }
    @Test fun failedAtomicUpdatesDoNotDiscardOldUnknownAndEraseIsExplicit() = runTest {
        val disk = DeletionDisk(); val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val store = ProtectedAccountDeletionStore(disk, "qa", { key }, StandardTestDispatcher(testScheduler))
        val old = deletionRecord(); store.write(listOf(old)); disk.failWrite = true
        assertTrue(runCatching { store.write(listOf(old.copy(phase = DeletionPhase.BLOCKED, receipt = DeletionReceipt(RECEIPT)))) }.isFailure)
        assertEquals(listOf(old), store.read()); disk.failErase = true
        assertTrue(runCatching { store.erase() }.isFailure); assertEquals(listOf(old), store.read())
        disk.failErase = false; store.erase(); assertTrue(store.read().isEmpty())
    }
    @Test fun durableRecordAndPresentationAreIndependentAcrossDismissAndDifferentAccount() {
        val original = deletionRecord(DeletionPhase.BLOCKED)
        val state = DeletionState(original)
        assertTrue(state.presentedFor(null, null).visible)
        assertFalse(state.presentedFor(OTHER, null).visible)
        assertFalse(state.presentedFor(OWN, original.operationId).visible)
        assertFalse(state.copy(capacityReached = true).presentedFor(OWN, "capacity").visible)
        assertEquals(RECEIPT, state.record!!.receipt!!.requestId)
        assertTrue(state.copy(storageFailure = true).presentedFor(null, original.operationId).visible)
        assertTrue(state.copy(storageFailure = true).presentedFor(OTHER, original.operationId).storageFailure)
        assertNull(state.copy(storageFailure = true).presentedFor(OTHER, original.operationId).record)
    }
    @Test fun unknownVersionsDuplicateFieldsOverCapacityAndInvalidRestorePhasesFailClosed() {
        val encoded = DeletionJournalCodec.encode(listOf(deletionRecord()))
        for (invalid in listOf(encoded.replace("\"version\":1", "\"version\":2"),
            encoded.replace("\"version\":1", "\"version\":1,\"version\":1"),
            encoded.replace("\"cleanupPending\":false", "\"cleanupPending\":\"false\""),
            encoded.replace("UNKNOWN", "REAUTH_RESTORING")))
            assertThrows(Exception::class.java) { DeletionJournalCodec.decode(invalid) }
        assertThrows(IllegalArgumentException::class.java) { DeletionJournalCodec.encode((1..17).map { deletionRecord() }) }
        val duplicate = deletionRecord(); assertThrows(IllegalArgumentException::class.java) { DeletionJournalCodec.encode(listOf(duplicate, duplicate)) }
    }
}
