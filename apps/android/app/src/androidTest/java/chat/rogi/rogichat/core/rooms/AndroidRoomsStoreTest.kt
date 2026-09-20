package chat.rogi.rogichat.core.rooms

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import chat.rogi.rogichat.core.network.*
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Isolated on-disk SQLite only; no product namespace, network, credential or real account is used. */
@RunWith(AndroidJUnit4::class)
class AndroidRoomsStoreTest {
    private lateinit var context: Context
    private lateinit var directory: File
    private lateinit var store: AndroidRoomsStore
    private val opened = mutableListOf<RoomsDatabase>()
    private val partition = AccountPartition("A".repeat(43))
    private val scope = RoomsAccountScope("instrumentation-only", 1, partition)
    private val first = RoomId("00000000-0000-4000-8000-000000000011")
    private val second = RoomId("00000000-0000-4000-8000-000000000012")
    private val actor = RoomId("00000000-0000-4000-8000-000000000001")
    private val token = RoomScopeToken("B".repeat(42) + "A")
    private fun member(id: RoomId = first, name: String = "계측 전용 방") = Membership(id, name, RoomMode.FAN, actor, RoomRole.FAN, token, token)
    private fun discovered(id: RoomId = second) = DiscoveredRoom(id, "계측 탐색 방", RoomMode.GROUP, null, null, null)
    private fun success(rooms: List<Membership>, complete: Boolean = true, next: String? = null, generation: String = "cycle") =
        MembershipPage.Success(rooms, generation, complete, next?.let(::SyncCursor))
    private val db get() = opened.last()
    private fun newStore() = AndroidRoomsStore(context, "qa", directory, openDatabase = { file ->
        Room.databaseBuilder(context, RoomsDatabase::class.java, file.absolutePath).build().also { opened += it }
    })
    @Before fun setup() {
        context = ApplicationProvider.getApplicationContext()
        directory = File(context.noBackupFilesDir, "rooms-instrumentation-${UUID.randomUUID()}")
        store = newStore()
    }
    @After fun cleanup() = runBlocking {
        opened.forEach { it.close() }
        directory.deleteRecursively()
        assertFalse(directory.exists())
    }
    @Test fun partialManifestDoesNotReplaceUntilCompleteAndDiscoveryCannotOverrideAuthority() = runBlocking {
        val cycle = store.begin(scope) {}
        store.manifest(scope, cycle, null, success(listOf(member()), complete = false, next = "next")) {}
        assertTrue(db.rooms().memberships().isEmpty()); assertFalse(db.rooms().checkpoint()!!.complete)
        store.manifest(scope, cycle, SyncCursor("next"), success(listOf(member(second)))) {}
        assertEquals(2, db.rooms().memberships().size)
        val result = store.discovery(scope, cycle, null, DiscoveryPage(listOf(discovered(first)), null)) {}
        assertEquals(listOf(first, second), result.memberships.map { it.roomId })
        assertTrue(result.discovered.isEmpty()) // unjoined discovery is not revocation evidence.
        assertEquals("계측 전용 방", result.memberships.first().name)
    }
    @Test fun missingRoomOnlyDisappearsAfterCompleteNewGenerationIncludingEmptySuccess() = runBlocking {
        var cycle = store.begin(scope) {}
        store.manifest(scope, cycle, null, success(listOf(member()))) {}
        cycle = store.begin(scope) {}
        store.manifest(scope, cycle, null, success(listOf(member(second)), complete = false, next = "last", generation = "new")) {}
        assertEquals(first.value, db.rooms().memberships().single().roomId)
        store.manifest(scope, cycle, SyncCursor("last"), success(emptyList(), generation = "new")) {}
        assertEquals(second.value, db.rooms().memberships().single().roomId)
        cycle = store.begin(scope) {}
        store.manifest(scope, cycle, null, success(emptyList(), generation = "empty")) {}
        assertTrue(db.rooms().memberships().isEmpty()); assertTrue(db.rooms().checkpoint()!!.complete)
    }
    @Test fun crossGenerationDuplicateAndLoopRejectWithoutAdvancingPersistedCursor() = runBlocking {
        val cycle = store.begin(scope) {}
        store.manifest(scope, cycle, null, success(listOf(member()), complete = false, next = "next")) {}
        val badPages = listOf(success(listOf(member(second)), generation = "changed"), success(listOf(member())),
            success(listOf(member(second)), complete = false, next = "next"))
        for (page in badPages) {
            assertTrue(runCatching { store.manifest(scope, cycle, SyncCursor("next"), page) {} }.exceptionOrNull() is InvalidResponse)
            assertEquals("next", db.rooms().checkpoint()!!.manifestCursor)
            assertEquals(1, db.rooms().staged().size); assertTrue(db.rooms().memberships().isEmpty())
        }
    }
    @Test fun resetWithdrawsAuthorityButPreservesRowsUntilFreshCompleteSnapshot() = runBlocking {
        var cycle = store.begin(scope) {}
        store.manifest(scope, cycle, null, success(listOf(member()))) {}
        cycle = store.begin(scope) {}
        store.manifest(scope, cycle, null, MembershipPage.Reset) {}
        assertEquals(first.value, db.rooms().memberships().single().roomId)
        assertFalse(db.rooms().checkpoint()!!.complete); assertNull(db.rooms().checkpoint()!!.generation)
        assertNotEquals(cycle.cacheId.value, db.rooms().checkpoint()!!.cacheId)
        assertTrue(runCatching { store.manifest(scope, cycle, null, success(listOf(member()))) {} }.exceptionOrNull() is InvalidResponse)
        assertTrue(runCatching { store.discovery(scope, cycle, null, DiscoveryPage(emptyList(), null)) {} }.exceptionOrNull() is InvalidResponse)
        val fresh = store.begin(scope) {}
        assertEquals(first.value, db.rooms().memberships().single().roomId)
        assertTrue(runCatching { store.discovery(scope, fresh, null, DiscoveryPage(emptyList(), null)) {} }.exceptionOrNull() is InvalidResponse)
        store.manifest(scope, fresh, null, success(emptyList())) {}
        assertTrue(db.rooms().memberships().isEmpty()); assertTrue(db.rooms().checkpoint()!!.complete)
        assertTrue(store.discovery(scope, fresh, null, DiscoveryPage(emptyList(), null)) {}.memberships.isEmpty())
    }
    @Test fun finalFenceFailureRollsBackStagingReplacementAndCheckpointOnDisk() = runBlocking {
        val cycle = store.begin(scope) {}
        var checks = 0
        assertTrue(runCatching {
            store.manifest(scope, cycle, null, success(listOf(member()))) {
                if (++checks == 2) throw CancellationException("expired_before_commit")
            }
        }.exceptionOrNull() is CancellationException)
        assertEquals(2, checks)
        assertTrue(db.rooms().memberships().isEmpty()); assertTrue(db.rooms().staged().isEmpty())
        assertNull(db.rooms().checkpoint()!!.generation); assertFalse(db.rooms().checkpoint()!!.complete)
        db.close()
        val reopened = Room.databaseBuilder(context, RoomsDatabase::class.java, File(directory, "${partition.value}.db").absolutePath).build()
        opened += reopened
        assertTrue(reopened.rooms().memberships().isEmpty()); assertNull(reopened.rooms().checkpoint()!!.generation)
    }
    @Test fun committedDbReopensButColdBeginClosesAuthorityUntilFreshCompleteManifest() = runBlocking {
        val cycle = store.begin(scope) {}
        store.manifest(scope, cycle, null, success(listOf(member()))) {}
        val previousDevice = cycle.deviceId
        db.close(); store = newStore()
        val fresh = store.begin(scope) {}
        assertEquals(previousDevice, fresh.deviceId); assertNotEquals(cycle.cacheId, fresh.cacheId)
        assertFalse(db.rooms().checkpoint()!!.complete)
        assertEquals(first.value, db.rooms().memberships().single().roomId) // persisted, but not authorized for display yet.
        assertTrue(runCatching { store.discovery(scope, fresh, null, DiscoveryPage(emptyList(), null)) {} }.exceptionOrNull() is InvalidResponse)
        store.manifest(scope, fresh, null, success(emptyList())) {}
        assertTrue(store.discovery(scope, fresh, null, DiscoveryPage(emptyList(), null)) {}.memberships.isEmpty())
    }
    @Test fun durableCleanupIntentIsHonoredBeforeColdOpenAndPartitionSwitchPurgesOldDb() = runBlocking {
        var cycle = store.begin(scope) {}
        store.manifest(scope, cycle, null, success(listOf(member()))) {}
        db.close()
        File(directory, "cleanup").writeBytes(byteArrayOf(1)) // prior process died after durable intent, before deletion.
        store = newStore(); cycle = store.begin(scope) {}
        assertTrue(db.rooms().memberships().isEmpty()); assertFalse(File(directory, "cleanup").exists())
        store.manifest(scope, cycle, null, success(listOf(member()))) {}
        val different = scope.copy(localEpoch = 2, partition = AccountPartition("D".repeat(42) + "A"))
        store.begin(different) {}
        assertFalse(File(directory, "${partition.value}.db").exists())
        assertTrue(db.rooms().memberships().isEmpty())
        assertTrue(runCatching { store.discovery(scope, cycle, null, DiscoveryPage(emptyList(), null)) {} }.isFailure)
    }
    @Test fun failedDurableCleanupCannotReopenOldAuthorityAndSuccessfulRetryErasesIt() = runBlocking {
        val cycle = store.begin(scope) {}
        store.manifest(scope, cycle, null, success(listOf(member()))) {}
        // An undeletable owned path (non-empty directory) simulates an interrupted/failed file cleanup.
        val obstruction = File(directory, "${"E".repeat(42)}A.db-journal").apply { mkdir() }
        File(obstruction, "test-only").writeText("block")
        assertTrue(runCatching { store.clear() }.exceptionOrNull() is RoomsStorageException)
        assertTrue(File(directory, "cleanup").exists())
        store = newStore()
        assertTrue(runCatching { store.begin(scope) {} }.exceptionOrNull() is RoomsStorageException)
        assertTrue(File(directory, "cleanup").exists())
        obstruction.deleteRecursively()
        store.begin(scope) {}; assertTrue(db.rooms().memberships().isEmpty())
    }
    @Test fun deletionCleanupRejectsDifferentPartitionOnLiveAndColdStoreWithoutDeletingRows() = runBlocking {
        val cycle = store.begin(scope) {}
        store.manifest(scope, cycle, null, success(listOf(member()))) {}
        val foreign = AccountPartition("D".repeat(42) + "A")
        for (expected in listOf(foreign, null)) {
            assertTrue(runCatching { store.clearForDeletion(expected) }.exceptionOrNull() is RoomsStorageException)
            assertEquals(first.value, db.rooms().memberships().single().roomId)
            assertFalse(File(directory, "cleanup").exists())
        }
        db.close(); store = newStore()
        assertTrue(runCatching { store.clearForDeletion(foreign) }.exceptionOrNull() is RoomsStorageException)
        assertTrue(File(directory, "${partition.value}.db").exists())
        store.clearForDeletion(partition)
        assertFalse(File(directory, "${partition.value}.db").exists())
        assertTrue(File(directory, "device").exists())
    }
    @Test fun reverseDiscoveryContinuationAndDuplicatePageCannotOverwriteCurrentDirectory() = runBlocking {
        val cycle = store.begin(scope) {}
        store.manifest(scope, cycle, null, success(listOf(member()))) {}
        val firstPage = store.discovery(scope, cycle, null, DiscoveryPage(listOf(discovered()), second)) {}
        assertEquals(second, firstPage.continuation!!.after)
        assertTrue(runCatching { store.discovery(scope, cycle, null, DiscoveryPage(emptyList(), null)) {} }.exceptionOrNull() is InvalidResponse)
        assertTrue(runCatching { store.discovery(scope, cycle, second, DiscoveryPage(listOf(discovered()), null)) {} }.exceptionOrNull() is InvalidResponse)
        assertEquals(second.value, db.rooms().checkpoint()!!.discoveryCursor)
        val complete = store.discovery(scope, cycle, second, DiscoveryPage(emptyList(), null)) {}
        assertEquals(1, complete.discovered.size); assertEquals(1, complete.memberships.size)
    }
}
