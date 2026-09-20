package chat.rogi.rogichat.core.rooms

import android.content.Context
import android.util.AtomicFile
import androidx.room.Room
import androidx.room.withTransaction
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.conversation.*
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** App-private, no-backup account database. The caller serializes this owner with session changes.
 * Adapted Meloming's IO dispatcher/constructor-injection lifetime; Room transactions are new.
 * A cleanup intent is durable before deletion, and is honored before any cold database open.
 */
class AndroidRoomsStore(private val context: Context, environment: String,
                        private val directory: File = File(context.noBackupFilesDir, "rooms-$environment"),
                        private val io: CoroutineDispatcher = Dispatchers.IO,
                        private val openDatabase: (File) -> RoomsDatabase = { file ->
                            Room.databaseBuilder(context, RoomsDatabase::class.java, file.absolutePath).addMigrations(RoomsDatabase.MIGRATION_1_2).build() }) : RoomsStore, ConversationStore {
    init { require(environment in setOf("qa", "prod")) }
    private val cleanup = AtomicFile(File(directory, "cleanup"))
    private val device = AtomicFile(File(directory, "device"))
    private var active: RoomsAccountScope? = null
    private var database: RoomsDatabase? = null

    override suspend fun begin(scope: RoomsAccountScope, validate: () -> Unit): RoomSyncIdentity = storage {
        validate()
        if (cleanup.existsRecord() || active != null && active != scope) erase()
        if (database == null) {
            check(directory.isDirectory || directory.mkdirs())
            // A different partition must never be silently rebound to the current account.
            val expected = "${scope.partition.value}.db"
            if (files().any { it.name.endsWith(".db") && it.name != expected }) erase()
            database = openDatabase(File(directory, expected))
            active = scope
        }
        check(active == scope)
        val identity = RoomSyncIdentity(deviceId(), RoomId(UUID.randomUUID().toString()))
        db(scope).withTransaction {
            val dao = db(scope).rooms()
            // Cold open also closes previous authority until a fresh complete manifest arrives.
            dao.clearStaging(); dao.clearDiscovery(); dao.clearPages()
            dao.checkpoint(DirectoryCheckpoint(cacheId = identity.cacheId.value))
            validate()
        }
        identity
    }
    override suspend fun manifest(scope: RoomsAccountScope, identity: RoomSyncIdentity, requested: SyncCursor?,
                                  page: MembershipPage, validate: () -> Unit) = storage {
        db(scope).withTransaction {
            validate()
            val dao = db(scope).rooms()
            val checkpoint = requireNotNull(dao.checkpoint())
            valid(checkpoint.cacheId == identity.cacheId.value && !checkpoint.complete && checkpoint.manifestCursor == requested?.value)
            if (page == MembershipPage.Reset) {
                // Reset withdraws authority, not membership: only a complete snapshot replaces rows.
                dao.clearStaging(); dao.clearDiscovery(); dao.clearPages()
                dao.checkpoint(DirectoryCheckpoint(cacheId = UUID.randomUUID().toString()))
            } else {
                page as MembershipPage.Success
                valid(checkpoint.generation == null || checkpoint.generation == page.generation)
                val cursor = requested?.value.orEmpty()
                val seen = dao.pages("manifest")
                valid(cursor !in seen && (page.next == null || page.next.value !in seen && page.next.value != cursor))
                val prior = dao.staged()
                valid(prior.size + page.rooms.size <= 10000)
                valid(page.rooms.none { room -> prior.any { it.room.roomId == room.roomId.value } })
                dao.stage(page.rooms.map { StagedMembership(MembershipRow.from(it)) })
                dao.page(PageCheckpoint("manifest", cursor))
                if (page.complete) {
                    dao.clearMemberships()
                    dao.memberships(dao.staged().map { it.room })
                    dao.clearStaging()
                    val conversation = db(scope).conversation()
                    conversation.purgeAbsentCommands(); conversation.purgeAbsentMessages(); conversation.purgeAbsentProfiles()
                    conversation.purgeAbsentStaging(); conversation.purgeAbsentCheckpoints(); conversation.purgeAbsentPages()
                    dao.memberships().forEach { member ->
                        conversation.purgeOldMembership(member.roomId, member.membershipScope)
                        val previous = conversation.checkpoint(member.roomId)
                        if (previous != null && (previous.membership != member.membershipScope || previous.authorization != member.authorizationRevision)) {
                            // Confirmed scope rotation discards old private projections immediately.
                            // Only unresolved commands with the unchanged M survive an A-only change.
                            conversation.clearMessages(member.roomId); conversation.clearProfiles(member.roomId)
                            conversation.clearStaging(member.roomId); conversation.clearPages(member.roomId)
                            conversation.clearCheckpoint(member.roomId)
                        }
                    }
                }
                dao.checkpoint(checkpoint.copy(generation = page.generation, manifestCursor = page.next?.value, complete = page.complete))
            }
            validate() // Failure here rolls back effects AND continuation, under the session lifecycle lock.
        }
    }
    override suspend fun discovery(scope: RoomsAccountScope, identity: RoomSyncIdentity, after: RoomId?,
                                   page: DiscoveryPage, validate: () -> Unit): RoomDirectory = storage {
        db(scope).withTransaction {
            validate()
            val dao = db(scope).rooms()
            val checkpoint = requireNotNull(dao.checkpoint())
            valid(checkpoint.cacheId == identity.cacheId.value && checkpoint.complete && checkpoint.discoveryCursor == after?.value)
            valid(!checkpoint.discoveryLoaded || after != null)
            val cursor = after?.value.orEmpty()
            val seen = dao.pages("discovery")
            valid(cursor !in seen && (page.next == null || page.next.value !in seen && page.next.value != cursor))
            val prior = dao.discovery()
            valid(prior.size + page.rooms.size <= 10000)
            valid(page.rooms.none { room -> prior.any { it.roomId == room.roomId.value } })
            dao.discovery(page.rooms.map { DiscoveryRow(it.roomId.value, it.name, it.mode.name) })
            dao.page(PageCheckpoint("discovery", cursor))
            dao.checkpoint(checkpoint.copy(discoveryCursor = page.next?.value, discoveryLoaded = true))
            val members = dao.memberships().map { it.domain() }
            val discovered = dao.discovery().filter { row -> members.none { it.roomId.value == row.roomId } }.map { it.domain() }
            validate()
            RoomDirectory(members, discovered, page.next?.let { DiscoveryContinuation(identity.cacheId, it) }, identity.cacheId)
        }
    }
    override suspend fun authorize(scope: RoomsAccountScope, credentialBinding: String, serverGeneration: String, validate: () -> Unit) = storage {
        validate()
        if (cleanup.existsRecord()) erase()
        check(directory.isDirectory || directory.mkdirs())
        val expected = "${scope.partition.value}.db"
        if (files().any { it.name.endsWith(".db") && it.name != expected }) erase()
        if (database == null) database = openDatabase(File(directory, expected))
        val prior = requireNotNull(database).conversation().owner()
        if (prior == null && requireNotNull(database).conversation().outboxCount() != 0) throw RoomsStorageException()
        if (prior != null && (prior.credentialBinding != credentialBinding || prior.serverGeneration != serverGeneration)) {
            erase(); database = openDatabase(File(directory, expected))
        }
        active = scope
        db(scope).withTransaction {
            val conversation = db(scope).conversation()
            conversation.owner(ConversationOwner(credentialBinding = credentialBinding, serverGeneration = serverGeneration))
            conversation.withdraw(); conversation.parkInterrupted()
            db(scope).rooms().checkpoint()?.let { db(scope).rooms().checkpoint(it.copy(complete = false)) }
            validate()
        }
    }
    override suspend fun withdrawAuthority(): Unit = storage {
        val opened = database
        if (opened != null) opened.withTransaction {
            opened.conversation().withdraw()
            opened.rooms().checkpoint()?.let { opened.rooms().checkpoint(it.copy(complete = false)) }
        }
        opened?.close(); database = null; active = null
    }
    override suspend fun beginConversation(selection: ConversationSelection, validate: () -> Unit): ConversationScope = storage {
        val database = db(selection.account)
        database.withTransaction {
            validate()
            val directory = requireNotNull(database.rooms().checkpoint())
            valid(directory.complete && directory.cacheId == selection.directoryCycle.value)
            valid(database.rooms().memberships().any { it.domain() == selection.membership })
            val room = selection.membership.roomId.value; val dao = database.conversation()
            val scope = ConversationScope(selection, RoomId(UUID.randomUUID().toString()))
            dao.clearMessages(room); dao.clearProfiles(room); dao.clearStaging(room); dao.clearPages(room)
            dao.purgeOldMembership(room, selection.membership.membershipScope.value)
            dao.checkpoint(ConversationCheckpoint(room, scope.cacheId.value, selection.membership.membershipScope.value, selection.membership.authorizationRevision.value))
            validate(); scope
        }
    }
    private suspend fun <T> conversationTransaction(scope: ConversationScope, validate: () -> Unit,
                                                    action: suspend (ConversationDao, ConversationCheckpoint) -> T): T = storage {
        val database = db(scope.selection.account)
        database.withTransaction {
            validate()
            val dao = database.conversation(); val checkpoint = requireNotNull(dao.checkpoint(scope.selection.membership.roomId.value))
            valid(checkpoint.cacheId == scope.cacheId.value && checkpoint.membership == scope.selection.membership.membershipScope.value &&
                checkpoint.authorization == scope.selection.membership.authorizationRevision.value)
            val value = action(dao, checkpoint)
            validate(); value
        }
    }
    private suspend fun putMessage(dao: ConversationDao, room: String, message: ConversationMessage) {
        val previous = dao.message(room, message.id.value)
        if (previous?.createdAtMs != null) valid(previous.createdAtMs == message.createdAt.toEpochMilli())
        if (previous?.deleted == true || previous != null && MessageVersion(previous.version) > message.version) return
        // Equal versions still replace every live projection field, including removed birthday/hints/counterpart.
        dao.message(ConversationMessageRow(room, message.id.value, message.version.value, message.createdAt.toEpochMilli(), false, ConversationDtos.encode(message)))
    }
    private suspend fun data(dao: ConversationDao, scope: ConversationScope): ConversationData {
        val room = scope.selection.membership.roomId.value; val checkpoint = requireNotNull(dao.checkpoint(room))
        valid(checkpoint.snapshotComplete)
        val rows = dao.messages(room); valid(rows.size <= 10000)
        return ConversationData(scope, rows.filter { !it.deleted }.map { ConversationDtos.message(requireNotNull(it.body)) },
            if (checkpoint.profileComplete) dao.profiles(room).map { it.domain() } else emptyList(), checkpoint.profileComplete,
            checkpoint.eventsCursor?.let(::SyncCursor), checkpoint.historyCursor?.let(::SyncCursor), dao.outbox(room).map { it.domain() })
    }
    private fun matches(checkpoint: ConversationCheckpoint, membership: RoomScopeToken, authorization: RoomScopeToken) {
        valid(checkpoint.membership == membership.value && checkpoint.authorization == authorization.value)
    }
    override suspend fun snapshot(scope: ConversationScope, page: SnapshotPage, validate: () -> Unit): ConversationData = conversationTransaction(scope, validate) { dao, checkpoint ->
        valid(!checkpoint.snapshotComplete); matches(checkpoint, page.membership, page.authorization)
        page.messages.forEach { putMessage(dao, checkpoint.roomId, it) }
        dao.checkpoint(checkpoint.copy(snapshotComplete = true, eventsCursor = page.next.value, historyCursor = page.history?.value))
        dao.retireProjectedCommands(checkpoint.roomId)
        data(dao, scope)
    }
    override suspend fun events(scope: ConversationScope, requested: SyncCursor, page: EventPage.Success, validate: () -> Unit): ConversationData = conversationTransaction(scope, validate) { dao, checkpoint ->
        valid(checkpoint.snapshotComplete && checkpoint.eventsCursor == requested.value); matches(checkpoint, page.membership, page.authorization)
        valid(!page.hasMore || page.next != requested)
        for (event in page.events) when (event) {
            is MessageEvent.Upsert -> putMessage(dao, checkpoint.roomId, event.message)
            is MessageEvent.Deleted -> {
                val previous = dao.message(checkpoint.roomId, event.messageId.value)
                if (previous == null || MessageVersion(previous.version) <= event.version)
                    dao.message(ConversationMessageRow(checkpoint.roomId, event.messageId.value, event.version.value, previous?.createdAtMs, true, null))
            }
        }
        dao.checkpoint(checkpoint.copy(eventsCursor = page.next.value)); dao.retireProjectedCommands(checkpoint.roomId); data(dao, scope)
    }
    override suspend fun history(scope: ConversationScope, requested: SyncCursor, page: HistoryPage.Success, validate: () -> Unit): ConversationData = conversationTransaction(scope, validate) { dao, checkpoint ->
        valid(checkpoint.snapshotComplete && checkpoint.historyCursor == requested.value); matches(checkpoint, page.membership, page.authorization)
        val seen = dao.pages(checkpoint.roomId, "history")
        valid(requested.value !in seen && (page.next == null || page.next != requested && page.next.value !in seen))
        page.messages.forEach { putMessage(dao, checkpoint.roomId, it) }
        dao.page(ConversationPage(checkpoint.roomId, "history", requested.value))
        dao.checkpoint(checkpoint.copy(historyCursor = page.next?.value)); dao.retireProjectedCommands(checkpoint.roomId); data(dao, scope)
    }
    override suspend fun profiles(scope: ConversationScope, requested: SyncCursor?, page: ProfilePage.Success, validate: () -> Unit): ConversationData = conversationTransaction(scope, validate) { dao, checkpoint ->
        valid(checkpoint.snapshotComplete && !checkpoint.profileComplete && checkpoint.profileCursor == requested?.value)
        matches(checkpoint, page.membership, page.authorization)
        valid(checkpoint.profileGeneration == null || checkpoint.profileGeneration == page.generation)
        val cursor = requested?.value.orEmpty(); val seen = dao.pages(checkpoint.roomId, "profiles")
        valid(cursor !in seen && (page.next == null || page.next.value != cursor && page.next.value !in seen))
        val prior = dao.staged(checkpoint.roomId); valid(prior.size + page.profiles.size <= 10000)
        valid(page.profiles.none { profile -> prior.any { it.profile.actorId == profile.actorId.value } })
        dao.stage(page.profiles.map { ConversationProfileStage(ConversationProfileRow.from(checkpoint.roomId, it)) })
        dao.page(ConversationPage(checkpoint.roomId, "profiles", cursor))
        if (page.complete) { dao.clearProfiles(checkpoint.roomId); dao.profiles(dao.staged(checkpoint.roomId).map { it.profile }); dao.clearStaging(checkpoint.roomId) }
        dao.checkpoint(checkpoint.copy(profileGeneration = page.generation, profileCursor = page.next?.value, profileComplete = page.complete))
        data(dao, scope)
    }
    override suspend fun current(scope: ConversationScope, validate: () -> Unit): ConversationData = conversationTransaction(scope, validate) { dao, _ -> data(dao, scope) }
    override suspend fun enqueue(scope: ConversationScope, command: TextCommand, createdAtMs: Long, validate: () -> Unit): OutboxRecord = conversationTransaction(scope, validate) { dao, checkpoint ->
        valid(checkpoint.snapshotComplete && checkpoint.membership == command.membership.value)
        valid(dao.outboxCount() < 500 && dao.command(checkpoint.roomId, command.clientMessageId.value) == null)
        val row = ConversationOutboxRow(checkpoint.roomId, command.clientMessageId.value, command.membership.value, checkpoint.authorization,
            command.intent, command.recipient?.value, command.quote?.value, command.text, createdAtMs, OutboxPhase.PREPARED.name)
        dao.enqueue(row); row.domain()
    }
    override suspend fun markSending(scope: ConversationScope, commandId: RoomId, validate: () -> Unit): Unit = conversationTransaction(scope, validate) { dao, checkpoint ->
        val row = requireNotNull(dao.command(checkpoint.roomId, commandId.value))
        valid(row.phase == OutboxPhase.PREPARED.name && row.membership == checkpoint.membership && row.authorization == checkpoint.authorization)
        dao.update(row.copy(phase = OutboxPhase.SENDING.name))
    }
    override suspend fun markUnknown(scope: ConversationScope, commandId: RoomId, errorCode: String?, validate: () -> Unit): Unit = conversationTransaction(scope, validate) { dao, checkpoint ->
        val row = requireNotNull(dao.command(checkpoint.roomId, commandId.value))
        if (row.phase in setOf(OutboxPhase.PREPARED.name, OutboxPhase.SENDING.name, OutboxPhase.UNKNOWN.name))
            dao.update(row.copy(phase = OutboxPhase.UNKNOWN.name, errorCode = errorCode))
    }
    override suspend fun receipt(scope: ConversationScope, commandId: RoomId, receipt: CommandReceipt, validate: () -> Unit): ConversationData = conversationTransaction(scope, validate) { dao, checkpoint ->
        valid(receipt.clientMessageId == commandId)
        val row = dao.command(checkpoint.roomId, commandId.value) ?: return@conversationTransaction data(dao, scope)
        valid(row.membership == checkpoint.membership && row.phase != OutboxPhase.PARKED.name)
        // An observed deleted receipt is terminal even if a delayed lookup still says committed.
        if (row.phase != OutboxPhase.DELETED.name) when (receipt) {
            is CommandReceipt.Committed -> dao.update(row.copy(phase = OutboxPhase.COMMITTED.name, messageId = receipt.messageId.value, version = receipt.version.value, errorCode = null))
            is CommandReceipt.Deleted -> {
                val knownId = row.messageId ?: receipt.messageId?.value
                if (knownId != null) {
                    val previous = dao.message(checkpoint.roomId, knownId)
                    dao.message(ConversationMessageRow(checkpoint.roomId, knownId, previous?.version ?: "0", previous?.createdAtMs, true, null))
                }
                dao.update(row.copy(phase = OutboxPhase.DELETED.name, messageId = null, version = null, errorCode = null))
                dao.retireDeletedCommand(checkpoint.roomId, commandId.value)
            }
        }
        data(dao, scope)
    }
    override suspend fun unavailableProjection(scope: ConversationScope, commandId: RoomId, messageId: RoomId, validate: () -> Unit): ConversationData = conversationTransaction(scope, validate) { dao, checkpoint ->
        // A message GET rejection withdraws this projection; it is not a deletion tombstone.
        dao.hideProjection(checkpoint.roomId, messageId.value)
        val row = dao.command(checkpoint.roomId, commandId.value)
        if (row != null && row.phase == OutboxPhase.COMMITTED.name && row.messageId == messageId.value)
            dao.update(row.copy(errorCode = "PROJECTION_UNAVAILABLE"))
        data(dao, scope)
    }
    override suspend fun projection(scope: ConversationScope, message: ConversationMessage, validate: () -> Unit): ConversationData = conversationTransaction(scope, validate) { dao, checkpoint ->
        valid(checkpoint.snapshotComplete); putMessage(dao, checkpoint.roomId, message)
        dao.retireProjectedCommands(checkpoint.roomId); data(dao, scope)
    }
    override suspend fun clearForDeletion(partition: AccountPartition?): Unit = storage {
        // Deletion recovery may only touch the original partition. A stale journal is not
        // authority to purge another account's DB, even when its credential is absent.
        check(active == null || active?.partition == partition)
        val expected = partition?.value?.let { "$it.db" }
        check(files().filter { it.name.matches(Regex("[A-Za-z0-9_-]{43}\\.db(?:-wal|-shm|-journal)?")) }
            .all { expected != null && (it.name == expected || it.name.startsWith("$expected-")) })
        erase()
    }
    override suspend fun clear(): Unit = storage { erase() }
    private fun valid(value: Boolean) { if (!value) throw InvalidResponse() }
    private fun db(scope: RoomsAccountScope): RoomsDatabase {
        check(active == scope && !cleanup.existsRecord())
        return requireNotNull(database)
    }
    private fun erase() {
        write(cleanup, byteArrayOf(1))
        database?.close(); database = null; active = null
        files().filter { it.name.matches(Regex("[A-Za-z0-9_-]{43}\\.db(?:-wal|-shm|-journal)?")) }
            .forEach { check(it.delete() || !it.exists()) }
        cleanup.delete()
        check(!cleanup.existsRecord())
    }
    private fun files(): List<File> = if (!directory.exists()) emptyList() else requireNotNull(directory.listFiles()).toList()
    private fun deviceId(): RoomId {
        if (device.existsRecord()) return RoomId(device.openRead().use { input ->
            val bytes = ByteArray(37)
            var total = 0
            while (total < bytes.size) { val count = input.read(bytes, total, bytes.size - total); if (count < 0) break; total += count }
            require(total == 36 && input.read() == -1); bytes.copyOf(36).toString(Charsets.US_ASCII)
        })
        return RoomId(UUID.randomUUID().toString()).also { write(device, it.value.toByteArray(Charsets.US_ASCII)) }
    }
    private fun write(file: AtomicFile, bytes: ByteArray) {
        val output = file.startWrite()
        try { output.write(bytes); file.finishWrite(output) }
        catch (failure: Exception) { file.failWrite(output); throw failure }
    }
    private fun AtomicFile.existsRecord() = baseFile.exists() || File(baseFile.path + ".bak").exists() || File(baseFile.path + ".new").exists()
    private suspend fun <T> storage(action: suspend () -> T): T = withContext(io) {
        try { action() } catch (cancelled: CancellationException) { throw cancelled }
        catch (invalid: InvalidResponse) { throw invalid }
        catch (_: Exception) { throw RoomsStorageException() }
    }
}
