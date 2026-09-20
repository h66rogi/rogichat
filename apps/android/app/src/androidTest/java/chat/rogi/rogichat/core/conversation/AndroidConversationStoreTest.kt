package chat.rogi.rogichat.core.conversation

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.rooms.*
import java.io.File
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Actual SQLite in a UUID test-only noBackup namespace. No product graph, credential or network. */
@RunWith(AndroidJUnit4::class)
class AndroidConversationStoreTest {
    private lateinit var context: Context
    private lateinit var directory: File
    private val databases = mutableListOf<RoomsDatabase>()
    private val account = RoomsAccountScope("isolated-conversation", 1, AccountPartition("A".repeat(43)))
    private val room = RoomId("00000000-0000-4000-8000-000000000031")
    private val actor = RoomId("00000000-0000-4000-8000-000000000032")
    private val messageId = RoomId("00000000-0000-4000-8000-000000000033")
    private val commandId = RoomId("00000000-0000-4000-8000-000000000034")
    private val m = RoomScopeToken("B".repeat(42) + "A")
    private val a = RoomScopeToken("C".repeat(42) + "A")
    private val next = RoomScopeToken("D".repeat(42) + "A")
    private fun member(membership: RoomScopeToken = m, authorization: RoomScopeToken = a) = Membership(room, "계측 대화", RoomMode.GROUP, actor, RoomRole.MEMBER, membership, authorization)
    private fun message(version: String = "1", created: Instant = Instant.parse("2026-09-20T00:00:00Z")) = ConversationMessage(messageId, MessageVersion(version), created,
        "SHARED", MessageAuthor.Member(actor, "계측 사용자", null), MessageContent.Text("계측 메시지"), null, null, MessageActions(false, false, true))
    private fun newStore() = AndroidRoomsStore(context, "qa", directory, openDatabase = { file ->
        Room.databaseBuilder(context, RoomsDatabase::class.java, file.absolutePath).addMigrations(RoomsDatabase.MIGRATION_1_2).build().also { databases += it }
    })
    private val db get() = databases.last()
    @Before fun setup() { context = ApplicationProvider.getApplicationContext(); directory = File(context.noBackupFilesDir, "conversation-instrumentation-${UUID.randomUUID()}") }
    @After fun cleanup() { databases.forEach { it.close() }; assertTrue(directory.deleteRecursively()); assertFalse(directory.exists()) }
    private suspend fun directory(store: AndroidRoomsStore, scope: RoomsAccountScope = account, member: Membership = member()): ConversationSelection {
        val identity = store.begin(scope) {}
        store.manifest(scope, identity, null, MembershipPage.Success(listOf(member), "authoritative", true, null)) {}
        return ConversationSelection(scope, member, identity.cacheId)
    }
    private suspend fun open(store: AndroidRoomsStore, selection: ConversationSelection, messages: List<ConversationMessage> = listOf(message())): ConversationScope {
        val scope = store.beginConversation(selection) {}
        store.snapshot(scope, SnapshotPage(selection.membership.membershipScope, selection.membership.authorizationRevision, messages, SyncCursor("event-initial"), SyncCursor("history-initial"))) {}
        return scope
    }
    @Test fun sameCredentialColdRestoreRetainsOriginalUnknownButNewBindingPurges() = runBlocking {
        val first = newStore(); first.authorize(account, "same-credential", "generation") {}
        val selected = directory(first); val scope = open(first, selected)
        val command = TextCommand(commandId, m, "SHARED", null, null, "전송 중 작성 내용")
        first.enqueue(scope, command, 1) {}; first.markSending(scope, commandId) {}
        databases.forEach { it.close() }
        val cold = newStore(); val newAccount = account.copy(localEpoch = 2)
        cold.authorize(newAccount, "same-credential", "generation") {}
        assertFalse(db.rooms().checkpoint()!!.complete); assertEquals("UNKNOWN", db.conversation().outbox(room.value).single().phase)
        val freshScope = open(cold, directory(cold, newAccount), emptyList())
        val retained = cold.current(freshScope) {}.outbox.single()
        assertEquals(command, retained.command); assertEquals(a, retained.authorization)
        assertTrue(runCatching { cold.markSending(freshScope, commandId) {} }.isFailure)
        cold.withdrawAuthority()
        val rotated = newStore(); rotated.authorize(newAccount.copy(localEpoch = 3), "different-credential", "generation") {}
        assertTrue(db.conversation().outbox(room.value).isEmpty())
    }
    @Test fun changedMembershipPurgesBodyOnlyAfterCompleteManifestAndSurvivesReopen() = runBlocking {
        val store = newStore(); store.authorize(account, "binding", "generation") {}
        val scope = open(store, directory(store)); store.enqueue(scope, TextCommand(commandId, m, "SHARED", null, null, "이전 참여 본문"), 1) {}
        store.profiles(scope, null, ProfilePage.Success(m, a, listOf(ConversationProfile(actor, "이전 프로필", null, RoomRole.MEMBER, null)), "profile", true, null)) {}
        val identity = store.begin(account) {}
        store.manifest(account, identity, null, MembershipPage.Success(listOf(member(next)), "changed", false, SyncCursor("last"))) {}
        assertEquals("이전 참여 본문", db.conversation().outbox(room.value).single().text)
        assertEquals(1, db.conversation().messages(room.value).size); assertEquals(1, db.conversation().profiles(room.value).size)
        store.manifest(account, identity, SyncCursor("last"), MembershipPage.Success(emptyList(), "changed", true, null)) {}
        assertTrue(db.conversation().outbox(room.value).isEmpty())
        assertTrue(db.conversation().messages(room.value).isEmpty()); assertTrue(db.conversation().profiles(room.value).isEmpty())
        assertNull(db.conversation().checkpoint(room.value))
        store.withdrawAuthority()
        val cold = newStore(); cold.authorize(account.copy(localEpoch = 2), "binding", "generation") {}
        assertTrue(db.conversation().outbox(room.value).isEmpty())
        assertTrue(db.conversation().messages(room.value).isEmpty()); assertTrue(db.conversation().profiles(room.value).isEmpty())
    }
    @Test fun authorizationOnlyChangePreservesOriginalCommandButCannotRebindSend() = runBlocking {
        val store = newStore(); store.authorize(account, "binding", "generation") {}
        val scope = open(store, directory(store)); val command = TextCommand(commandId, m, "SHARED", null, null, "작성 내용")
        store.enqueue(scope, command, 1) {}; store.markSending(scope, commandId) {}; store.withdrawAuthority()
        val cold = newStore(); val changed = account.copy(localEpoch = 2); cold.authorize(changed, "binding", "generation") {}
        val current = open(cold, directory(cold, changed, member(authorization = next)), emptyList())
        val original = cold.current(current) {}.outbox.single()
        assertEquals(command, original.command); assertEquals(a, original.authorization)
        assertTrue(runCatching { cold.markSending(current, commandId) {} }.isFailure)
        val read = cold.receipt(current, commandId, CommandReceipt.Committed(commandId, messageId, MessageVersion("2"))) {}
        assertEquals(OutboxPhase.COMMITTED, read.outbox.single().phase)
    }
    @Test fun tombstoneRejectsEveryLaterLiveAndBadImmutableDateRollsBackCursor() = runBlocking {
        val store = newStore(); store.authorize(account, "binding", "generation") {}; val scope = open(store, directory(store))
        store.events(scope, SyncCursor("event-initial"), EventPage.Success(m, a, listOf(MessageEvent.Deleted(messageId, MessageVersion("2"))), false, SyncCursor("deleted"))) {}
        for (version in listOf("1", "2", "18446744073709551615")) {
            store.projection(scope, message(version)) {}; assertTrue(store.current(scope) {}.messages.isEmpty())
        }
        assertTrue(runCatching { store.events(scope, SyncCursor("deleted"), EventPage.Success(m, a,
            listOf(MessageEvent.Upsert(message("3", Instant.parse("2026-09-20T00:00:01Z")))), false, SyncCursor("invalid-next"))) {} }.isFailure)
        assertEquals("deleted", db.conversation().checkpoint(room.value)!!.eventsCursor)
        assertTrue(db.conversation().message(room.value, messageId.value)!!.deleted)
    }
    @Test fun finalScopeFailureRollsBackOutboxAndCheckpointTogether() = runBlocking {
        val store = newStore(); store.authorize(account, "binding", "generation") {}; val scope = open(store, directory(store))
        var validations = 0
        assertTrue(runCatching { store.enqueue(scope, TextCommand(commandId, m, "SHARED", null, null, "저장 실패"), 1) {
            if (++validations == 2) throw CancellationException("scope changed immediately before commit")
        } }.isFailure)
        assertTrue(db.conversation().outbox(room.value).isEmpty())
        validations = 0
        assertTrue(runCatching { store.events(scope, SyncCursor("event-initial"), EventPage.Success(m, a,
            listOf(MessageEvent.Deleted(messageId, MessageVersion("2"))), false, SyncCursor("later"))) {
            if (++validations == 2) throw CancellationException("scope changed immediately before commit")
        } }.isFailure)
        assertEquals("event-initial", db.conversation().checkpoint(room.value)!!.eventsCursor)
        assertFalse(db.conversation().message(room.value, messageId.value)!!.deleted)
    }
    @Test fun profileGenerationIsCompleteOnlyAndMissingBirthdayReplacesInsteadOfMerges() = runBlocking {
        val store = newStore(); store.authorize(account, "binding", "generation") {}; val scope = open(store, directory(store))
        val birthday = ConversationProfile(actor, "계측 사용자", null, RoomRole.MEMBER, ActorBirthday(2, 29))
        store.profiles(scope, null, ProfilePage.Success(m, a, listOf(birthday), "profile-one", false, SyncCursor("next"))) {}
        assertTrue(store.current(scope) {}.profiles.isEmpty())
        assertTrue(runCatching { store.profiles(scope, SyncCursor("next"), ProfilePage.Success(m, a, emptyList(), "wrong-generation", true, null)) {} }.isFailure)
        store.profiles(scope, SyncCursor("next"), ProfilePage.Success(m, a, emptyList(), "profile-one", true, null)) {}
        assertEquals(ActorBirthday(2, 29), store.current(scope) {}.profiles.single().birthday)
        val refreshed = open(store, directory(store))
        store.profiles(refreshed, null, ProfilePage.Success(m, a, listOf(birthday.copy(birthday = null)), "profile-two", true, null)) {}
        assertNull(store.current(refreshed) {}.profiles.single().birthday)
    }
    @Test fun retirementNeedsExactReceiptAndProjectionWhileDeletedTombstoneOutlivesLateReceipt() = runBlocking {
        val store = newStore(); store.authorize(account, "binding", "generation") {}
        val scope = open(store, directory(store))
        store.enqueue(scope, TextCommand(commandId, m, "SHARED", null, null, "작성 본문"), 1) {}
        store.receipt(scope, commandId, CommandReceipt.Committed(commandId, messageId, MessageVersion("1"))) {}
        assertEquals(1, db.conversation().outboxCount()) // Old cached projection does not retire a newly confirmed receipt.
        val denied = store.unavailableProjection(scope, commandId, messageId) {}
        assertTrue(denied.messages.isEmpty()); assertEquals(OutboxPhase.COMMITTED, denied.outbox.single().phase)
        assertEquals("PROJECTION_UNAVAILABLE", denied.outbox.single().errorCode)
        assertNull(db.conversation().message(room.value, messageId.value)) // Not a deletion tombstone.
        store.projection(scope, message()) {}
        assertEquals(0, db.conversation().outboxCount()); assertEquals(1, store.current(scope) {}.messages.size)
        store.receipt(scope, commandId, CommandReceipt.Committed(commandId, messageId, MessageVersion("2"))) {}
        assertEquals(0, db.conversation().outboxCount()) // A delayed receipt never re-creates an intent.
        val deletedCommand = RoomId(UUID.randomUUID().toString())
        store.enqueue(scope, TextCommand(deletedCommand, m, "SHARED", null, null, "삭제된 요청 본문"), 2) {}
        store.receipt(scope, deletedCommand, CommandReceipt.Deleted(deletedCommand, messageId)) {}
        assertEquals(0, db.conversation().outboxCount()); assertTrue(db.conversation().message(room.value, messageId.value)!!.deleted)
        store.receipt(scope, deletedCommand, CommandReceipt.Committed(deletedCommand, messageId, MessageVersion("99"))) {}
        store.projection(scope, message("18446744073709551615")) {}
        assertTrue(store.current(scope) {}.messages.isEmpty()); assertEquals(0, db.conversation().outboxCount())
    }
    @Test fun existingVersionOneDatabaseMigratesOnDiskWithoutDestructiveFallback() = runBlocking {
        assertTrue(directory.mkdirs())
        val file = File(directory, "${account.partition.value}.db")
        android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(file, null).use { old ->
            old.execSQL("CREATE TABLE IF NOT EXISTS `memberships` (`roomId` TEXT NOT NULL, `name` TEXT NOT NULL, `mode` TEXT NOT NULL, `actorId` TEXT NOT NULL, `role` TEXT NOT NULL, `membershipScope` TEXT NOT NULL, `authorizationRevision` TEXT NOT NULL, PRIMARY KEY(`roomId`))")
            old.execSQL("CREATE TABLE IF NOT EXISTS `manifest_staging` (`roomId` TEXT NOT NULL, `name` TEXT NOT NULL, `mode` TEXT NOT NULL, `actorId` TEXT NOT NULL, `role` TEXT NOT NULL, `membershipScope` TEXT NOT NULL, `authorizationRevision` TEXT NOT NULL, PRIMARY KEY(`roomId`))")
            old.execSQL("CREATE TABLE IF NOT EXISTS `discovery_rooms` (`roomId` TEXT NOT NULL, `name` TEXT NOT NULL, `mode` TEXT NOT NULL, PRIMARY KEY(`roomId`))")
            old.execSQL("CREATE TABLE IF NOT EXISTS `sync_checkpoints` (`id` INTEGER NOT NULL, `cacheId` TEXT NOT NULL, `generation` TEXT, `manifestCursor` TEXT, `complete` INTEGER NOT NULL, `discoveryCursor` TEXT, `discoveryLoaded` INTEGER NOT NULL, PRIMARY KEY(`id`))")
            old.execSQL("CREATE TABLE IF NOT EXISTS `page_checkpoints` (`purpose` TEXT NOT NULL, `cursor` TEXT NOT NULL, PRIMARY KEY(`purpose`, `cursor`))")
            old.version = 1
        }
        val store = newStore()
        store.authorize(account, "binding", "generation") {}
        assertEquals(2, db.openHelper.writableDatabase.version)
        val scope = open(store, directory(store))
        store.enqueue(scope, TextCommand(commandId, m, "SHARED", null, null, "마이그레이션 뒤 작성"), 1) {}
        assertEquals(1, db.conversation().outboxCount())
    }
}
