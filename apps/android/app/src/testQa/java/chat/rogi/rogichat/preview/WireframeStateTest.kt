package chat.rogi.rogichat.preview

import org.junit.Assert.*
import org.junit.Test

class WireframeStateTest {
    private fun rooms(role: PreviewRole = PreviewRole.FAN) = WireframeState(role = role).previewLink().previewRooms()
    private fun chat(role: PreviewRole = PreviewRole.FAN) = rooms(role).openRoom("sample-room-a")

    @Test fun previewCannotSkipLinkOrOpenUnknownRoom() {
        val initial = WireframeState()
        assertEquals(initial, initial.previewRooms())
        assertEquals(initial, initial.openRoom("sample-room-a"))
        assertEquals(rooms(), rooms().openRoom("unknown"))
        val empty = rooms().copy(scenario = ListScenario.EMPTY)
        assertEquals(empty, empty.openRoom("sample-room-a"))
    }
    @Test fun fanCannotSwitchToSharedOrChooseAnotherFan() {
        val fan = chat().editDraft("hello")
        assertEquals(fan, fan.changeAudience(PreviewAudience.SHARED))
        assertEquals(fan, fan.selectTarget("샘플 팬 B"))
        assertTrue(fan.canCompose)
    }
    @Test fun streamerMustChooseTargetAndDraftNeverMovesToAnotherAudience() {
        val initial = chat(PreviewRole.STREAMER)
        assertFalse(initial.canCompose)
        assertEquals("", initial.editDraft("unsafe").draft)
        val first = initial.selectTarget("샘플 팬 A").editDraft("private")
        assertTrue(first.canCompose)
        assertEquals("", first.selectTarget("샘플 팬 B").draft)
        val shared = first.changeAudience(PreviewAudience.SHARED)
        assertNull(shared.target)
        assertEquals("", shared.draft)
        assertTrue(shared.canCompose)
        assertFalse(shared.changeAudience(PreviewAudience.PRIVATE).canCompose)
    }
    @Test fun navigationAndRoleChangesClearRoomDrafts() {
        val draft = chat().editDraft("local only")
        assertEquals("local only", draft.open(PreviewPage.REPORT).back().draft)
        val next = draft.back().openRoom("sample-room-b")
        assertEquals("", next.draft)
        assertEquals("sample-room-b", next.roomId)
        assertEquals(WireframeState(role = PreviewRole.STREAMER), draft.switchRole(PreviewRole.STREAMER))
        assertEquals(WireframeState(), draft.back().back())
    }
    @Test fun settingsCannotBypassNavigationAndDraftIsBounded() {
        assertEquals(WireframeState(), WireframeState().open(PreviewPage.SETTINGS))
        assertEquals(PreviewPage.SETTINGS, rooms().open(PreviewPage.SETTINGS).open(PreviewPage.ACCOUNT).back().page)
        assertEquals(2000, chat().editDraft("a".repeat(3000)).draft.length)
    }
}
