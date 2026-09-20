package chat.rogi.rogichat.preview

import chat.rogi.rogichat.core.navigation.*
import chat.rogi.rogichat.feature.settings.*

// UI-only state. This type must never become a session, repository, or API DTO.
enum class PreviewRole(val label: String) { FAN("팬"), STREAMER("스트리머") }
typealias PreviewPage = AppPage
enum class ListScenario(val label: String) { CONTENT("목록"), LOADING("로딩"), EMPTY("빈 목록"), ERROR("오류") }
enum class PreviewAudience(val label: String) { PRIVATE("개인 답장"), SHARED("전체 대화") }
data class SampleRoom(val id: String, val title: String, val summary: String)

object WireframeFixtures {
    val rooms = listOf(
        SampleRoom("sample-room-a", "샘플 스트리머 A", "함께 나누는 오늘의 이야기"),
        SampleRoom("sample-room-b", "샘플 스트리머 B", "다음 대화를 기다리고 있어요"),
    )
    val fans = listOf("샘플 팬 A", "샘플 팬 B")
}

data class WireframeState(
    val role: PreviewRole = PreviewRole.FAN,
    val navigation: ShellNavigation = ShellNavigation(),
    val roomId: String? = null,
    val singleRoomMode: Boolean = false,
    val scenario: ListScenario = ListScenario.CONTENT,
    val audience: PreviewAudience = PreviewAudience.PRIVATE,
    val target: String? = null,
    val draft: String = "",
    val profile: ProfileEditor = ProfileEditor("샘플 프로필"),
) {
    val page: AppPage get() = navigation.page
    val linkPreviewPassed: Boolean get() = navigation.access == ShellAccess.READY
    fun switchAccess(value: ShellAccess) = WireframeState(role = role, navigation = navigation.withAccess(value))
    fun selectTab(value: AppTab) = copy(navigation = navigation.selectTab(value))
    fun switchRole(value: PreviewRole) = if (value == role) this else WireframeState(role = value)
    fun previewLink() = if (page == PreviewPage.WELCOME) switchAccess(ShellAccess.LINK_REQUIRED) else this
    val visibleRooms: List<SampleRoom> get() = if (singleRoomMode) WireframeFixtures.rooms.take(1) else WireframeFixtures.rooms
    fun previewRooms(singleRoom: Boolean = false): WireframeState {
        if (page != PreviewPage.LINK) return this
        val next = switchAccess(ShellAccess.READY).copy(singleRoomMode = singleRoom)
        return if (singleRoom) next.openRoom(next.visibleRooms.first().id) else next
    }
    fun openRoom(id: String): WireframeState {
        if (!linkPreviewPassed || page != PreviewPage.ROOMS || scenario != ListScenario.CONTENT ||
            visibleRooms.none { it.id == id }) return this
        return copy(navigation = navigation.open(AppPage.CHAT), roomId = id, draft = "", target = null, audience = PreviewAudience.PRIVATE)
    }
    fun open(value: PreviewPage) = copy(navigation = navigation.open(value))
    fun changeAudience(value: PreviewAudience): WireframeState {
        if (role != PreviewRole.STREAMER || page != PreviewPage.CHAT) return this
        // A draft must never silently move to a different recipient/audience.
        return if (value == audience) this else copy(audience = value, target = null, draft = "")
    }
    fun selectTarget(value: String): WireframeState {
        if (role != PreviewRole.STREAMER || page != PreviewPage.CHAT || value !in WireframeFixtures.fans) return this
        return if (target == value && audience == PreviewAudience.PRIVATE) this
        else copy(audience = PreviewAudience.PRIVATE, target = value, draft = "")
    }
    val canCompose: Boolean get() = page == PreviewPage.CHAT && roomId != null &&
        (role == PreviewRole.FAN || audience == PreviewAudience.SHARED || target != null)
    fun editProfile(value: String) = if (page == AppPage.PROFILE) copy(profile = profile.edit(value)) else this
    fun discardProfile() = if (page == AppPage.PROFILE) copy(profile = profile.discard()) else this
    fun profilePhase(value: ProfilePhase) = if (page == AppPage.PROFILE) copy(profile = profile.copy(phase = value)) else this
    fun editDraft(value: String) = if (canCompose) copy(draft = value.take(2000)) else this
    fun back(): WireframeState {
        val next = navigation.back()
        return if (AppPage.CHAT !in next.talkPath) copy(navigation = next, roomId = null, draft = "", target = null)
        else copy(navigation = next)
    }
}
