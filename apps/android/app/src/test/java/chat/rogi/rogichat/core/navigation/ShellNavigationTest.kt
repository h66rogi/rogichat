package chat.rogi.rogichat.core.navigation

import org.junit.Assert.*
import org.junit.Test

class ShellNavigationTest {
    @Test fun restrictedAccountsCanManageAccountButNeverOpenRoomsOrProfile() {
        val linked = ShellNavigation(access = ShellAccess.LINK_REQUIRED)
        assertEquals(linked, linked.open(AppPage.CHAT))
        val settings = linked.selectTab(AppTab.SETTINGS)
        assertEquals(AppPage.ACCOUNT, settings.open(AppPage.ACCOUNT).page)
        assertEquals(settings, settings.open(AppPage.PROFILE))
        for (access in listOf(ShellAccess.SIGNED_OUT, ShellAccess.RESTORING, ShellAccess.RETRYABLE_FAILURE, ShellAccess.BLOCKED, ShellAccess.ACCOUNT_CLOSING)) {
            val restricted = ShellNavigation(access = access).selectTab(AppTab.SETTINGS)
            assertEquals(restricted, restricted.open(AppPage.PROFILE))
            assertEquals(restricted, restricted.open(AppPage.ACCOUNT))
            assertEquals(AppPage.ABOUT, restricted.open(AppPage.ABOUT).page)
        }
    }
    @Test fun tabsRetainIndependentStacksAndAccessChangeClearsBoth() {
        val chat = ShellNavigation(access = ShellAccess.READY).open(AppPage.CHAT)
        val account = chat.selectTab(AppTab.SETTINGS).open(AppPage.ACCOUNT)
        assertEquals(AppPage.CHAT, account.selectTab(AppTab.TALKS).page)
        assertEquals(account, account.selectTab(AppTab.SETTINGS))
        assertEquals(AppPage.SETTINGS, account.back().page)
        assertEquals(AppPage.CHAT, account.back().back().page)
        val reset = account.withAccess(ShellAccess.LINK_REQUIRED)
        assertTrue(reset.talkPath.isEmpty() && reset.settingsPath.isEmpty())
        assertEquals(AppPage.LINK, reset.page)
        assertEquals(AppPage.ROOMS, chat.back().page)
        assertEquals(chat.back(), chat.back().back()) // no auto-enter loop
    }
    @Test fun staleAuthorizationNeverConsumesNewIntentOrNewScope() {
        val queue = PendingRouteQueue()
        val a = RoomRouteHint("a"); val b = RoomRouteHint("b")
        assertTrue(queue.offer(a, "event-a", 0, queue.scopeToken))
        val ticketA = queue.begin(0)!!
        assertFalse(queue.offer(a, "event-a", 1, queue.scopeToken))
        assertTrue(queue.offer(b, "event-b", 2, queue.scopeToken))
        assertNull(queue.consume(ticketA, 3))
        val ticketB = queue.begin(3)!!
        assertEquals(b, queue.consume(ticketB, 4))
        assertNull(queue.consume(ticketB, 5))
        assertFalse(queue.offer(b, "event-b", 6, queue.scopeToken))
        queue.offer(a, "new-event", 7, queue.scopeToken)
        val stale = queue.begin(7)!!
        val oldScope = queue.scopeToken
        queue.resetScope()
        assertFalse(queue.offer(a, "late-callback", 8, oldScope))
        assertNull(queue.consume(stale, 8))
        queue.offer(a, "expiry", 10, queue.scopeToken)
        assertNull(queue.begin(10 + PendingRouteQueue.TTL))
    }
    @Test fun parserRejectsUntrustedSchemesHostsPayloadAndEncoding() {
        val parser = ContentRouteParser("qa.example.invalid", "/rooms/")
        assertEquals(RoomRouteHint("room-a"), parser.parse("https://qa.example.invalid/rooms/room-a"))
        listOf("http://qa.example.invalid/rooms/a", "https://prod.example.invalid/rooms/a",
            "https://qa.example.invalid.evil/rooms/a", "https://user@qa.example.invalid/rooms/a",
            "https://qa.example.invalid:443/rooms/a", "https://qa.example.invalid/rooms/a?token=x",
            "https://qa.example.invalid/rooms/a#private", "https://qa.example.invalid/rooms/%2F",
            "https://qa.example.invalid/rooms/../a", "https://qa.example.invalid/rooms/a/b", "not a url")
            .forEach { assertNull(it, parser.parse(it)) }
    }
}
