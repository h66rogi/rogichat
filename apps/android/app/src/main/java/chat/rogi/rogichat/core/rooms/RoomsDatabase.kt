package chat.rogi.rogichat.core.rooms

import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import chat.rogi.rogichat.core.conversation.*
import chat.rogi.rogichat.core.network.*

// New schema: the reference application declares Room but contains no database/DAO implementation.
@Entity(tableName = "memberships")
data class MembershipRow(@PrimaryKey val roomId: String, val name: String, val mode: String,
                         val actorId: String, val role: String, val membershipScope: String, val authorizationRevision: String) {
    fun domain() = Membership(RoomId(roomId), name, RoomMode.valueOf(mode), RoomId(actorId), RoomRole.valueOf(role),
        RoomScopeToken(membershipScope), RoomScopeToken(authorizationRevision))
    companion object { fun from(value: Membership) = MembershipRow(value.roomId.value, value.name, value.mode.name,
        value.actorId.value, value.role.name, value.membershipScope.value, value.authorizationRevision.value) }
}
@Entity(tableName = "manifest_staging", primaryKeys = ["roomId"])
data class StagedMembership(@Embedded val room: MembershipRow)
@Entity(tableName = "discovery_rooms")
data class DiscoveryRow(@PrimaryKey val roomId: String, val name: String, val mode: String) {
    // Discovery's joined/M/A claims are intentionally not persisted as membership authority.
    fun domain() = DiscoveredRoom(RoomId(roomId), name, RoomMode.valueOf(mode), null, null, null)
}
@Entity(tableName = "sync_checkpoints")
data class DirectoryCheckpoint(@PrimaryKey val id: Int = 1, val cacheId: String, val generation: String? = null,
                               val manifestCursor: String? = null, val complete: Boolean = false,
                               val discoveryCursor: String? = null, val discoveryLoaded: Boolean = false)
@Entity(tableName = "page_checkpoints", primaryKeys = ["purpose", "cursor"])
data class PageCheckpoint(val purpose: String, val cursor: String)

@Dao
interface RoomsDao {
    @Query("SELECT * FROM sync_checkpoints WHERE id = 1") suspend fun checkpoint(): DirectoryCheckpoint?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun checkpoint(value: DirectoryCheckpoint)
    @Query("SELECT * FROM memberships ORDER BY roomId COLLATE BINARY") suspend fun memberships(): List<MembershipRow>
    @Query("SELECT * FROM manifest_staging") suspend fun staged(): List<StagedMembership>
    @Query("SELECT * FROM discovery_rooms ORDER BY roomId COLLATE BINARY") suspend fun discovery(): List<DiscoveryRow>
    @Query("SELECT cursor FROM page_checkpoints WHERE purpose = :purpose") suspend fun pages(purpose: String): List<String>
    @Insert suspend fun stage(values: List<StagedMembership>)
    @Insert suspend fun memberships(values: List<MembershipRow>)
    @Insert suspend fun discovery(values: List<DiscoveryRow>)
    @Insert suspend fun page(value: PageCheckpoint)
    @Query("DELETE FROM memberships") suspend fun clearMemberships()
    @Query("DELETE FROM manifest_staging") suspend fun clearStaging()
    @Query("DELETE FROM discovery_rooms") suspend fun clearDiscovery()
    @Query("DELETE FROM page_checkpoints") suspend fun clearPages()
}

@Database(entities = [MembershipRow::class, StagedMembership::class, DiscoveryRow::class,
    DirectoryCheckpoint::class, PageCheckpoint::class, ConversationOwner::class, ConversationCheckpoint::class,
    ConversationMessageRow::class, ConversationProfileRow::class, ConversationProfileStage::class,
    ConversationPage::class, ConversationOutboxRow::class], version = 2, exportSchema = true)
abstract class RoomsDatabase : RoomDatabase() {
    abstract fun rooms(): RoomsDao
    abstract fun conversation(): ConversationDao
    companion object {
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS conversation_owner (id INTEGER NOT NULL, credentialBinding TEXT NOT NULL, serverGeneration TEXT NOT NULL, PRIMARY KEY(id))")
                db.execSQL("CREATE TABLE IF NOT EXISTS conversation_checkpoints (roomId TEXT NOT NULL, cacheId TEXT NOT NULL, membership TEXT NOT NULL, authorization TEXT NOT NULL, snapshotComplete INTEGER NOT NULL, eventsCursor TEXT, historyCursor TEXT, profileGeneration TEXT, profileCursor TEXT, profileComplete INTEGER NOT NULL, PRIMARY KEY(roomId))")
                db.execSQL("CREATE TABLE IF NOT EXISTS conversation_messages (roomId TEXT NOT NULL, messageId TEXT NOT NULL, version TEXT NOT NULL, createdAtMs INTEGER, deleted INTEGER NOT NULL, body TEXT, PRIMARY KEY(roomId, messageId))")
                for (table in listOf("conversation_profiles", "conversation_profile_staging"))
                    db.execSQL("CREATE TABLE IF NOT EXISTS $table (roomId TEXT NOT NULL, actorId TEXT NOT NULL, nickname TEXT NOT NULL, avatar TEXT, role TEXT NOT NULL, month INTEGER, day INTEGER, PRIMARY KEY(roomId, actorId))")
                db.execSQL("CREATE TABLE IF NOT EXISTS conversation_pages (roomId TEXT NOT NULL, purpose TEXT NOT NULL, cursor TEXT NOT NULL, PRIMARY KEY(roomId, purpose, cursor))")
                db.execSQL("CREATE TABLE IF NOT EXISTS conversation_outbox (roomId TEXT NOT NULL, clientMessageId TEXT NOT NULL, membership TEXT NOT NULL, authorization TEXT NOT NULL, intent TEXT NOT NULL, recipient TEXT, quote TEXT, text TEXT NOT NULL, createdAtMs INTEGER NOT NULL, phase TEXT NOT NULL, messageId TEXT, version TEXT, errorCode TEXT, PRIMARY KEY(roomId, clientMessageId))")
            }
        }
    }
}
