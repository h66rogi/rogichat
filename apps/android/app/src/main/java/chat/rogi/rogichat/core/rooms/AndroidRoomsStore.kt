package chat.rogi.rogichat.core.rooms

import android.content.Context
import android.util.AtomicFile
import androidx.room.Room
import androidx.room.withTransaction
import chat.rogi.rogichat.core.network.*
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
                            Room.databaseBuilder(context, RoomsDatabase::class.java, file.absolutePath).build() }) : RoomsStore {
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
            RoomDirectory(members, discovered, page.next?.let { DiscoveryContinuation(identity.cacheId, it) })
        }
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
