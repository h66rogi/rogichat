package chat.rogi.rogichat.core.messageactions

import java.nio.file.Files
import java.nio.file.Path
import java.util.Properties
import org.junit.Test

private class DiskJournal(private val path: Path) : ActionJournal {
    var fail = false
    override fun records(): List<ActionRecord> {
        if (!Files.exists(path)) return emptyList()
        val p = Properties().also { Files.newInputStream(path).use(it::load) }
        return (0 until p.getProperty("size").toInt()).map { index ->
            fun field(key: String) = p.getProperty("$index.$key")
            val scope = ActionScope(field("environment"), field("account"), field("session"), field("room"), field("actor"), field("membership"), field("authorization"), field("cache"))
            val selection = ActionSelection(scope, field("message"), field("version"), ActionHints(field("delete").toBoolean(), field("publish").toBoolean()), field("kind"), field("anonymous").toBoolean(), field("visibleActor"))
            ActionRecord(field("id"), selection, MessageAction.valueOf(field("action")), ActionPhase.valueOf(field("phase")), field("receipt"), field("published"), field("emoji"), field("reason")?.let(ReportReason::valueOf), field("observed")?.toBoolean())
        }
    }
    override fun put(record: ActionRecord) {
        check(!fail)
        val values = records().filterNot { it.id == record.id } + record
        val p = Properties(); p["size"] = values.size.toString()
        values.forEachIndexed { i, r ->
            val s = r.selection; val c = s.scope
            mapOf("environment" to c.environment, "account" to c.accountId, "session" to c.sessionEpoch, "room" to c.roomId,
                "actor" to c.actorId, "membership" to c.membershipScope, "authorization" to c.authorizationRevision, "cache" to c.cacheEpoch,
                "message" to s.messageId, "version" to s.version, "delete" to s.hints.delete.toString(), "publish" to s.hints.publish.toString(),
                "kind" to s.contentKind, "anonymous" to s.anonymous.toString(), "visibleActor" to s.visibleActorId,
                "id" to r.id, "action" to r.action.name, "phase" to r.phase.name, "receipt" to r.receiptId,
                "published" to r.publishedMessageId, "emoji" to r.emoji, "reason" to r.reportReason?.name, "observed" to r.observedBlocked?.toString()).forEach { (k,v) -> if (v != null) p["$i.$k"] = v }
        }
        val temp = path.resolveSibling("next.properties")
        Files.newOutputStream(temp).use { p.store(it, null) }
        Files.move(temp, path, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
    }
}
private class TestAnchors : ScrollAnchorStore {
    val values = mutableMapOf<List<String>, ScrollAnchor>()
    override fun load(scope: ActionScope) = values[scope.partition + scope.authorizationRevision]
    override fun save(scope: ActionScope, anchor: ScrollAnchor?) {
        val key = scope.partition + scope.authorizationRevision
        if (anchor == null) values.remove(key) else values[key] = anchor
    }
}
private class TestBlockJournal : BlockJournal {
    val values = mutableListOf<UnblockRecord>()
    override fun records() = values.toList()
    override fun put(record: UnblockRecord) { values.removeAll { it.id == record.id }; values.add(record) }
}
class MessageActionChecks {
    @Test fun regression() = runChecks()
    companion object {
        @JvmStatic fun main(args: Array<String>) = runChecks()
        fun runChecks() {
            val a = "11111111-1111-4111-8111-111111111111"
            val b = "22222222-2222-4222-8222-222222222222"
            val c = "33333333-3333-4333-8333-333333333333"
            val d = "44444444-4444-4444-8444-444444444444"
            var count = 0
            fun verify(value: Boolean) { check(value); count++ }
            fun rejects(block: () -> Unit) { var rejected = false; try { block() } catch (_: Exception) { rejected = true }; verify(rejected) }
            val scope = ActionScope("qa", a, b, c, a, "A".repeat(43), "B".repeat(42) + "A", d)
            val selected = ActionSelection(scope, b, "1", ActionHints(true, true), "TEXT", false, b)
            val temp = Files.createTempDirectory("message-actions")
            try {
                val path = temp.resolve("journal.properties"); val journal = DiskJournal(path); val state = MessageActionState(journal)
                state.select(selected); val stale = state.capture()!!; state.reset(); state.select(selected)
                rejects { state.begin(stale, MessageAction.DELETE) }
                val permit = state.begin(state.capture()!!, MessageAction.DELETE)
                verify(MessageActionWire.mutation(permit).path == "rooms/$c/messages/$b/delete")
                state.reset(); state.select(selected); rejects { permit.claim() }
                verify(state.finish(permit, ActionResult.Deleted(d)) == null)
                val restored = MessageActionState(DiskJournal(path)); restored.select(selected)
                verify(restored.presentation?.phase == ActionPhase.BLOCKED); verify(restored.presentation?.selection?.visibleActorId == null); verify(restored.presentation?.selection?.hints?.delete == false)
                rejects { restored.begin(restored.capture()!!, MessageAction.PUBLISH) }
                Files.delete(path); state.select(selected)
                val reaction = state.begin(state.capture()!!, MessageAction.SET_REACTION, "👍")
                reaction.claim(); rejects { reaction.claim() }; state.finish(reaction, ActionResult.Unknown)
                rejects { state.begin(state.capture()!!, MessageAction.REMOVE_REACTION) }
                val reopened = MessageActionState(DiskJournal(path)); reopened.select(selected)
                rejects { reopened.begin(reopened.capture()!!, MessageAction.SET_REACTION, "❤️") }
                Files.delete(path); state.select(selected); journal.fail = true
                rejects { state.begin(state.capture()!!, MessageAction.DELETE) }; verify(state.pending == null); journal.fail = false
                val anonymous = selected.copy(anonymous = true, visibleActorId = null); state.select(anonymous)
                rejects { state.begin(state.capture()!!, MessageAction.PUBLISH) }; rejects { state.begin(state.capture()!!, MessageAction.BLOCK_ACTOR) }
                val report = state.begin(state.capture()!!, MessageAction.REPORT, reportReason = ReportReason.SPAM)
                verify(ModerationWire.recoverReport(report.record).path == "report-receipts/${report.record.id}")
                state.finish(report, ActionResult.Unknown)
                verify(state.reportStatus(state.capture()!!, report.record.id, ModerationWire.receipt("""{"reportId":"$d","status":"received","createdAt":"2026-09-20T00:00:00.000Z"}""")))
                verify(MessageActionWire.result(MessageAction.DELETE, 503, """{"error":{"code":"UNAVAILABLE"}}""") == ActionResult.Unknown)
                verify(MessageActionWire.result(MessageAction.DELETE, 200, """{"requestId":"$d","status":"blocked","status":"blocked"}""") == ActionResult.Unknown)
                verify(MessageActionWire.result(MessageAction.DELETE, 200, """{"requestId":"$d","status":"blocked"}""") == ActionResult.Deleted(d))
                verify(MessageActionWire.result(MessageAction.PUBLISH, 202, """{"publicationId":"$d","status":"preparing"}""") == ActionResult.Publication(d, ActionPhase.PREPARING, null))
                rejects { MessageActionWire.publicationResult("""{"publicationId":"$d","status":"preparing","messageId":"$b"}""") }
                rejects { MessageActionWire.reactionResult("""{"counts":[{"emoji":"👍","count":true}],"mine":null}""") }
                verify(MessageActionWire.reactionResult("""{"counts":[{"emoji":"👍","count":1}],"mine":null}""").counts.size == 1)
                val position = MessageReadPosition(TestAnchors()); position.select(scope); val readToken = position.capture()!!
                val context = "A".repeat(43)
                verify(position.accept(readToken, ReadSnapshot(context, listOf(b))))
                val read = position.displayed(readToken, b)!!; read.claim()
                verify(position.finish(read, false, null)); verify(position.needsRefresh)
                verify(position.displayed(readToken, b) == null); verify(!position.accept(readToken, ReadSnapshot(context, listOf(b))))
                val fresh = position.capture()!!; verify(position.accept(fresh, ReadSnapshot(context, emptyList())))
                verify(!position.accept(fresh, ReadSnapshot(context, listOf(b))))
                position.saveAnchor(fresh, ScrollAnchor(b, 22), setOf(b)); verify(position.restoreAnchor(fresh, setOf(b))?.offset == 22)
                verify(position.restoreAnchor(fresh, emptySet()) == null)
                rejects { MessageReadWire.snapshot("""{"readContext":"$context","items":[{"messageId":null}]}""") }
                verify(MessageReadWire.saved("""{"messageId":null}""") == null)
                val viewport = MessageViewport(); val anchor = ScrollAnchor(b, 22)
                verify(viewport.initialize(anchor) == ViewportMove.Restore(anchor)); verify(viewport.olderPageCommitted() == ViewportMove.Restore(anchor))
                verify(viewport.incomingCommitted(setOf(d)) == ViewportMove.None); verify(viewport.incomingCount == 1)
                verify(viewport.incomingCommitted(setOf(d)) == ViewportMove.None); verify(viewport.incomingCount == 1)
                verify(viewport.showLatest() == ViewportMove.Latest); verify(viewport.incomingCount == 0)
                verify(viewport.incomingCommitted(setOf(c)) == ViewportMove.Latest)
                Files.delete(path); state.select(selected)
                val publish = state.begin(state.capture()!!, MessageAction.PUBLISH); publish.claim()
                verify(state.finish(publish, ActionResult.Publication(d, ActionPhase.PREPARING, null)) == null)
                state.reset(); state.select(selected); val pt = state.capture()!!
                verify(state.publicationStatus(pt, publish.record.id, ActionResult.Publication(d, ActionPhase.PUBLISHED, c)) == ActionEffect.Refresh(selected))
                verify(state.publicationStatus(pt, publish.record.id, ActionResult.Publication(d, ActionPhase.PREPARING, null)) == null)
                verify(state.publicationStatus(pt, publish.record.id, ActionResult.Publication(d, ActionPhase.REVOKED, null)) == ActionEffect.Refresh(selected))
                state.deleted(scope, b); verify(state.selection == null)
                verify(journal.records().all { it.selection.visibleActorId == null && !it.selection.hints.delete && it.publishedMessageId == null })
                position.select(scope); val rt = position.capture()!!; position.accept(rt, ReadSnapshot(context, emptyList()))
                val lateRead = position.displayed(rt, b)!!; position.select(null); position.select(scope)
                rejects { lateRead.claim() }; verify(!position.finish(lateRead, true, b))
                rejects { MessageReadWire.saved("""{"messageId":null,"extra":1}""") }
                rejects { actionId(a + "\n") }
                Files.delete(path); state.select(selected)
                val uncertainReaction = state.begin(state.capture()!!, MessageAction.SET_REACTION, "👍")
                uncertainReaction.claim(); state.finish(uncertainReaction, ActionResult.Unknown)
                verify(MessageAction.REPORT !in state.blockedActions(state.capture()!!))
                val independentReport = state.begin(state.capture()!!, MessageAction.REPORT, reportReason = ReportReason.SPAM)
                independentReport.claim(); state.finish(independentReport, ActionResult.Unknown)
                val independentBlock = state.begin(state.capture()!!, MessageAction.BLOCK_ACTOR)
                independentBlock.claim(); state.finish(independentBlock, ActionResult.Unknown)
                verify(journal.records().size == 3 && journal.records().all { it.phase == ActionPhase.UNKNOWN })
                rejects { state.begin(state.capture()!!, MessageAction.REMOVE_REACTION) }
                val blockJournal = TestBlockJournal(); val manager = ActorBlocksState(blockJournal, journal)
                val blockScope = BlockScope("qa", a, b, c, d); manager.select(blockScope)
                val page = manager.refresh()!!
                verify(ActorBlocksWire.list(page).path == "rooms/$c/blocks")
                val rows = ActorBlocksWire.page("""{"blocks":[{"actorId":"$b","blockedAt":"2026-09-20T00:00:00.000Z"}],"next":null}""")
                verify(manager.accept(page, rows) == BlockReset(blockScope))
                verify(journal.records().last().phase == ActionPhase.UNKNOWN && journal.records().last().observedBlocked == true)
                val oldView = manager.capture()!!; val unblock = manager.unblock(oldView, b); unblock.claim()
                verify(unblock.request().method == "DELETE" && unblock.request().body == null)
                verify(ActorBlocksWire.result(unblock, 200, """{"actorId":"$b","blocked":false,"resetRequired":true}""") == UnblockOutcome.ACKNOWLEDGED)
                verify(ActorBlocksWire.result(unblock, 200, """{"actorId":"$d","blocked":false,"resetRequired":true}""") == UnblockOutcome.UNKNOWN)
                manager.finish(unblock, UnblockOutcome.UNKNOWN)
                rejects { manager.unblock(oldView, b) }
                val recovery = manager.refresh()!!
                verify(manager.accept(recovery, BlockPage(emptyList(), null)) == BlockReset(blockScope))
                verify(blockJournal.records().single().outcome == UnblockOutcome.UNKNOWN && blockJournal.records().single().observedBlocked == false)
                verify(journal.records().last().phase == ActionPhase.UNKNOWN && journal.records().last().observedBlocked == false)
                verify(manager.complete && manager.blocks.isEmpty())
                val oldPage = manager.refresh()!!; manager.select(null); manager.select(blockScope)
                verify(manager.accept(oldPage, rows) == null)
                val newPage = manager.refresh()!!; manager.accept(newPage, rows)
                val lateUnblock = manager.unblock(manager.capture()!!, b); manager.select(null); manager.select(blockScope)
                rejects { lateUnblock.claim() }; verify(manager.finish(lateUnblock, UnblockOutcome.ACKNOWLEDGED) == null)
                val id5 = "44444444-4444-5444-8444-444444444444"
                verify(MessageActionWire.result(MessageAction.DELETE, 200, """{"requestId":"$id5","status":"blocked"}""") == ActionResult.Deleted(id5))
                rejects { actionId(id5) } // Actual server route identifier is v4-only.
                val staleList = manager.refresh()!!
                val oldBlock = journal.records().single { it.action == MessageAction.BLOCK_ACTOR }
                journal.put(oldBlock.copy(phase = ActionPhase.ACTOR_BLOCKED)) // A late block receipt overtakes GET.
                verify(manager.accept(staleList, rows) == null && manager.failed && !manager.complete)
                val partial = manager.refresh()!!
                verify(manager.accept(partial, rows.copy(next = b)) == null && !manager.complete)
                val continuation = manager.more()!!
                verify(ActorBlocksWire.list(continuation).path.endsWith("?after=$b"))
                verify(manager.accept(continuation, BlockPage(emptyList(), null)) == BlockReset(blockScope))
                state.deleted(scope, b)
                verify(journal.records().single { it.action == MessageAction.REPORT }.phase == ActionPhase.UNKNOWN)
                println("MessageActionChecks: $count checks passed (contract/state/disk-journal reconstruction/viewport)")
            } finally { temp.toFile().deleteRecursively() }
        }
    }
}
