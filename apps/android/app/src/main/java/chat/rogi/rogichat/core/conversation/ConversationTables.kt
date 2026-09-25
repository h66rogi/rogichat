package chat.rogi.rogichat.core.conversation

import androidx.room.*
import chat.rogi.rogichat.core.network.*

@Entity(tableName = "conversation_owner")
data class ConversationOwner(@PrimaryKey val id: Int = 1, val credentialBinding: String, val serverGeneration: String)
@Entity(tableName = "conversation_checkpoints")
data class ConversationCheckpoint(@PrimaryKey val roomId: String, val cacheId: String, val membership: String, val authorization: String,
                                  val snapshotComplete: Boolean = false, val eventsCursor: String? = null, val historyCursor: String? = null,
                                  val profileGeneration: String? = null, val profileCursor: String? = null, val profileComplete: Boolean = false)
@Entity(tableName = "conversation_messages", primaryKeys = ["roomId", "messageId"])
data class ConversationMessageRow(val roomId: String, val messageId: String, val version: String, val createdAtMs: Long?,
                                  val deleted: Boolean, val body: String?) {
    init { require(deleted == (body == null)); require(deleted || createdAtMs != null) }
}
@Entity(tableName = "conversation_profiles", primaryKeys = ["roomId", "actorId"])
data class ConversationProfileRow(val roomId: String, val actorId: String, val nickname: String, val avatar: String?,
                                  val role: String, val month: Int?, val day: Int?, @ColumnInfo(defaultValue = "0") val providerAvatarAvailable: Boolean = false) {
    fun domain() = ConversationProfile(RoomId(actorId), nickname, avatar?.let(::RoomId), RoomRole.valueOf(role), month?.let { ActorBirthday(it, requireNotNull(day)) }, providerAvatarAvailable)
    companion object { fun from(room: String, value: ConversationProfile) = ConversationProfileRow(room, value.actorId.value, value.nickname,
        value.avatar?.value, value.role.name, value.birthday?.month, value.birthday?.day, value.providerAvatarAvailable) }
}
@Entity(tableName = "conversation_profile_staging", primaryKeys = ["roomId", "actorId"])
data class ConversationProfileStage(@Embedded val profile: ConversationProfileRow)
@Entity(tableName = "conversation_pages", primaryKeys = ["roomId", "purpose", "cursor"])
data class ConversationPage(val roomId: String, val purpose: String, val cursor: String)
@Entity(tableName = "conversation_outbox", primaryKeys = ["roomId", "clientMessageId"])
data class ConversationOutboxRow(val roomId: String, val clientMessageId: String, val membership: String, val authorization: String,
                                 val intent: String, val recipient: String?, val quote: String?, val text: String,
                                 val createdAtMs: Long, val phase: String, val messageId: String? = null, val version: String? = null,
                                 val errorCode: String? = null, val mediaContent: String? = null) {
    fun domain() = OutboxRecord(TextCommand(RoomId(clientMessageId), RoomScopeToken(membership), intent, recipient?.let(::RoomId), quote?.let(::RoomId), text, mediaContent?.let(::storedMedia)),
        RoomScopeToken(authorization), OutboxPhase.valueOf(phase), createdAtMs, messageId?.let(::RoomId), version?.let(::MessageVersion), errorCode)
    override fun toString() = "ConversationOutboxRow([redacted])"
}

@Entity(tableName = "conversation_media", primaryKeys = ["roomId", "assetId"])
data class ConversationMediaRow(val roomId: String, val assetId: String, val membership: String, val authorization: String, val kind: String)

@Entity(tableName = "conversation_actions")
data class ConversationActionRow(@PrimaryKey val id: String, val roomId: String, val membership: String, val body: String)
@Entity(tableName = "conversation_anchors")
data class ConversationAnchorRow(@PrimaryKey val roomId: String, val membership: String, val messageId: String, val offset: Int)

@Entity(tableName = "account_unblocks")
data class AccountUnblockRow(@PrimaryKey val id: String, val body: String)
@Entity(tableName = "account_media")
data class AccountMediaRow(@PrimaryKey val assetId: String, val kind: String)

@Dao
interface ConversationDao {
    @Query("SELECT * FROM account_unblocks ORDER BY rowid") fun unblocksNow(): List<AccountUnblockRow>
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun unblockNow(row: AccountUnblockRow)
    @Query("SELECT * FROM account_media ORDER BY assetId") suspend fun accountMedia(): List<AccountMediaRow>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun accountMedia(row: AccountMediaRow)
    @Query("DELETE FROM account_media WHERE assetId=:asset") suspend fun removeAccountMedia(asset: String)
    @Query("SELECT * FROM conversation_actions ORDER BY rowid") fun actionsNow(): List<ConversationActionRow>
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun actionNow(row: ConversationActionRow)
    @Query("SELECT * FROM conversation_anchors WHERE roomId=:room AND membership=:membership") fun anchorNow(room: String, membership: String): ConversationAnchorRow?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun anchorNow(row: ConversationAnchorRow)
    @Query("DELETE FROM conversation_anchors WHERE roomId=:room") fun clearAnchorNow(room: String)
    @Query("SELECT * FROM conversation_messages WHERE roomId=:room AND messageId=:message") fun messageNow(room: String, message: String): ConversationMessageRow?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun messageNow(row: ConversationMessageRow)
    @Query("DELETE FROM conversation_messages WHERE roomId=:room AND deleted=0") fun hideLiveNow(room: String)
    @Query("DELETE FROM conversation_outbox WHERE roomId=:room AND messageId=:message") fun clearKnownCommandNow(room: String, message: String)
    @Query("DELETE FROM conversation_anchors WHERE roomId NOT IN (SELECT roomId FROM memberships)") suspend fun purgeAbsentAnchors()
    @Query("DELETE FROM conversation_anchors WHERE roomId=:room AND membership!=:membership") suspend fun purgeOldAnchor(room: String, membership: String)
    @Query("SELECT * FROM conversation_media WHERE roomId=:room AND membership=:membership AND authorization=:authorization")
    suspend fun media(room: String, membership: String, authorization: String): List<ConversationMediaRow>
    @Insert suspend fun media(row: ConversationMediaRow)
    @Query("DELETE FROM conversation_media WHERE roomId=:room AND assetId=:asset") suspend fun removeMedia(room: String, asset: String)
    @Query("DELETE FROM conversation_media WHERE roomId=:room AND membership!=:membership") suspend fun purgeOldMedia(room: String, membership: String)
    @Query("DELETE FROM conversation_media WHERE roomId NOT IN (SELECT roomId FROM memberships)") suspend fun purgeAbsentMedia()
    @Query("SELECT * FROM conversation_owner WHERE id=1") suspend fun owner(): ConversationOwner?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun owner(value: ConversationOwner)
    @Query("SELECT * FROM conversation_checkpoints WHERE roomId=:room") suspend fun checkpoint(room: String): ConversationCheckpoint?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun checkpoint(value: ConversationCheckpoint)
    @Query("DELETE FROM conversation_checkpoints WHERE roomId=:room") suspend fun clearCheckpoint(room: String)
    @Query("UPDATE conversation_checkpoints SET snapshotComplete=0, profileComplete=0") suspend fun withdraw()
    @Query("UPDATE conversation_outbox SET phase='UNKNOWN' WHERE phase IN ('PREPARED','SENDING')") suspend fun parkInterrupted()
    @Query("DELETE FROM conversation_outbox WHERE roomId=:room AND membership!=:membership") suspend fun purgeOldMembership(room: String, membership: String)
    @Query("SELECT * FROM conversation_messages WHERE roomId=:room ORDER BY createdAtMs ASC, messageId COLLATE BINARY ASC") suspend fun messages(room: String): List<ConversationMessageRow>
    @Query("SELECT * FROM conversation_messages WHERE roomId=:room AND messageId=:message") suspend fun message(room: String, message: String): ConversationMessageRow?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun message(value: ConversationMessageRow)
    @Query("DELETE FROM conversation_messages WHERE roomId=:room AND messageId=:message AND deleted=0") suspend fun hideProjection(room: String, message: String)
    @Query("DELETE FROM conversation_messages WHERE roomId=:room") suspend fun clearMessages(room: String)
    @Query("SELECT * FROM conversation_profiles WHERE roomId=:room ORDER BY actorId COLLATE BINARY") suspend fun profiles(room: String): List<ConversationProfileRow>
    @Query("SELECT * FROM conversation_profile_staging WHERE roomId=:room") suspend fun staged(room: String): List<ConversationProfileStage>
    @Insert suspend fun stage(values: List<ConversationProfileStage>)
    @Insert suspend fun profiles(values: List<ConversationProfileRow>)
    @Query("DELETE FROM conversation_profiles WHERE roomId=:room") suspend fun clearProfiles(room: String)
    @Query("DELETE FROM conversation_profile_staging WHERE roomId=:room") suspend fun clearStaging(room: String)
    @Query("SELECT cursor FROM conversation_pages WHERE roomId=:room AND purpose=:purpose") suspend fun pages(room: String, purpose: String): List<String>
    @Insert suspend fun page(value: ConversationPage)
    @Query("DELETE FROM conversation_pages WHERE roomId=:room") suspend fun clearPages(room: String)
    @Query("DELETE FROM conversation_pages WHERE roomId=:room AND purpose='profiles'") suspend fun clearProfilePages(room: String)
    @Query("SELECT * FROM conversation_outbox WHERE roomId=:room ORDER BY createdAtMs ASC, clientMessageId COLLATE BINARY ASC") suspend fun outbox(room: String): List<ConversationOutboxRow>
    @Query("SELECT COUNT(*) FROM conversation_outbox") suspend fun outboxCount(): Int
    @Query("SELECT * FROM conversation_outbox WHERE roomId=:room AND clientMessageId=:command") suspend fun command(room: String, command: String): ConversationOutboxRow?
    @Insert suspend fun enqueue(value: ConversationOutboxRow)
    @Update suspend fun update(value: ConversationOutboxRow)
    @Query("DELETE FROM conversation_outbox WHERE roomId=:room AND phase='COMMITTED' AND EXISTS (SELECT 1 FROM conversation_messages m WHERE m.roomId=conversation_outbox.roomId AND m.messageId=conversation_outbox.messageId AND m.deleted=0)") suspend fun retireProjectedCommands(room: String)
    @Query("DELETE FROM conversation_outbox WHERE roomId=:room AND clientMessageId=:command AND phase='DELETED'") suspend fun retireDeletedCommand(room: String, command: String)
    // Removal is based only on a complete authoritative membership snapshot, never discovery or a partial page.
    @Query("DELETE FROM conversation_outbox WHERE roomId NOT IN (SELECT roomId FROM memberships)") suspend fun purgeAbsentCommands()
    @Query("DELETE FROM conversation_messages WHERE roomId NOT IN (SELECT roomId FROM memberships)") suspend fun purgeAbsentMessages()
    @Query("DELETE FROM conversation_profiles WHERE roomId NOT IN (SELECT roomId FROM memberships)") suspend fun purgeAbsentProfiles()
    @Query("DELETE FROM conversation_profile_staging WHERE roomId NOT IN (SELECT roomId FROM memberships)") suspend fun purgeAbsentStaging()
    @Query("DELETE FROM conversation_checkpoints WHERE roomId NOT IN (SELECT roomId FROM memberships)") suspend fun purgeAbsentCheckpoints()
    @Query("DELETE FROM conversation_pages WHERE roomId NOT IN (SELECT roomId FROM memberships)") suspend fun purgeAbsentPages()
}
