package chat.rogi.rogichat.core.messageactions

import java.util.UUID

/** No bearer, message body, quote or attachment is retained here. Visible actor is room-scoped only. */
data class ActionScope(val environment: String, val accountId: String, val sessionEpoch: String,
    val roomId: String, val actorId: String, val membershipScope: String,
    val authorizationRevision: String, val cacheEpoch: String) {
    init {
        require(environment in setOf("qa", "prod"))
        listOf(accountId, sessionEpoch, roomId, actorId, cacheEpoch).forEach(::actionId)
        require(listOf(membershipScope, authorizationRevision).all { it.matches(Regex("[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]")) })
    }
    val partition get() = listOf(environment, accountId, roomId, membershipScope)
}
fun actionId(value: String) { require(value.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"))) }
data class ActionHints(val delete: Boolean, val publish: Boolean)
data class ActionSelection(val scope: ActionScope, val messageId: String, val version: String,
    val hints: ActionHints, val contentKind: String, val anonymous: Boolean, val visibleActorId: String? = null) {
    init { visibleActorId?.let(::actionId); require(!anonymous || visibleActorId == null); actionId(messageId); require(version.matches(Regex("[1-9][0-9]{0,19}"))); require(version.length < 20 || version <= "18446744073709551615") }
}
enum class MessageAction { DELETE, PUBLISH, SET_REACTION, REMOVE_REACTION, REPORT, BLOCK_ACTOR }
enum class ActionPhase { UNKNOWN, REPORTED, ACTOR_BLOCKED, REACTED, BLOCKED, PREPARING, PUBLISHED, REVOKED, REJECTED }
data class ActionRecord(val id: String, val selection: ActionSelection, val action: MessageAction,
    val phase: ActionPhase, val receiptId: String? = null, val publishedMessageId: String? = null, val emoji: String? = null, val reportReason: ReportReason? = null)
/** Implement in the parent's account DB transaction. put must be durable before returning.
 * Do not persist credentials/content. UNKNOWN survives process death and is never replayed. */
interface ActionJournal {
    fun records(): List<ActionRecord>
    fun put(record: ActionRecord)
}
sealed interface ActionResult {
    data class Deleted(val requestId: String) : ActionResult
    data class Publication(val id: String, val status: ActionPhase, val messageId: String?) : ActionResult
    data class Reported(val receipt: ReportReceipt) : ActionResult
    data class ActorBlocked(val actorId: String) : ActionResult
    data class Reacted(val reactions: MessageReactions) : ActionResult
    data object Rejected : ActionResult
    data object Unknown : ActionResult
}
sealed interface ActionEffect {
    /** Parent atomically purges content, author, counterpart, quotes, attachments, reactions and hints;
     * invalidates linked publication cache, then syncs. Receipt is access blocked, not physical erasure. */
    data class AccessBlocked(val selection: ActionSelection) : ActionEffect
    data class Refresh(val selection: ActionSelection) : ActionEffect
    data class ResetRoom(val scope: ActionScope) : ActionEffect
}
/** Serialized with the owner. Call claim immediately at actual HTTP admission, after every actor hop.
 * Reset revokes even A→B→A; one permit can never dispatch twice. */
class ActionPermit internal constructor(val record: ActionRecord, private val owner: MessageActionState, private val generation: Long) {
    private var consumed = false
    fun claim() = synchronized(owner) {
        check(!consumed && owner.admits(record.selection, generation)) { "stale_action" }
        consumed = true
    }
}
class ActionViewToken internal constructor(val selection: ActionSelection, internal val generation: Long) {
    override fun equals(other: Any?) = other is ActionViewToken && selection == other.selection && generation == other.generation
    override fun hashCode() = 31 * selection.hashCode() + generation.hashCode()
}
class MessageActionState(private val journal: ActionJournal) {
    private var generation = 0L
    var selection: ActionSelection? = null; private set
    var pending: ActionPermit? = null; private set
    var presentation: ActionRecord? = null; private set
    @Synchronized fun select(value: ActionSelection?) {
        generation++; selection = null; pending = null; presentation = null
        val restored = value?.let { selected -> journal.records().lastOrNull {
            it.selection.scope.partition == selected.scope.partition && it.selection.messageId == selected.messageId
        } }
        selection = value; presentation = restored
    }
    @Synchronized fun reset() = select(null)
    internal fun admits(value: ActionSelection, expected: Long) = generation == expected && selection == value
    @Synchronized fun capture(): ActionViewToken? = selection?.let { ActionViewToken(it, generation) }
    @Synchronized fun begin(token: ActionViewToken, action: MessageAction, emoji: String? = null, reportReason: ReportReason? = null): ActionPermit {
        val captured = token.selection
        check(admits(captured, token.generation) && pending == null) { "stale_action" }
        check(when (action) {
            MessageAction.REPORT -> reportReason != null
            MessageAction.BLOCK_ACTOR -> !captured.anonymous && captured.visibleActorId != null && captured.visibleActorId != captured.scope.actorId
            MessageAction.SET_REACTION, MessageAction.REMOVE_REACTION -> true // selection is a freshly authorized live message
            MessageAction.DELETE -> captured.hints.delete && !captured.anonymous
            MessageAction.PUBLISH -> captured.hints.publish && !captured.anonymous && captured.contentKind in setOf("TEXT", "PHOTO")
        }) { "action_unavailable" }
        check(journal.records().none { it.selection.scope.partition == captured.scope.partition &&
            it.selection.messageId == captured.messageId && it.phase in setOf(ActionPhase.UNKNOWN, ActionPhase.PREPARING, ActionPhase.BLOCKED, ActionPhase.ACTOR_BLOCKED) }) { "reconcile_required" }
        if (action == MessageAction.SET_REACTION) require(emoji in reactionChoices) else require(emoji == null)
        require(action == MessageAction.REPORT || reportReason == null)
        val record = ActionRecord(UUID.randomUUID().toString(), captured, action, ActionPhase.UNKNOWN, emoji = emoji, reportReason = reportReason)
        journal.put(record) // Failure means no network admission.
        return ActionPermit(record, this, generation).also { pending = it; presentation = record }
    }
    @Synchronized fun finish(permit: ActionPermit, result: ActionResult): ActionEffect? {
        // Persist only the immutable original partition, even if current UI changed.
        val original = journal.records().singleOrNull { it.id == permit.record.id } ?: return null
        if (original.phase != ActionPhase.UNKNOWN) return null
        val next = when (result) {
            is ActionResult.Deleted -> {
                if (original.action != MessageAction.DELETE) return null
                original.copy(selection = original.selection.tombstone(), phase = ActionPhase.BLOCKED, receiptId = result.requestId)
            }
            is ActionResult.Publication -> {
                if (original.action != MessageAction.PUBLISH) return null
                original.copy(phase = result.status, receiptId = result.id, publishedMessageId = result.messageId)
            }
            is ActionResult.Reported -> {
                if (original.action != MessageAction.REPORT) return null
                original.copy(phase = ActionPhase.REPORTED, receiptId = result.receipt.reportId)
            }
            is ActionResult.ActorBlocked -> {
                if (original.action != MessageAction.BLOCK_ACTOR || original.selection.visibleActorId != result.actorId) return null
                original.copy(phase = ActionPhase.ACTOR_BLOCKED)
            }
            is ActionResult.Reacted -> {
                if (original.action !in setOf(MessageAction.SET_REACTION, MessageAction.REMOVE_REACTION)) return null
                original.copy(phase = ActionPhase.REACTED)
            }
            ActionResult.Rejected -> original.copy(phase = ActionPhase.REJECTED)
            ActionResult.Unknown -> original
        }
        journal.put(next)
        if (pending !== permit || selection != original.selection) return null
        pending = null; presentation = next
        return when (next.phase) {
            ActionPhase.ACTOR_BLOCKED -> ActionEffect.ResetRoom(original.selection.scope)
            ActionPhase.BLOCKED -> ActionEffect.AccessBlocked(original.selection)
            ActionPhase.REACTED, ActionPhase.PUBLISHED, ActionPhase.REVOKED -> ActionEffect.Refresh(original.selection)
            else -> null
        }
    }
    /** Authoritative committed DB tombstone, never inferred from a 404 or page omission. */
    @Synchronized fun deleted(scope: ActionScope, messageId: String) {
        journal.records().filter { it.selection.scope.partition == scope.partition && it.selection.messageId == messageId }
            .forEach { journal.put(it.copy(selection = it.selection.tombstone(), phase = ActionPhase.BLOCKED, publishedMessageId = null)) }
        if (selection?.scope == scope && selection?.messageId == messageId) reset()
    }
    @Synchronized fun reportStatus(token: ActionViewToken, recordId: String, receipt: ReportReceipt): Boolean {
        if (!admits(token.selection, token.generation)) return false
        val old = journal.records().singleOrNull { it.id == recordId && it.action == MessageAction.REPORT &&
            it.selection.scope.partition == token.selection.scope.partition && it.selection.messageId == token.selection.messageId } ?: return false
        if (old.phase != ActionPhase.UNKNOWN) return false
        val next = old.copy(phase = ActionPhase.REPORTED, receiptId = receipt.reportId)
        journal.put(next); presentation = next; return true
    }
    /** GET only; must carry the exact captured selection and publication ID. No mutation retry. */
    @Synchronized fun publicationStatus(token: ActionViewToken, recordId: String, result: ActionResult.Publication): ActionEffect? {
        val captured = token.selection
        if (!admits(captured, token.generation)) return null
        val old = journal.records().singleOrNull { it.id == recordId && it.selection.scope.partition == captured.scope.partition && it.selection.messageId == captured.messageId } ?: return null
        if (old.phase !in setOf(ActionPhase.PREPARING, ActionPhase.PUBLISHED) || old.receiptId != result.id) return null
        if (old.phase == ActionPhase.PUBLISHED && result.status == ActionPhase.PREPARING) return null
        val next = old.copy(phase = result.status, publishedMessageId = result.messageId)
        journal.put(next); presentation = next
        return if (next.phase in setOf(ActionPhase.PUBLISHED, ActionPhase.REVOKED)) ActionEffect.Refresh(captured) else null
    }
}

/** Fixed valid emoji choices; the server still validates and authorizes every command. */
val reactionChoices = listOf("👍", "❤️", "😂", "😮", "😢", "👏")

private fun ActionSelection.tombstone() = copy(hints = ActionHints(false, false), contentKind = "TOMBSTONE", anonymous = true, visibleActorId = null)
