package chat.rogi.rogichat.core.conversation

import chat.rogi.rogichat.core.auth.StrictAuthJson
import chat.rogi.rogichat.core.messageactions.*
import kotlinx.serialization.json.*

/** Account ID is supplied only by the verified owner of the accountPartition DB, never persisted. */
internal object ConversationActionCodec {
    fun encode(record: ActionRecord) = buildJsonObject {
        val selected = record.selection; val scope = selected.scope
        put("id", record.id); put("sessionEpoch", scope.sessionEpoch); put("roomId", scope.roomId); put("actorId", scope.actorId)
        put("membership", scope.membershipScope); put("authorization", scope.authorizationRevision); put("cacheEpoch", scope.cacheEpoch)
        put("messageId", selected.messageId); put("version", selected.version); put("delete", selected.hints.delete); put("publish", selected.hints.publish)
        put("contentKind", selected.contentKind); put("anonymous", selected.anonymous); put("visibleActorId", selected.visibleActorId)
        put("action", record.action.name); put("phase", record.phase.name); put("receiptId", record.receiptId); put("publishedMessageId", record.publishedMessageId)
        put("emoji", record.emoji); put("reportReason", record.reportReason?.name); put("observedBlocked", record.observedBlocked)
    }.toString()
    fun decode(body: String, environment: String, accountId: String): ActionRecord {
        val o = StrictAuthJson.objectValue(body)
        fun str(key: String) = o.getValue(key).jsonPrimitive.let { require(it.isString); it.content }
        fun opt(key: String) = if (o.getValue(key) == JsonNull) null else str(key)
        fun bool(key: String) = o.getValue(key).jsonPrimitive.let { require(!it.isString); requireNotNull(it.booleanOrNull) }
        val scope = ActionScope(environment, accountId, str("sessionEpoch"), str("roomId"), str("actorId"), str("membership"), str("authorization"), str("cacheEpoch"))
        return ActionRecord(str("id"), ActionSelection(scope, str("messageId"), str("version"), ActionHints(bool("delete"), bool("publish")),
            str("contentKind"), bool("anonymous"), opt("visibleActorId")), MessageAction.valueOf(str("action")), ActionPhase.valueOf(str("phase")),
            opt("receiptId"), opt("publishedMessageId"), opt("emoji"), opt("reportReason")?.let(ReportReason::valueOf),
            if (o.getValue("observedBlocked") == JsonNull) null else bool("observedBlocked"))
    }
}
/** A helper may touch the DB only while its parent holds the original scoped Room transaction. */
internal class ActionJournalSlot : ActionJournal {
    private var delegate: ActionJournal? = null
    fun <T> transaction(journal: ActionJournal, block: () -> T): T {
        check(delegate == null); delegate = journal
        return try { block() } finally { delegate = null }
    }
    override fun records() = requireNotNull(delegate).records()
    override fun put(record: ActionRecord) = requireNotNull(delegate).put(record)
}

internal class ScrollAnchorSlot : ScrollAnchorStore {
    private var delegate: ScrollAnchorStore? = null
    fun <T> transaction(store: ScrollAnchorStore, block: () -> T): T {
        check(delegate == null); delegate = store
        return try { block() } finally { delegate = null }
    }
    override fun load(scope: ActionScope) = requireNotNull(delegate).load(scope)
    override fun save(scope: ActionScope, anchor: ScrollAnchor?) = requireNotNull(delegate).save(scope, anchor)
}
