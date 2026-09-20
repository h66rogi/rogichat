package chat.rogi.rogichat.core.session

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import chat.rogi.rogichat.core.auth.AuthIntent
import chat.rogi.rogichat.core.auth.AuthProof
import chat.rogi.rogichat.core.auth.PendingAuth
import chat.rogi.rogichat.core.auth.ProtectedPendingAuthStore
import java.io.File
import java.security.KeyStore
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Real platform storage, isolated from product aliases, credentials, intents and API calls. */
@RunWith(AndroidJUnit4::class)
class AndroidPendingAuthStoreTest {
    private lateinit var directory: File
    private lateinit var alias: String

    @Before fun isolateStorage() {
        val scope = UUID.randomUUID().toString()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        directory = File(context.noBackupFilesDir, "instrumentation-pending-$scope")
        alias = "chat.rogi.rogichat.instrumentation.pending.$scope"
        assertFalse(directory.exists())
    }

    @After fun removeOnlyTestStorage() {
        if (::directory.isInitialized) assertTrue(directory.deleteRecursively())
        if (::alias.isInitialized) {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        }
    }

    private fun disk() = AndroidCredentialDisk(directory, maximumBytes = 4096, exactSize = false)
    private fun store(environment: String = "qa") = ProtectedPendingAuthStore(disk(), environment,
        key = { create -> androidCredentialKey(alias, create) })
    private fun pending(intent: AuthIntent = AuthIntent.LOGIN) = PendingAuth(
        transactionId = UUID.randomUUID().toString(), intent = intent, proof = AuthProof.create(),
        createdAt = Instant.parse("2026-09-20T00:00:00Z"),
        credentialFingerprint = if (intent == AuthIntent.LINK) AuthProof.create().state else null,
        accountId = if (intent == AuthIntent.LINK) UUID.randomUUID().toString() else null,
        serverGeneration = if (intent == AuthIntent.LINK) AuthProof.create().state else null,
        clearStamp = AuthProof.create().state,
    )

    @Test fun loginAndLinkRoundTripThroughFreshStoreAndPlatformKey() = runBlocking {
        assertNull(store().read())
        for (intent in AuthIntent.entries) {
            val original = pending(intent)
            store().write(original)
            // Each factory creates a new disk/store; the key is fetched from AndroidKeyStore again.
            val restored = requireNotNull(store().read())
            assertEquals(original.transactionId, restored.transactionId)
            assertEquals(original.intent, restored.intent)
            assertEquals(original.proof.verifier, restored.proof.verifier)
            assertEquals(original.proof.state, restored.proof.state)
            assertEquals(original.createdAt, restored.createdAt)
            assertEquals(original.credentialFingerprint, restored.credentialFingerprint)
            assertEquals(original.accountId, restored.accountId)
            assertEquals(original.serverGeneration, restored.serverGeneration)
            assertEquals(original.clearStamp, restored.clearStamp)
            val encrypted = requireNotNull(disk().read())
            assertTrue(encrypted.size in 81..4096)
            assertFalse(encrypted.toString(Charsets.ISO_8859_1).contains(original.proof.verifier))
            assertFalse(encrypted.toString(Charsets.ISO_8859_1).contains(original.proof.state))
            assertNull(androidCredentialKey(alias, false).encoded)
        }
    }

    @Test fun environmentAadAndTamperingRejectWithoutReplacingOriginalRecord() = runBlocking {
        val original = pending()
        store().write(original)
        assertTrue(runCatching { store("prod").read() }.exceptionOrNull() is CredentialStoreException)
        assertEquals(original.transactionId, store().read()!!.transactionId)
        val encrypted = requireNotNull(disk().read())
        encrypted[encrypted.lastIndex] = (encrypted.last().toInt() xor 1).toByte()
        disk().write(encrypted)
        assertTrue(runCatching { store().read() }.exceptionOrNull() is CredentialStoreException)
    }

    @Test fun durableConsumeSurvivesColdStoreAndReappearingOldCiphertext() = runBlocking {
        store().write(pending())
        val oldCiphertext = requireNotNull(disk().read())
        store().clear()
        assertTrue(disk().isCleared())
        assertNull(store().read())
        assertFalse(File(directory, "credential").exists())
        // Simulates stale bytes surviving deletion: the durable marker still prevents restoration.
        disk().write(oldCiphertext)
        assertNull(store().read())
        assertNull(disk().read())
        store().clear()
        assertNull(store().read())
        val replacement = pending()
        store().write(replacement)
        assertFalse(disk().isCleared())
        assertEquals(replacement.transactionId, store().read()!!.transactionId)
    }

    @Test fun pendingDiskRejectsOversizedRecordsAsTypedStorageFailure() = runBlocking {
        disk().write(ByteArray(4097))
        assertTrue(runCatching { store().read() }.exceptionOrNull() is CredentialStoreException)
    }

    @Test fun credentialClearStampRotatesAndSurvivesFreshDiskInstances() = runBlocking {
        fun credentials() = ProtectedCredentialStore(AndroidCredentialDisk(directory), CredentialCipher("qa") { create ->
            androidCredentialKey(alias, create)
        })
        assertNull(credentials().clearStamp())
        credentials().write(NativeCredential(AuthProof.create().state, Instant.parse("2026-09-27T00:00:00Z")))
        credentials().clear()
        val first = requireNotNull(credentials().clearStamp())
        assertEquals(43, first.length)
        assertEquals(32, AndroidCredentialDisk(directory).clearStamp()!!.size)
        assertNull(credentials().read())
        assertEquals(first, credentials().clearStamp())
        credentials().clear()
        val second = requireNotNull(credentials().clearStamp())
        assertNotEquals(first, second)
        assertEquals(second, credentials().clearStamp())
        credentials().write(NativeCredential(AuthProof.create().state, Instant.parse("2026-09-27T00:00:00Z")))
        assertNull(credentials().clearStamp())
    }
}
