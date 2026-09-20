package chat.rogi.rogichat.core.session

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import chat.rogi.rogichat.core.auth.fingerprint
import chat.rogi.rogichat.core.deletion.*
import java.io.File
import java.security.KeyStore
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith

/** Real KeyStore/AtomicFile only, UUID test namespaces. No product graph, credential factory or API. */
@RunWith(AndroidJUnit4::class)
class AndroidAccountDeletionStoreTest {
    private lateinit var directory: File
    private lateinit var alias: String
    @Before fun isolate() {
        val id = UUID.randomUUID().toString()
        directory = File(InstrumentationRegistry.getInstrumentation().targetContext.noBackupFilesDir, "instrumentation-deletion-$id")
        alias = "chat.rogi.rogichat.instrumentation.deletion.$id"
        assertFalse(directory.exists())
    }
    @After fun cleanup() {
        if (::directory.isInitialized) assertTrue(directory.deleteRecursively())
        if (::alias.isInitialized) KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
    }
    private fun disk() = AndroidCredentialDisk(directory, 16384, false)
    private fun store(env: String = "qa") = ProtectedAccountDeletionStore(disk(), env, { androidCredentialKey(alias, it) })
    private fun record() = DeletionRecord(UUID.randomUUID().toString(), UUID.randomUUID().toString(), fingerprint("isolated-original"),
        null, fingerprint("isolated-clear"), DeletionPhase.UNKNOWN, false)
    @Test fun realAeadAndAtomicColdReadPreserveUnknownAndActualReceipt() = runBlocking {
        val unknown = record(); val ack = record().copy(phase = DeletionPhase.BLOCKED,
            receipt = DeletionReceipt("00000000-0000-5000-8000-000000000001"))
        store().write(listOf(unknown, ack)); assertEquals(listOf(unknown, ack), store().read())
        val bytes = disk().read()!!
        assertFalse(bytes.toString(Charsets.ISO_8859_1).contains(unknown.accountId))
        assertFalse(bytes.toString(Charsets.ISO_8859_1).contains(ack.receipt!!.requestId))
        assertNull(androidCredentialKey(alias, false).encoded)
        assertTrue(runCatching { store("prod").read() }.exceptionOrNull() is DeletionStorageException)
        assertEquals(listOf(unknown, ack), store().read())
        store().erase(); assertTrue(store().read().isEmpty())
    }
    @Test fun interruptedRestorePhaseAndTamperedVersionFailClosedWithoutDeletingEvidence() = runBlocking {
        val interrupted = record().copy(phase = DeletionPhase.REAUTH_RESTORING, cleanupPending = true)
        store().write(listOf(interrupted)); assertEquals(interrupted, store().read().single())
        val bytes = disk().read()!!; bytes[0] = 2; disk().write(bytes)
        assertTrue(runCatching { store().read() }.exceptionOrNull() is DeletionStorageException)
        assertArrayEquals(bytes, disk().read())
        disk().write(ByteArray(16385))
        assertTrue(runCatching { store().read() }.exceptionOrNull() is DeletionStorageException)
    }
}
