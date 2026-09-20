package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.navigation.*
import chat.rogi.rogichat.feature.settings.*
import org.junit.Assert.*
import org.junit.Test

class NotificationStateTest {
    @Test fun repeatedForegroundSignalsHaveOneEpoch() {
        var foreground = ForegroundState()
        foreground = foreground.transition(true).transition(true)
        assertEquals(1L, foreground.epoch)
        foreground = foreground.transition(false).transition(false).transition(true)
        assertEquals(2L, foreground.epoch)
    }
    @Test fun staleReadAndCancellationCannotRestoreOldPermission() {
        val initial = NotificationReadState()
        assertFalse(initial.observing)
        assertNull(initial.snapshot)
        val first = initial.begin()
        val second = first.begin()
        val denied = NotificationSnapshot(NotificationAuthorization.DENIED)
        val allowed = NotificationSnapshot(NotificationAuthorization.ALLOWED)
        assertEquals(second, second.finish(first.revision, allowed))
        val complete = second.finish(second.revision, denied)
        assertEquals(denied, complete.snapshot)
        assertEquals(complete, complete.fail(first.revision))
        assertEquals(first.cancel(), first.cancel().finish(first.revision, allowed))
        val retry = complete.begin()
        assertTrue(retry.fail(retry.revision).failed)
        assertNull(retry.fail(retry.revision).snapshot)
    }
    @Test fun oldIntentCancellationDoesNotCancelNewTap() {
        val queue = PendingRouteQueue()
        queue.offer(RoomRouteHint("a"), "a", 0, queue.scopeToken)
        val first = queue.begin(0)!!
        queue.offer(RoomRouteHint("b"), "b", 1, queue.scopeToken)
        assertFalse(queue.cancel(first))
        val second = queue.begin(1)!!
        assertTrue(queue.cancel(second))
        assertNull(queue.consume(second, 2))
        assertNull(queue.begin(2))
    }
}
