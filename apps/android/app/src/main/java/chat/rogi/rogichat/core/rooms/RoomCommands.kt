package chat.rogi.rogichat.core.rooms

import chat.rogi.rogichat.core.network.RoomId
import chat.rogi.rogichat.core.network.RoomScopeToken

enum class RoomAction { JOIN, LEAVE }
data class RoomCommandIntent(val scope: RoomsAccountScope, val roomId: RoomId, val action: RoomAction,
                             val cycle: RoomId, val membership: RoomScopeToken? = null)
enum class RoomCommandPhase { NONE, SENDING, RECONCILING, UNVERIFIED, VERIFIED }
enum class RoomCommandIssue(val message: String) {
    CONFLICT("현재 상태에서는 참여 상태를 변경할 수 없어요."),
    FORBIDDEN("이 대화에 대한 요청을 처리할 수 없어요."),
    NOT_FOUND("이 대화를 확인할 수 없어요."),
    REJECTED("요청을 처리하지 못했어요."),
    STORAGE("기기에 참여 상태를 저장하지 못했어요. 저장 공간을 확인해 주세요."),
    UNKNOWN("요청 결과를 확정하지 못했어요. 참여 상태는 마지막으로 확인한 상태예요.")
}
enum class RoomVerificationIssue(val message: String) {
    STORAGE("기기에 참여 상태를 저장하지 못했어요. 저장 공간을 확인해 주세요."),
    UNAVAILABLE("참여 상태를 확인하지 못했어요. 다시 확인해 주세요.")
}
data class RoomCommandState(val scope: RoomsAccountScope? = null, val phase: RoomCommandPhase = RoomCommandPhase.NONE,
                            val action: RoomAction? = null, val issue: RoomCommandIssue? = null,
                            val directory: RoomDirectory? = null, val verificationIssue: RoomVerificationIssue? = null) {
    val busy get() = phase == RoomCommandPhase.SENDING || phase == RoomCommandPhase.RECONCILING
    val needsVerification get() = phase == RoomCommandPhase.UNVERIFIED
}
class RoomCommandInProgress : Exception("room_command_in_progress")
class StaleRoomSelection : Exception("room_selection_changed")
