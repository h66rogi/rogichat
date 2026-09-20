package chat.rogi.rogichat.core.session

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import chat.rogi.rogichat.BuildConfig
import chat.rogi.rogichat.MainActivity
import chat.rogi.rogichat.core.navigation.ShellAccess
import java.io.File
import java.security.KeyStore
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Test-only isolated key/file namespace. Never writes the product credential or calls an API. */
@RunWith(AndroidJUnit4::class)
class AndroidCredentialStoreTest {
    @Test fun activityRecreationKeepsProductGraphAndFinishesEmptyCredentialRestore() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        // Never mutate a genuine product credential if this test is run on a developer device.
        assumeTrue(androidCredentialStore(context, BuildConfig.ENVIRONMENT).read() == null)
        val original = ProductServices.installed(context)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            withTimeout(5_000) { original.session.first { it.access == ShellAccess.SIGNED_OUT } }
            scenario.recreate()
            scenario.onActivity { activity -> assertSame(original, ProductServices.installed(activity.applicationContext)) }
            assertEquals(ShellAccess.SIGNED_OUT, original.session.value.access)
            assertNull(original.session.value.account)
        }
    }
    @Test fun realKeystoreAndAtomicFilePersistAuthenticateAndClear() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val scope = UUID.randomUUID().toString()
        val directory = File(context.noBackupFilesDir, "instrumentation-$scope")
        val alias = "chat.rogi.rogichat.instrumentation.$scope"
        try {
            val disk = AndroidCredentialDisk(directory)
            fun cipher(environment: String = "qa") = CredentialCipher(environment) { create -> androidCredentialKey(alias, create) }
            fun store() = ProtectedCredentialStore(disk, cipher())
            val token = "x".repeat(43)
            val expiry = Instant.parse("2026-09-27T00:00:00Z")
            assertNull(store().read())
            store().write(NativeCredential(token, expiry))
            assertEquals(token, store().read()!!.token)
            assertEquals(expiry, store().read()!!.expiresAt)
            val encoded = requireNotNull(disk.read())
            assertFalse(encoded.toString(Charsets.ISO_8859_1).contains(token))
            assertThrows(Exception::class.java) { cipher("prod").open(encoded) }
            disk.markCleared()
            assertNull(store().read())
            store().write(NativeCredential(token, expiry))
            assertEquals(token, store().read()!!.token)
            store().clear()
            assertNull(store().read())
            assertFalse(File(directory, "credential").exists())
        } finally {
            directory.deleteRecursively()
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        }
    }
}
