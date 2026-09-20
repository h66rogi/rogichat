package chat.rogi.rogichat.feature.settings

enum class NotificationAuthorization { NOT_REQUESTED, DENIED, ALLOWED, QUIET, TEMPORARY, UNKNOWN }
data class NotificationSnapshot(val authorization: NotificationAuthorization, val alertsEnabled: Boolean? = null,
                                val blockedChannels: Int? = null, val hasChannels: Boolean? = null) {
    val description: String get() = when (authorization) {
        NotificationAuthorization.NOT_REQUESTED -> "이 기기에서 아직 권한을 요청하지 않았어요"
        NotificationAuthorization.DENIED -> "이 기기에서 알림이 허용되지 않았어요"
        NotificationAuthorization.QUIET -> "조용한 알림만 임시 허용되어 있어요"
        NotificationAuthorization.TEMPORARY -> "일시적으로 알림이 허용되어 있어요"
        NotificationAuthorization.UNKNOWN -> "기기 설정에서 알림 상태를 확인해 주세요"
        NotificationAuthorization.ALLOWED -> when {
            alertsEnabled == false -> "기기 알림 허용 · 알림 표시는 꺼짐"
            hasChannels == false -> "기기 알림 허용 · 서비스 알림 채널은 아직 없어요"
            blockedChannels != null -> "기기 알림 허용 · 차단된 채널 ${blockedChannels}개"
            else -> "기기 알림 허용 · 알림 표시 켜짐"
        }
    }
}
data class NotificationReadState(val revision: Long = 0, val observing: Boolean = false,
                                 val reading: Boolean = false, val snapshot: NotificationSnapshot? = null,
                                 val failed: Boolean = false) {
    fun begin() = copy(revision = revision + 1, observing = true, reading = true, failed = false)
    fun finish(ticket: Long, value: NotificationSnapshot) =
        if (reading && ticket == revision) copy(reading = false, snapshot = value, failed = false) else this
    fun fail(ticket: Long) = if (reading && ticket == revision) copy(reading = false, snapshot = null, failed = true) else this
    fun cancel() = copy(revision = revision + 1, reading = false)
}
