package chat.rogi.rogichat.preview

import chat.rogi.rogichat.core.navigation.*
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
    @Test fun singleRoomAutoEntryOnlyHappensOnInitialPreviewBootstrap() {
        val chat = WireframeState().previewLink().previewRooms(singleRoom = true)
        assertEquals(PreviewPage.CHAT, chat.page)
        assertEquals(1, chat.visibleRooms.size)
        val list = chat.back()
        assertEquals(PreviewPage.ROOMS, list.page)
        assertEquals(PreviewPage.ROOMS, list.selectTab(AppTab.SETTINGS).selectTab(AppTab.TALKS).page)
        assertEquals(list, list.openRoom("sample-room-b"))
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
        assertEquals(PreviewPage.ROOMS, draft.back().back().page)
    }
    @Test fun tabsPreserveDraftButAccountStateChangesDiscardIt() {
        val original = chat().editDraft("local only")
        val returned = original.selectTab(AppTab.SETTINGS).selectTab(AppTab.TALKS)
        assertEquals(original, returned)
        assertEquals("", returned.switchAccess(ShellAccess.LINK_REQUIRED).draft)
        assertNull(returned.switchAccess(ShellAccess.BLOCKED).roomId)
    }
    @Test fun settingsCannotBypassNavigationAndDraftIsBounded() {
        assertEquals(PreviewPage.SETTINGS, WireframeState().open(PreviewPage.SETTINGS).page)
        assertEquals(PreviewPage.SETTINGS, rooms().open(PreviewPage.SETTINGS).open(PreviewPage.ACCOUNT).back().page)
        assertEquals(2000, chat().editDraft("a".repeat(3000)).draft.length)
    }
    @Test fun profileDraftSurvivesNavigationButNeverAccountSwitch() {
        val initial = rooms().selectTab(AppTab.SETTINGS).open(AppPage.PROFILE)
        val edited = initial.editProfile("temporary")
        assertEquals("temporary", edited.back().open(AppPage.PROFILE).profile.draft)
        assertEquals("temporary", edited.selectTab(AppTab.TALKS).selectTab(AppTab.SETTINGS).profile.draft)
        assertEquals(initial.profile.baseline, edited.discardProfile().profile.draft)
        assertEquals(initial.profile.baseline, edited.switchAccess(ShellAccess.LINK_REQUIRED).profile.draft)
        assertEquals(initial.profile.baseline, edited.switchRole(PreviewRole.STREAMER).profile.draft)
        assertEquals(initial.profile.baseline, rooms().editProfile("forged").profile.draft)
    }
}
