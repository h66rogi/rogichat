package chat.rogi.rogichat.core.messageactions

import chat.rogi.rogichat.core.auth.StrictAuthJson
import java.time.Instant
import java.util.UUID
import kotlinx.serialization.json.*

/** Own blocks/unblock remains available after leaving; no active membership token is required. */
data class BlockScope(val environment: String, val accountId: String, val sessionEpoch: String, val roomId: String, val viewEpoch: String) {
    init { require(environment in setOf("qa", "prod")); listOf(accountId, sessionEpoch, roomId, viewEpoch).forEach(::actionId) }
    val partition get() = listOf(environment, accountId, roomId)
}
/** Current own-block GET projection only; never enrich from message/profile/history caches. */
data class BlockedActor(val actorId: String, val blockedAt: String, val displayName: String?) {
    val displayLabel: String get() = displayName ?: "이름을 확인할 수 없는 사용자"
}
data class BlockPage(val blocks: List<BlockedActor>, val next: String?)
enum class UnblockOutcome { UNKNOWN, ACKNOWLEDGED, REJECTED }
data class UnblockRecord(val id: String, val scope: BlockScope, val actorId: String,
    val outcome: UnblockOutcome, val observedBlocked: Boolean? = null)
interface BlockJournal { fun records(): List<UnblockRecord>; fun put(record: UnblockRecord) }
class BlockViewToken internal constructor(val scope: BlockScope, internal val generation: Long) {
    override fun equals(other: Any?) = other is BlockViewToken && scope == other.scope && generation == other.generation
    override fun hashCode() = 31 * scope.hashCode() + generation.hashCode()
}
class BlockPageToken internal constructor(val view: BlockViewToken, val after: String?)
class UnblockPermit internal constructor(val record: UnblockRecord, private val owner: ActorBlocksState, private val token: BlockViewToken) {
    private var used = false
    fun claim() = synchronized(owner) { check(!used && owner.admits(token) && owner.pending === this); used = true }
    fun request() = ActionRequest("DELETE", "rooms/${record.scope.roomId}/blocks/${record.actorId}", null, 200)
}
/** Return Reset on acknowledged change OR fresh current-state recovery, never infer operation success from a GET. */
data class BlockReset(val scope: BlockScope)
class ActorBlocksState(private val journal: BlockJournal, private val actionJournal: ActionJournal) {
    private var scope: BlockScope? = null
    private var generation = 0L
    private var pagePending: BlockPageToken? = null
    var pending: UnblockPermit? = null; private set
    var blocks: List<BlockedActor> = emptyList(); private set
    var complete = false; private set
    var next: String? = null; private set
    var failed = false; private set
    var lastOutcome: UnblockOutcome? = null; private set
    private var baseline: List<ActionRecord> = emptyList()
    @Synchronized fun select(value: BlockScope?) {
        generation++; scope = value; pending = null; pagePending = null; blocks = emptyList(); complete = false; next = null; failed = false; lastOutcome = null; baseline = emptyList()
    }
    @Synchronized fun capture() = scope?.let { BlockViewToken(it, generation) }
    internal fun admits(token: BlockViewToken) = token.scope == scope && token.generation == generation
    @Synchronized fun refresh(): BlockPageToken? {
        if (pending != null || scope == null) return null
        baseline = currentActorRecords()
        generation++; blocks = emptyList(); complete = false; next = null; failed = false
        return BlockPageToken(capture()!!, null).also { pagePending = it }
    }
    @Synchronized fun more(): BlockPageToken? {
        if (pending != null || pagePending != null || complete || next == null) return null
        return BlockPageToken(capture() ?: return null, next).also { pagePending = it; failed = false }
    }
    @Synchronized fun fail(token: BlockPageToken) {
        if (pagePending === token && admits(token.view)) { pagePending = null; failed = true }
    }
    @Synchronized fun accept(token: BlockPageToken, page: BlockPage): BlockReset? {
        if (pagePending !== token || !admits(token.view)) return null
        require(page.blocks.size <= 50 && page.blocks.map { it.actorId }.distinct().size == page.blocks.size)
        page.blocks.forEach { actionId(it.actorId); Instant.parse(it.blockedAt) }
        require(page.blocks.zipWithNext().all { (a,b) -> a.actorId < b.actorId })
        require(token.after == null || page.blocks.all { it.actorId > token.after })
        require(page.next == null || page.next == page.blocks.lastOrNull()?.actorId)
        blocks = if (token.after == null) page.blocks else blocks + page.blocks
        next = page.next; complete = next == null; pagePending = null; failed = false
        if (currentActorRecords() != baseline) {
            generation++; blocks = emptyList(); complete = false; next = null; failed = true
            return null // A block intent/receipt changed while this GET was in flight.
        }
        if (!complete) return null // Prefix omission never proves unblocked.
        val current = token.view.scope; val actors = blocks.map { it.actorId }.toSet()
        journal.records().filter { it.scope.partition == current.partition && it.outcome == UnblockOutcome.UNKNOWN }
            .forEach { journal.put(it.copy(observedBlocked = it.actorId in actors)) }
        actionJournal.records().filter { it.action == MessageAction.BLOCK_ACTOR &&
            listOf(it.selection.scope.environment, it.selection.scope.accountId, it.selection.scope.roomId) == current.partition }
            .forEach { actionJournal.put(it.copy(observedBlocked = it.selection.visibleActorId in actors)) }
        return BlockReset(current)
    }
    private fun currentActorRecords(): List<ActionRecord> = actionJournal.records().filter { it.action == MessageAction.BLOCK_ACTOR &&
        listOf(it.selection.scope.environment, it.selection.scope.accountId, it.selection.scope.roomId) == scope?.partition }.sortedBy { it.id }
    @Synchronized fun unknownActors(): Set<String> {
        val current = scope ?: return emptySet()
        return journal.records().filter { it.scope.partition == current.partition && it.outcome == UnblockOutcome.UNKNOWN }.map { it.actorId }.toSet() +
            actionJournal.records().filter { it.action == MessageAction.BLOCK_ACTOR && it.phase == ActionPhase.UNKNOWN &&
                listOf(it.selection.scope.environment, it.selection.scope.accountId, it.selection.scope.roomId) == current.partition }.mapNotNull { it.selection.visibleActorId }
    }
    /** Explicit user intent after a COMPLETE fresh list. Previous UNKNOWN remains UNKNOWN in history. */
    @Synchronized fun unblock(token: BlockViewToken, actorId: String): UnblockPermit {
        check(admits(token) && complete && pending == null && blocks.any { it.actorId == actorId })
        val record = UnblockRecord(UUID.randomUUID().toString(), token.scope, actorId, UnblockOutcome.UNKNOWN)
        journal.put(record); lastOutcome = UnblockOutcome.UNKNOWN; generation++; complete = false; pagePending = null
        return UnblockPermit(record, this, capture()!!).also { pending = it }
    }
    @Synchronized fun finish(permit: UnblockPermit, outcome: UnblockOutcome): BlockReset? {
        val original = journal.records().singleOrNull { it.id == permit.record.id } ?: return null
        if (original.outcome != UnblockOutcome.UNKNOWN) return null
        journal.put(original.copy(outcome = outcome))
        if (pending !== permit || scope != original.scope) return null
        pending = null; lastOutcome = outcome
        if (outcome != UnblockOutcome.ACKNOWLEDGED) return null
        blocks = blocks.filterNot { it.actorId == original.actorId }
        return BlockReset(original.scope)
    }
}
object ActorBlocksWire {
    fun list(token: BlockPageToken): ActionRequest {
        token.after?.let(::actionId)
        return ActionRequest("GET", "rooms/${token.view.scope.roomId}/blocks", null, 200, token.after?.let { mapOf("after" to it) }.orEmpty())
    }
    fun page(body: String): BlockPage {
        val root = StrictAuthJson.objectValue(body); require(root.keys == setOf("blocks", "next"))
        val rows = root.getValue("blocks").jsonArray.map { raw ->
            val row = raw.jsonObject; require(row.keys == setOf("actorId", "blockedAt", "displayName"))
            BlockedActor(row.text("actorId").also(::actionId), row.text("blockedAt").also { Instant.parse(it) },
                if (row.getValue("displayName") == JsonNull) null else row.text("displayName"))
        }
        require(rows.size <= 50)
        return BlockPage(rows, if (root.getValue("next") == JsonNull) null else root.text("next").also(::actionId))
    }
    fun result(permit: UnblockPermit, status: Int, body: String): UnblockOutcome = try {
        val root = StrictAuthJson.objectValue(body)
        if (status == 200) {
            require(root.keys == setOf("actorId", "blocked", "resetRequired") && root.text("actorId") == permit.record.actorId)
            val blocked = root.getValue("blocked").jsonPrimitive; val reset = root.getValue("resetRequired").jsonPrimitive
            require(!blocked.isString && blocked.booleanOrNull == false && !reset.isString && reset.booleanOrNull == true)
            UnblockOutcome.ACKNOWLEDGED
        } else if (MessageActionWire.result(MessageAction.BLOCK_ACTOR, status, body) == ActionResult.Rejected) UnblockOutcome.REJECTED else UnblockOutcome.UNKNOWN
    } catch (_: Exception) { UnblockOutcome.UNKNOWN }
    private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.let { require(it.isString); it.content }
}
