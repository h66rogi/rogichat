package chat.rogi.rogichat.feature.channel.console

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import chat.rogi.rogichat.channelport.core.domain.repository.ChannelRepository
import chat.rogi.rogichat.channelport.core.domain.repository.ConsoleSongLiveSocketService
import chat.rogi.rogichat.channelport.core.domain.repository.ConsoleSocketEvent
import chat.rogi.rogichat.channelport.core.domain.repository.SessionRepository
import chat.rogi.rogichat.channelport.core.domain.repository.SongPricingRepository
import chat.rogi.rogichat.channelport.core.domain.repository.SongRepository
import chat.rogi.rogichat.channelport.core.domain.repository.SongRequestRepository
import chat.rogi.rogichat.channelport.core.model.song.Song
import chat.rogi.rogichat.channelport.core.model.song.CreateManualRequestPayload
import chat.rogi.rogichat.channelport.core.model.song.StartSessionPayload
import chat.rogi.rogichat.channelport.core.model.song.UpdatePricingSettingsPayload
import chat.rogi.rogichat.channelport.core.model.song.UpdateSettingsPayload
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber

class ConsoleViewModel constructor(
    savedStateHandle: SavedStateHandle,
    private val channelRepository: ChannelRepository,
    private val sessionRepository: SessionRepository,
    private val songRequestRepository: SongRequestRepository,
    private val songPricingRepository: SongPricingRepository,
    private val songRepository: SongRepository,
    private val consoleSongLiveSocketService: ConsoleSongLiveSocketService,
) : ViewModel() {

    private val channelIdentifier: String = checkNotNull(savedStateHandle["channelIdentifier"])
    private val channelId: Int = checkNotNull(savedStateHandle["channelId"])
    private var detectedPlatform: String = "OTHER"

    private val _uiState = MutableStateFlow(ConsoleUiState())
    val uiState: StateFlow<ConsoleUiState> = _uiState.asStateFlow()

    private val _sideEffect = Channel<ConsoleSideEffect>()
    val sideEffect = _sideEffect.receiveAsFlow()

    private var socketJob: Job? = null
    private var pollingJob: Job? = null

    fun getChannelId(): Int = channelId

    suspend fun searchSongs(query: String): List<Song> {
        if (query.isBlank()) return emptyList()
        return songRepository.getSongs(
            channelId = channelId,
            page = 1,
            limit = 20,
            search = query,
        ).getOrNull()?.songs ?: emptyList()
    }

    init {
        loadInitialData()
    }

    fun onEvent(event: ConsoleEvent) {
        when (event) {
            is ConsoleEvent.StartSession -> startSession()
            is ConsoleEvent.EndSession -> endSession()
            is ConsoleEvent.CloneSession -> cloneSession(event.sourceSessionId)
            is ConsoleEvent.PlayNow -> playNow(event.requestId)
            is ConsoleEvent.PlayNext -> playNext()
            is ConsoleEvent.SkipCurrent -> skipCurrent(event.reason)
            is ConsoleEvent.DeleteRequest -> deleteRequest(event.requestId)
            is ConsoleEvent.ReorderRequest -> reorderRequest(event.requestId, event.newOrder)
            is ConsoleEvent.ClearQueue -> clearQueue()
            is ConsoleEvent.UpdateSettings -> updateSettings(event.settings)
            is ConsoleEvent.UpdatePricingSettings -> updatePricingSettings(event.pricingSettings)
            is ConsoleEvent.SwitchTab -> switchTab(event.tab)
            is ConsoleEvent.ShowManualAdd -> _uiState.update { it.copy(showManualAddSheet = true) }
            is ConsoleEvent.HideManualAdd -> _uiState.update { it.copy(showManualAddSheet = false) }
            is ConsoleEvent.SubmitManualRequest -> submitManualRequest(event.rawArtist, event.rawTitle, event.songId, event.rawMessage)
            is ConsoleEvent.Refresh -> loadInitialData()
            is ConsoleEvent.DismissError -> _uiState.update { it.copy(error = null) }
        }
    }

    private fun loadInitialData() {
        viewModelScope.launch {
            _uiState.update { it.copy(sessionLoading = true) }

            // Detect platform from channel verifications
            channelRepository.getChannel(channelIdentifier).onSuccess { channel ->
                channel.verifications?.firstOrNull()?.let {
                    detectedPlatform = it.platform
                }
            }

            sessionRepository.getActiveSession(channelIdentifier).onSuccess { session ->
                _uiState.update { it.copy(session = session, sessionLoading = false) }

                if (session != null && session.status == "ACTIVE") {
                    _uiState.update { it.copy(settings = session.settings) }
                    loadQueueData(session.id)
                    loadPricingSettings()
                    loadCategories()
                    connectSocket()
                } else {
                    loadSessionHistory()
                }
            }.onFailure { e ->
                _uiState.update { it.copy(sessionLoading = false, error = e.message) }
                loadSessionHistory()
            }
        }
    }

    private fun loadQueueData(sessionId: Int) {
        viewModelScope.launch {
            // Load queue (pending only)
            songRequestRepository.getConsoleQueue(sessionId, includeCompleted = false).onSuccess { queue ->
                _uiState.update { it.copy(queue = queue) }
            }
            // Load now playing
            songRequestRepository.getNowPlaying(sessionId).onSuccess { nowPlaying ->
                _uiState.update { it.copy(nowPlaying = nowPlaying) }
            }
        }
    }

    private fun loadHistory() {
        val sessionId = _uiState.value.sessionId ?: return
        viewModelScope.launch {
            songRequestRepository.getConsoleQueue(sessionId, includeCompleted = true).onSuccess { all ->
                val history = all.filter { it.isCompleted || it.isRejected }
                _uiState.update { it.copy(history = history) }
            }
        }
    }

    private fun loadSessionHistory() {
        viewModelScope.launch {
            sessionRepository.getSessionHistory(channelIdentifier, page = 1, limit = 5).onSuccess { response ->
                _uiState.update { it.copy(sessionHistory = response.sessions) }
            }
        }
    }

    private fun cloneSession(sourceSessionId: Int) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            sessionRepository.cloneSession(sourceSessionId, channelIdentifier).onSuccess { session ->
                _uiState.update {
                    it.copy(session = session, settings = session.settings, isLoading = false)
                }
                loadQueueData(session.id)
                loadPricingSettings()
                loadCategories()
                connectSocket()
                _sideEffect.send(ConsoleSideEffect.ShowMessage("이전 세션이 복원되었습니다"))
            }.onFailure { e ->
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    private fun loadCategories() {
        viewModelScope.launch {
            songRepository.getCategories(channelIdentifier).onSuccess { categories ->
                _uiState.update { it.copy(categories = categories) }
            }
        }
    }

    private fun loadPricingSettings() {
        viewModelScope.launch {
            songPricingRepository.getPricingSettings(channelId).onSuccess { pricing ->
                _uiState.update { it.copy(pricingSettings = pricing) }
            }
        }
    }

    private fun connectSocket() {
        socketJob?.cancel()
        socketJob = viewModelScope.launch {
            consoleSongLiveSocketService.connect(channelIdentifier).collect { event ->
                when (event) {
                    is ConsoleSocketEvent.Connected -> {
                        _uiState.update { it.copy(connectionStatus = ConnectionStatus.CONNECTED) }
                        cancelPolling()
                    }
                    is ConsoleSocketEvent.Disconnected -> {
                        _uiState.update { it.copy(connectionStatus = ConnectionStatus.DISCONNECTED) }
                        startPolling()
                    }
                    is ConsoleSocketEvent.Reconnecting -> {
                        _uiState.update { it.copy(connectionStatus = ConnectionStatus.RECONNECTING) }
                    }
                    is ConsoleSocketEvent.RequestAdded,
                    is ConsoleSocketEvent.RequestUpdated,
                    is ConsoleSocketEvent.QueueReordered -> {
                        val sid = _uiState.value.sessionId ?: return@collect
                        loadQueueData(sid)
                    }
                    is ConsoleSocketEvent.RequestRemoved -> {
                        val sid = _uiState.value.sessionId ?: return@collect
                        loadQueueData(sid)
                    }
                    is ConsoleSocketEvent.SettingsUpdated -> {
                        // Refresh session to get updated settings
                        sessionRepository.getActiveSession(channelIdentifier).onSuccess { session ->
                            if (session != null) {
                                _uiState.update { it.copy(session = session, settings = session.settings) }
                            }
                        }
                    }
                    is ConsoleSocketEvent.SessionStarted -> {
                        loadInitialData()
                    }
                    is ConsoleSocketEvent.SessionEnded -> {
                        _uiState.update {
                            it.copy(
                                session = it.session?.copy(status = "ENDED"),
                                nowPlaying = null,
                                queue = emptyList(),
                            )
                        }
                        socketJob?.cancel()
                    }
                }
            }
        }
    }

    private fun startPolling() {
        if (pollingJob?.isActive == true) return
        pollingJob = viewModelScope.launch {
            while (true) {
                delay(5_000)
                val sid = _uiState.value.sessionId ?: break
                loadQueueData(sid)
            }
        }
    }

    private fun cancelPolling() {
        pollingJob?.cancel()
        pollingJob = null
    }

    private fun startSession() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            sessionRepository.startSession(StartSessionPayload(platform = detectedPlatform)).onSuccess { session ->
                _uiState.update {
                    it.copy(session = session, settings = session.settings, isLoading = false)
                }
                loadQueueData(session.id)
                loadPricingSettings()
                connectSocket()
            }.onFailure { e ->
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    private fun endSession() {
        val sessionId = _uiState.value.sessionId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            sessionRepository.endSession(sessionId).onSuccess {
                _uiState.update {
                    it.copy(
                        session = it.session?.copy(status = "ENDED"),
                        nowPlaying = null,
                        queue = emptyList(),
                        isLoading = false,
                    )
                }
                socketJob?.cancel()
                cancelPolling()
                _sideEffect.send(ConsoleSideEffect.ShowMessage("세션이 종료되었습니다"))
            }.onFailure { e ->
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    private fun playNow(requestId: Int) {
        viewModelScope.launch {
            songRequestRepository.playNow(requestId).onSuccess { playing ->
                _uiState.update { state ->
                    state.copy(
                        nowPlaying = playing,
                        queue = state.queue.filter { it.id != requestId },
                    )
                }
            }.onFailure { e ->
                _sideEffect.send(ConsoleSideEffect.ShowMessage(e.message ?: "오류가 발생했습니다"))
            }
        }
    }

    private fun playNext() {
        val sessionId = _uiState.value.sessionId ?: return
        viewModelScope.launch {
            songRequestRepository.playNext(sessionId).onSuccess { next ->
                _uiState.update { state ->
                    state.copy(
                        nowPlaying = next,
                        queue = if (next != null) state.queue.filter { it.id != next.id } else state.queue,
                    )
                }
            }.onFailure { e ->
                _sideEffect.send(ConsoleSideEffect.ShowMessage(e.message ?: "오류가 발생했습니다"))
                loadQueueData(sessionId)
            }
        }
    }

    private fun skipCurrent(reason: String?) {
        val sessionId = _uiState.value.sessionId ?: return
        viewModelScope.launch {
            songRequestRepository.skipCurrent(sessionId, reason).onSuccess { next ->
                _uiState.update { it.copy(nowPlaying = next) }
            }.onFailure { e ->
                _sideEffect.send(ConsoleSideEffect.ShowMessage(e.message ?: "오류가 발생했습니다"))
                loadQueueData(sessionId)
            }
        }
    }

    private fun deleteRequest(requestId: Int) {
        viewModelScope.launch {
            // Optimistic remove
            val previousQueue = _uiState.value.queue
            _uiState.update { state ->
                state.copy(queue = state.queue.filter { it.id != requestId })
            }
            songRequestRepository.deleteRequest(requestId).onFailure {
                // Rollback
                _uiState.update { it.copy(queue = previousQueue) }
                _sideEffect.send(ConsoleSideEffect.ShowMessage("삭제에 실패했습니다"))
            }
        }
    }

    private fun reorderRequest(requestId: Int, newOrder: Int) {
        viewModelScope.launch {
            songRequestRepository.updateOrder(requestId, newOrder).onFailure { e ->
                _sideEffect.send(ConsoleSideEffect.ShowMessage(e.message ?: "순서 변경에 실패했습니다"))
                // Refresh queue to get correct order
                val sid = _uiState.value.sessionId ?: return@launch
                loadQueueData(sid)
            }
        }
    }

    private fun clearQueue() {
        val sessionId = _uiState.value.sessionId ?: return
        viewModelScope.launch {
            songRequestRepository.clearQueue(sessionId).onSuccess { response ->
                _uiState.update { it.copy(queue = emptyList()) }
                _sideEffect.send(ConsoleSideEffect.ShowMessage(response.message))
            }.onFailure { e ->
                _sideEffect.send(ConsoleSideEffect.ShowMessage(e.message ?: "초기화에 실패했습니다"))
            }
        }
    }

    private fun updateSettings(settings: chat.rogi.rogichat.channelport.core.model.song.SessionSettings) {
        val sessionId = _uiState.value.sessionId ?: return
        viewModelScope.launch {
            val payload = UpdateSettingsPayload(
                requestEnabled = settings.requestEnabled,
                paused = settings.paused,
                maxQueueSize = settings.maxQueueSize,
                requireSongMatch = settings.requireSongMatch,
                preventDuplicateSongs = settings.preventDuplicateSongs,
                maxRequestsPerUser = settings.maxRequestsPerUser,
                maxTotalRequests = settings.maxTotalRequests,
                blockedCategoryIds = settings.blockedCategoryIds,
                karaokePlaybackMode = settings.karaokePlaybackMode,
                karaokeVideoType = settings.karaokeVideoType,
                showRequesterName = settings.showRequesterName,
            )
            sessionRepository.updateSettings(sessionId, payload).onSuccess { updated ->
                _uiState.update { it.copy(settings = updated) }
            }.onFailure { e ->
                _sideEffect.send(ConsoleSideEffect.ShowMessage(e.message ?: "설정 변경에 실패했습니다"))
            }
        }
    }

    private fun updatePricingSettings(pricing: chat.rogi.rogichat.channelport.core.model.song.PricingSettings) {
        viewModelScope.launch {
            val payload = UpdatePricingSettingsPayload(
                pricingEnabled = pricing.pricingEnabled,
                defaultPrice = pricing.defaultPrice,
                defaultPrices = pricing.defaultPrices,
                difficultyPrices = pricing.difficultyPrices,
                difficultyPricesByCurrency = pricing.difficultyPricesByCurrency,
                currencyConfigs = pricing.currencyConfigs.map {
                    chat.rogi.rogichat.channelport.core.model.song.CurrencyConfigDto(
                        key = it.key, unit = it.unit, amount = it.amount
                    )
                },
            )
            songPricingRepository.updatePricingSettings(channelId, payload).onSuccess { updated ->
                _uiState.update { it.copy(pricingSettings = updated) }
            }.onFailure { e ->
                _sideEffect.send(ConsoleSideEffect.ShowMessage(e.message ?: "참고 가격 설정 변경에 실패했습니다"))
            }
        }
    }

    private fun switchTab(tab: ConsoleTab) {
        _uiState.update { it.copy(activeTab = tab) }
        if (tab == ConsoleTab.HISTORY && _uiState.value.history.isEmpty()) {
            loadHistory()
        }
    }

    private fun submitManualRequest(rawArtist: String, rawTitle: String, songId: Int?, rawMessage: String?) {
        val sessionId = _uiState.value.sessionId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            sessionRepository.createManualRequest(
                sessionId,
                CreateManualRequestPayload(
                    rawArtist = rawArtist,
                    rawTitle = rawTitle,
                    songId = songId,
                    rawMessage = rawMessage,
                )
            ).onSuccess {
                _uiState.update { it.copy(showManualAddSheet = false, isLoading = false) }
                _sideEffect.send(ConsoleSideEffect.ShowMessage("신청곡이 추가되었습니다"))
            }.onFailure { e ->
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    override fun onCleared() {
        socketJob?.cancel()
        cancelPolling()
    }
}
