package chat.rogi.rogichat.feature.channel.console

import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSongRequest
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSession
import chat.rogi.rogichat.channelport.core.model.song.PricingSettings
import chat.rogi.rogichat.channelport.core.model.song.SessionHistoryItem
import chat.rogi.rogichat.channelport.core.model.song.SessionSettings

enum class ConsoleTab {
    QUEUE, HISTORY, SETTINGS
}

enum class ConnectionStatus {
    CONNECTED, DISCONNECTED, RECONNECTING
}

data class ConsoleUiState(
    val session: ConsoleSession? = null,
    val sessionLoading: Boolean = true,
    val nowPlaying: ConsoleSongRequest? = null,
    val queue: List<ConsoleSongRequest> = emptyList(),
    val history: List<ConsoleSongRequest> = emptyList(),
    val settings: SessionSettings? = null,
    val pricingSettings: PricingSettings? = null,
    val categories: List<Category> = emptyList(),
    val activeTab: ConsoleTab = ConsoleTab.QUEUE,
    val connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED,
    val sessionHistory: List<SessionHistoryItem> = emptyList(),
    val isLoading: Boolean = false,
    val showManualAddSheet: Boolean = false,
    val error: String? = null,
) {
    val isSessionActive: Boolean get() = session?.status == "ACTIVE"
    val sessionId: Int? get() = session?.id
}

sealed interface ConsoleEvent {
    // Session
    data object StartSession : ConsoleEvent
    data object EndSession : ConsoleEvent
    data class CloneSession(val sourceSessionId: Int) : ConsoleEvent

    // Queue
    data class PlayNow(val requestId: Int) : ConsoleEvent
    data object PlayNext : ConsoleEvent
    data class SkipCurrent(val reason: String? = null) : ConsoleEvent
    data class DeleteRequest(val requestId: Int) : ConsoleEvent
    data class ReorderRequest(val requestId: Int, val newOrder: Int) : ConsoleEvent
    data object ClearQueue : ConsoleEvent

    // Settings
    data class UpdateSettings(val settings: SessionSettings) : ConsoleEvent
    data class UpdatePricingSettings(val pricingSettings: PricingSettings) : ConsoleEvent

    // Tab
    data class SwitchTab(val tab: ConsoleTab) : ConsoleEvent

    // Manual add
    data object ShowManualAdd : ConsoleEvent
    data object HideManualAdd : ConsoleEvent
    data class SubmitManualRequest(
        val rawArtist: String,
        val rawTitle: String,
        val songId: Int? = null,
        val rawMessage: String? = null,
    ) : ConsoleEvent

    // Misc
    data object Refresh : ConsoleEvent
    data object DismissError : ConsoleEvent
}

sealed interface ConsoleSideEffect {
    data class ShowMessage(val message: String) : ConsoleSideEffect
}
