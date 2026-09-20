package chat.rogi.rogichat.preview

// UI-only state. This type must never become a session, repository, or API DTO.
enum class PreviewRole(val label: String) { FAN("팬"), STREAMER("스트리머") }
enum class PreviewPage(val title: String) {
    WELCOME("로기챗 QA"), LINK("SOOP 계정 연결"), ROOMS("대화"), CHAT("대화방"),
    SETTINGS("설정"), PROFILE("내 프로필"), ACCOUNT("계정 관리"), REPORT("신고 및 차단")
}
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
    val page: PreviewPage = PreviewPage.WELCOME,
    val linkPreviewPassed: Boolean = false,
    val roomId: String? = null,
    val scenario: ListScenario = ListScenario.CONTENT,
    val audience: PreviewAudience = PreviewAudience.PRIVATE,
    val target: String? = null,
    val draft: String = "",
) {
    fun switchRole(value: PreviewRole) = if (value == role) this else WireframeState(role = value)
    fun previewLink() = if (page == PreviewPage.WELCOME) copy(page = PreviewPage.LINK) else this
    fun previewRooms() = if (page == PreviewPage.LINK) copy(page = PreviewPage.ROOMS, linkPreviewPassed = true) else this
    fun openRoom(id: String): WireframeState {
        if (!linkPreviewPassed || page != PreviewPage.ROOMS || scenario != ListScenario.CONTENT ||
            WireframeFixtures.rooms.none { it.id == id }) return this
        return copy(page = PreviewPage.CHAT, roomId = id, draft = "", target = null, audience = PreviewAudience.PRIVATE)
    }
    fun open(value: PreviewPage): WireframeState = when {
        value == PreviewPage.SETTINGS && page == PreviewPage.ROOMS -> copy(page = value)
        value in listOf(PreviewPage.PROFILE, PreviewPage.ACCOUNT) && page == PreviewPage.SETTINGS -> copy(page = value)
        value == PreviewPage.REPORT && page == PreviewPage.CHAT -> copy(page = value)
        else -> this
    }
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
    fun editDraft(value: String) = if (canCompose) copy(draft = value.take(2000)) else this
    fun back(): WireframeState = when (page) {
        PreviewPage.WELCOME -> this
        PreviewPage.LINK, PreviewPage.ROOMS -> WireframeState(role = role)
        PreviewPage.CHAT -> copy(page = PreviewPage.ROOMS, roomId = null, draft = "", target = null)
        PreviewPage.SETTINGS -> copy(page = PreviewPage.ROOMS)
        PreviewPage.PROFILE, PreviewPage.ACCOUNT -> copy(page = PreviewPage.SETTINGS)
        PreviewPage.REPORT -> copy(page = PreviewPage.CHAT)
    }
}
