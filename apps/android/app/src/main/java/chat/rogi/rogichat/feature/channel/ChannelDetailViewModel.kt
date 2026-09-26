package chat.rogi.rogichat.feature.channel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import chat.rogi.rogichat.channelport.core.domain.repository.ChannelSession
import chat.rogi.rogichat.channelport.core.domain.repository.ChannelRepository
import chat.rogi.rogichat.channelport.core.domain.repository.FavoriteRepository
import chat.rogi.rogichat.channelport.core.domain.repository.SongPricingRepository
import chat.rogi.rogichat.channelport.core.domain.repository.ScheduleRepository
import chat.rogi.rogichat.channelport.core.domain.repository.SongLiveSocketEvent
import chat.rogi.rogichat.channelport.core.domain.repository.SongLiveSocketService
import chat.rogi.rogichat.channelport.core.domain.repository.SongRepository
import chat.rogi.rogichat.channelport.core.domain.repository.SongRequestRepository
import chat.rogi.rogichat.channelport.core.model.song.CreateSongRequestPayload
import chat.rogi.rogichat.channelport.core.model.song.PublicLiveSession
import chat.rogi.rogichat.channelport.core.model.song.Song
import chat.rogi.rogichat.channelport.core.network.dto.UpdateScheduleRequest
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import timber.log.Timber
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.ZoneId

class ChannelDetailViewModel constructor(
    savedStateHandle: SavedStateHandle,
    private val channelRepository: ChannelRepository,
    private val songRepository: SongRepository,
    private val scheduleRepository: ScheduleRepository,
    private val favoriteRepository: FavoriteRepository,
    // Exposed for ChannelTalkSection's non-Hilt ViewModel factory — see ChannelTalkViewModel
    internal val authRepository: ChannelSession,
    private val songRequestRepository: SongRequestRepository,
    private val songLiveSocketService: SongLiveSocketService,
    private val songPricingRepository: SongPricingRepository,
    val setlistRepository: chat.rogi.rogichat.channelport.ChannelSetlistRepository,
) : ViewModel() {

    private val channelIdentifier: String = checkNotNull(savedStateHandle["channelIdentifier"])

    private val _uiState = MutableStateFlow(ChannelDetailUiState())
    val uiState: StateFlow<ChannelDetailUiState> = _uiState.asStateFlow()

    val isLoggedIn: StateFlow<Boolean> = authRepository.isLoggedIn
    val currentUserId: Int? get() = authRepository.currentUser.value?.id
    val isIdentityVerified: Boolean get() = authRepository.currentUser.value?.isIdentityVerified == true
    private val _shareEvent = MutableSharedFlow<String>()
    val shareEvent = _shareEvent.asSharedFlow()

    private val _messageEvent = MutableSharedFlow<String>()
    val messageEvent = _messageEvent.asSharedFlow()


    private var currentPage = 1
    private val pageSize = 30
    private var guestbookPage = 1
    private val guestbookPageSize = 20
    private var currentYearMonth = LocalDate.now()
    private var liveRequestPollingJob: Job? = null
    private var socketJob: Job? = null
    private var wardrobeLoaded = false
    private var latestFeatureSettingItems:
        List<chat.rogi.rogichat.channelport.core.model.channel.ChannelFeatureSettingItem>? = null

    companion object {
        private const val LIVE_REQUEST_POLL_INTERVAL_MS = 30_000L
    }



    init {
        loadChannel()
    }

    fun refreshCurrentUser() {
        viewModelScope.launch {
            authRepository.getCurrentUser()
        }
    }





    fun onEvent(event: ChannelDetailEvent) {
        when (event) {
            is ChannelDetailEvent.TabSelected -> selectTab(event.tab)
            ChannelDetailEvent.ToggleFavorite -> toggleFavorite()
            ChannelDetailEvent.Share -> shareChannel()
            ChannelDetailEvent.Refresh -> loadChannel()
            ChannelDetailEvent.ErrorDismissed -> {
                _uiState.update { it.copy(error = null) }
            }
            is ChannelDetailEvent.SongSearchChanged -> searchSongs(event.query)
            is ChannelDetailEvent.CategorySelected -> selectCategory(event.category)
            ChannelDetailEvent.ToggleFavoritesOnly -> toggleFavoritesOnly()
            is ChannelDetailEvent.ToggleSongFavorite -> toggleSongFavorite(event.song)
            ChannelDetailEvent.LoadMoreSongs -> loadMoreSongs()
            is ChannelDetailEvent.SongSelected -> selectSong(event.song)
            ChannelDetailEvent.SongDetailDismissed -> dismissSongDetail()
            ChannelDetailEvent.RefreshSongbook -> refreshSongbook()
            is ChannelDetailEvent.SongRequestSubmit -> requestSong(event.song)
            ChannelDetailEvent.LoginDialogDismissed -> {
                _uiState.update { it.copy(showLoginRequiredDialog = false) }
            }

            ChannelDetailEvent.ShowLiveRequestSheet -> {
                _uiState.update {
                    it.copy(songbookState = it.songbookState.copy(showLiveRequestSheet = true))
                }
                fetchQueue()
            }
            ChannelDetailEvent.DismissLiveRequestSheet -> {
                _uiState.update {
                    it.copy(songbookState = it.songbookState.copy(showLiveRequestSheet = false))
                }
            }
            // Filter events
            ChannelDetailEvent.ShowFilterSheet -> showFilterSheet()
            ChannelDetailEvent.DismissFilterSheet -> dismissFilterSheet()
            is ChannelDetailEvent.ArtistSelected -> selectArtist(event.artist)
            is ChannelDetailEvent.DifficultySelected -> selectDifficulty(event.difficulty)
            ChannelDetailEvent.ClearFilters -> clearFilters()
            ChannelDetailEvent.ApplyFilters -> applyFilters()
            // Sort events
            ChannelDetailEvent.ShowSortSheet -> showSortSheet()
            ChannelDetailEvent.DismissSortSheet -> dismissSortSheet()
            is ChannelDetailEvent.SortOptionSelected -> selectSortOption(event.option)
            // Schedule events
            ChannelDetailEvent.PreviousMonth -> changeMonth(-1)
            ChannelDetailEvent.NextMonth -> changeMonth(1)
            ChannelDetailEvent.RefreshSchedule -> refreshSchedule()
            is ChannelDetailEvent.ScheduleSelected -> {
                _uiState.update {
                    it.copy(
                        scheduleState = it.scheduleState.copy(
                            selectedSchedule = event.schedule,
                            showDetailSheet = true,
                        ),
                    )
                }
            }
            ChannelDetailEvent.DismissScheduleDetail -> {
                _uiState.update {
                    it.copy(
                        scheduleState = it.scheduleState.copy(
                            showDetailSheet = false,
                            selectedSchedule = null,
                        ),
                    )
                }
            }
            ChannelDetailEvent.ShowEditSchedule -> {
                _uiState.update {
                    it.copy(
                        scheduleState = it.scheduleState.copy(
                            showDetailSheet = false,
                            showEditSheet = true,
                        ),
                    )
                }
            }
            ChannelDetailEvent.DismissEditSchedule -> {
                _uiState.update {
                    it.copy(
                        scheduleState = it.scheduleState.copy(
                            showEditSheet = false,
                            selectedSchedule = null,
                        ),
                    )
                }
            }
            ChannelDetailEvent.ShowDeleteScheduleDialog -> {
                _uiState.update {
                    it.copy(
                        scheduleState = it.scheduleState.copy(showDeleteDialog = true),
                    )
                }
            }
            ChannelDetailEvent.DismissDeleteScheduleDialog -> {
                _uiState.update {
                    it.copy(
                        scheduleState = it.scheduleState.copy(showDeleteDialog = false),
                    )
                }
            }
            ChannelDetailEvent.ConfirmDeleteSchedule -> {
                _uiState.update {
                    it.copy(
                        scheduleState = it.scheduleState.copy(showDeleteDialog = false),
                    )
                }
                deleteSchedule()
            }
        }
    }

    private fun loadChannel() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            // 신청곡 상태를 채널 정보와 병렬로 fetch (UI 깜빡임 방지)
            val liveRequestJob = launch { fetchLiveRequestState(showLoading = false) }

            channelRepository.getChannel(channelIdentifier)
                .onSuccess { channel ->
                    // 신청곡 상태가 완료될 때까지 대기 후 UI 표시
                    liveRequestJob.join()

                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            channel = channel,
                            favoritesCount = channel.favoritesCount,
                        )
                    }
                    loadFeatureSettings()
                    loadFavoriteStatus(channel.id)
                    loadFavoritesCount(channel.id)
                    loadPermission()
                    loadSongs()
                    loadCategories()
                    loadArtists()
                    initSchedule()
                    loadProfile(channel.id)
                    loadPricingSettings(channel.id)
                    startLiveRequestPolling()
                    connectToSongLiveSocket()
                }
                .onFailure { exception ->
                    liveRequestJob.cancel()
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = exception.message ?: "채널을 불러오는데 실패했습니다",
                        )
                    }
                }
        }
    }

    private fun loadFavoriteStatus(channelId: Int) {
        viewModelScope.launch {
            favoriteRepository.isFavoriteChannel(channelId)
                .onSuccess { isFavorite ->
                    _uiState.update { it.copy(isFavorite = isFavorite) }
                }
        }
    }

    private fun loadFavoritesCount(channelId: Int) {
        viewModelScope.launch {
            favoriteRepository.getFavoriteChannelCount(channelId)
                .onSuccess { count ->
                    _uiState.update { it.copy(favoritesCount = count) }
                }
        }
    }

    private fun loadPermission() {
        viewModelScope.launch {
            channelRepository.getChannelPermission(channelIdentifier)
                .onSuccess { permission ->
                    _uiState.update { it.copy(permission = permission) }
                }
        }
    }

    private fun selectTab(tab: ChannelTab) {
        _uiState.update { it.copy(selectedTab = tab) }
        if (tab == ChannelTab.WARDROBE && !wardrobeLoaded) loadWardrobe()
    }

    /**
     * feature-settings 기반 탭 노출/순서/라벨 동적화 (웹 getConfiguredTabItems 대응).
     * 실패 시 기존 하드코딩 순서 폴백 (무중단).
     */
    private fun loadFeatureSettings() {
        viewModelScope.launch {
            channelRepository.getChannelFeatureSettings(channelIdentifier)
                .onSuccess { response ->
                    latestFeatureSettingItems = response.items
                    applyFeatureSettings(response.items)
                }
                .onFailure {
                    latestFeatureSettingItems = null
                    applyFeatureSettings(null)
                }
        }
    }

    private fun applyFeatureSettings(
        items: List<chat.rogi.rogichat.channelport.core.model.channel.ChannelFeatureSettingItem>?,
    ) {
        if (items.isNullOrEmpty()) {
            val fallbackTabs = DEFAULT_CHANNEL_TABS
            _uiState.update { state ->
                val selected = state.selectedTab.takeIf { it in fallbackTabs }
                    ?: fallbackTabs.firstOrNull()
                    ?: ChannelTab.SONGBOOK
                state.copy(
                    visibleTabs = fallbackTabs,
                    tabLabels = emptyMap(),
                    selectedTab = selected,
                )
            }
            return
        }
        val keyToTab = mapOf(
            "setlist" to ChannelTab.SETLIST,
            chat.rogi.rogichat.channelport.core.model.channel.ChannelFeatureKeys.WARDROBE to ChannelTab.WARDROBE,
            chat.rogi.rogichat.channelport.core.model.channel.ChannelFeatureKeys.MUSICBOOK to ChannelTab.SONGBOOK,
            chat.rogi.rogichat.channelport.core.model.channel.ChannelFeatureKeys.SCHEDULE to ChannelTab.SCHEDULE,
            chat.rogi.rogichat.channelport.core.model.channel.ChannelFeatureKeys.INFO to ChannelTab.INFO,
        )
        // 웹과 동일하게 실제 보이스커미션이 활성 상태면 채널 설정과 무관하게 강제 노출한다.
        // 단, 전역 kill switch가 꺼져 있으면 활성 채널도 노출하지 않는다.
        val mapped = items
            .filter { it.isEnabled }
            .sortedBy { it.order }
            .mapNotNull { item -> keyToTab[item.key]?.let { tab -> tab to item } }
        if (mapped.isEmpty()) {
            val fallbackTabs = DEFAULT_CHANNEL_TABS
            _uiState.update { state ->
                state.copy(
                    visibleTabs = fallbackTabs,
                    tabLabels = emptyMap(),
                    selectedTab = state.selectedTab.takeIf { it in fallbackTabs }
                        ?: fallbackTabs.firstOrNull()
                        ?: ChannelTab.SONGBOOK,
                )
            }
            return
        }
        val tabs = mapped.map { it.first }.toMutableList()
        val labels = mapped.mapNotNull { (tab, item) ->
            item.displayLabel?.let { label -> tab to label }
        }.toMap()
        _uiState.update { state ->
            val selected = when {
                state.selectedTab in tabs -> state.selectedTab
                // home 비활성 채널: 첫 노출 탭으로 폴백 (웹은 404, 앱은 무중단 우선)
                else -> tabs.first()
            }
            state.copy(visibleTabs = tabs, tabLabels = labels, selectedTab = selected)
        }
    }

    private fun loadWardrobe() {
        wardrobeLoaded = true
        viewModelScope.launch {
            _uiState.update { it.copy(wardrobeState = it.wardrobeState.copy(isLoading = true, error = null)) }
            channelRepository.getChannelWardrobe(channelIdentifier)
                .onSuccess { wardrobe -> _uiState.update { it.copy(wardrobeState = ChannelWardrobeState(categories = wardrobe.categories.filter { category -> category.isEnabled }, items = wardrobe.items.filter { item -> item.isVisible })) } }
                .onFailure { throwable -> _uiState.update { it.copy(wardrobeState = ChannelWardrobeState(error = throwable.message ?: "옷장을 불러오지 못했습니다.")) } }
        }
    }

    private fun toggleFavorite() {
        val channel = _uiState.value.channel ?: return
        if (!isLoggedIn.value) {
            _uiState.update { it.copy(showLoginRequiredDialog = true) }
            return
        }
        val currentState = _uiState.value.isFavorite
        val currentCount = _uiState.value.favoritesCount

        // Optimistic update
        _uiState.update {
            it.copy(
                isFavorite = !currentState,
                favoritesCount = if (currentState) (currentCount - 1).coerceAtLeast(0) else currentCount + 1,
            )
        }

        viewModelScope.launch {
            favoriteRepository.toggleFavoriteChannel(channel.id, currentState)
                .onFailure { exception ->
                    // Rollback on failure
                    _uiState.update {
                        it.copy(
                            isFavorite = currentState,
                            favoritesCount = currentCount,
                            error = exception.message ?: "즐겨찾기 변경에 실패했습니다",
                        )
                    }
                }
        }
    }

    private fun shareChannel() {
        val channel = _uiState.value.channel ?: return
        viewModelScope.launch {
            _shareEvent.emit("${channelWebOrigin}/channel/${channel.webPath}")
        }
    }

    private fun refreshLiveRequestState(showLoading: Boolean = false) {
        viewModelScope.launch {
            fetchLiveRequestState(showLoading)
        }
    }

    private suspend fun fetchLiveRequestState(showLoading: Boolean = false) {
        if (showLoading) {
            _uiState.update { state ->
                state.copy(
                    songbookState = state.songbookState.copy(
                        liveRequestState = state.songbookState.liveRequestState.copy(loading = true),
                    ),
                )
            }
        }

        songRequestRepository.getPublicActiveSession(channelIdentifier)
            .onSuccess { session ->
                applyLiveRequestSession(session)
            }
            .onFailure {
                _uiState.update { state ->
                    state.copy(
                        songbookState = state.songbookState.copy(
                            liveRequestState = state.songbookState.liveRequestState.copy(loading = false),
                        ),
                    )
                }
            }
    }

    private suspend fun applyLiveRequestSession(session: PublicLiveSession) {
        val settings = session.settings
        val requestEnabled = settings?.requestEnabled == true
        val paused = settings?.paused == true
        val maxQueueSize = settings?.maxQueueSize ?: 0
        val queueCount = session.queueCount
        val isLive = session.isLive && session.sessionId != null
        val isQueueFull = maxQueueSize > 0 && queueCount >= maxQueueSize
        val showRequestUI = isLive && requestEnabled

        val preventDuplicateSongs = settings?.preventDuplicateSongs == true
        val blockedCategoryIds = settings?.blockedCategoryIds ?: emptyList()

        _uiState.update { state ->
            state.copy(
                songbookState = state.songbookState.copy(
                    liveRequestState = state.songbookState.liveRequestState.copy(
                        isLive = isLive,
                        sessionId = session.sessionId,
                        requestEnabled = requestEnabled,
                        paused = paused,
                        maxQueueSize = maxQueueSize,
                        queueCount = queueCount,
                        isQueueFull = isQueueFull,
                        canRequest = showRequestUI && !paused && !isQueueFull,
                        showRequestUI = showRequestUI,
                        loading = false,
                        preventDuplicateSongs = preventDuplicateSongs,
                        blockedCategoryIds = blockedCategoryIds,
                    ),
                ),
            )
        }

        // 중복 신청 체크용 songIds 가져오기
        val sessionId = session.sessionId
        if (preventDuplicateSongs && sessionId != null) {
            fetchRequestedSongIds(sessionId)
        }
    }

    private suspend fun fetchRequestedSongIds(sessionId: Int) {
        songRequestRepository.getRequestedSongIds(sessionId)
            .onSuccess { songIds ->
                _uiState.update { state ->
                    state.copy(
                        songbookState = state.songbookState.copy(
                            liveRequestState = state.songbookState.liveRequestState.copy(
                                requestedSongIds = songIds,
                            ),
                        ),
                    )
                }
            }
    }

    private fun fetchQueue() {
        val sessionId = _uiState.value.songbookState.liveRequestState.sessionId ?: return
        viewModelScope.launch {
            _uiState.update { state ->
                state.copy(
                    songbookState = state.songbookState.copy(
                        liveRequestState = state.songbookState.liveRequestState.copy(isLoadingQueue = true),
                    ),
                )
            }
            songRequestRepository.getQueue(sessionId)
                .onSuccess { items ->
                    _uiState.update { state ->
                        state.copy(
                            songbookState = state.songbookState.copy(
                                liveRequestState = state.songbookState.liveRequestState.copy(
                                    queueItems = items,
                                    isLoadingQueue = false,
                                ),
                            ),
                        )
                    }
                }
                .onFailure {
                    _uiState.update { state ->
                        state.copy(
                            songbookState = state.songbookState.copy(
                                liveRequestState = state.songbookState.liveRequestState.copy(isLoadingQueue = false),
                            ),
                        )
                    }
                }
        }
    }

    private fun startLiveRequestPolling() {
        liveRequestPollingJob?.cancel()
        liveRequestPollingJob = viewModelScope.launch {
            while (isActive) {
                delay(LIVE_REQUEST_POLL_INTERVAL_MS)
                fetchLiveRequestState()
            }
        }
    }

    private fun connectToSongLiveSocket() {
        socketJob?.cancel()
        socketJob = viewModelScope.launch {
            songLiveSocketService.connect(channelIdentifier).collect { event ->
                when (event) {
                    is SongLiveSocketEvent.Joined -> {
                        event.session?.let { applyLiveRequestSession(it) }
                            ?: fetchLiveRequestState()
                    }
                    is SongLiveSocketEvent.StateChanged -> {
                        fetchLiveRequestState()
                    }
                }
            }
        }
    }

    private fun requestSong(song: Song) {
        val state = _uiState.value.songbookState
        val liveRequestState = state.liveRequestState

        if (state.isRequestSubmitting) return

        if (!authRepository.isLoggedIn.value) {
            _uiState.update { it.copy(showLoginRequiredDialog = true) }
            return
        }

        val sessionId = liveRequestState.sessionId
        if (sessionId == null || !liveRequestState.showRequestUI) {
            viewModelScope.launch {
                _messageEvent.emit("신청곡 모드가 활성화되어 있지 않습니다")
            }
            return
        }

        if (!liveRequestState.canRequest) {
            val message = when {
                liveRequestState.paused -> "신청곡이 일시정지 상태입니다"
                liveRequestState.isQueueFull -> "신청곡 대기열이 가득 찼습니다"
                else -> "현재 신청곡을 받을 수 없습니다"
            }
            viewModelScope.launch {
                _messageEvent.emit(message)
            }
            return
        }

        val artistName = song.artist?.name?.takeIf { it.isNotBlank() } ?: "아티스트 미상"
        val currentUser = authRepository.currentUser.value
        val requesterPlatformId = "app_${currentUser?.id ?: "guest"}"
        val requesterNickname = currentUser?.nickname?.takeIf { it.isNotBlank() } ?: "익명"

        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(isRequestSubmitting = true))
        }

        viewModelScope.launch {
            songRequestRepository.createSongRequest(
                CreateSongRequestPayload(
                    liveSessionId = sessionId,
                    songId = song.id,
                    rawArtist = artistName,
                    rawTitle = song.title,
                    requesterPlatformId = requesterPlatformId,
                    requesterNickname = requesterNickname,
                    source = "MANUAL",
                ),
            ).onSuccess {
                _messageEvent.emit("\"${song.title}\" 신청 완료")
                fetchLiveRequestState()
            }.onFailure { exception ->
                _messageEvent.emit(exception.message ?: "신청에 실패했습니다")
            }

            _uiState.update { stateSnapshot ->
                stateSnapshot.copy(
                    songbookState = stateSnapshot.songbookState.copy(isRequestSubmitting = false),
                )
            }
        }
    }

    // Songbook functions
    private fun loadSongs(resetPage: Boolean = true) {
        val channel = _uiState.value.channel ?: return
        val songbookState = _uiState.value.songbookState

        if (resetPage) {
            currentPage = 1
            _uiState.update { it.copy(songbookState = it.songbookState.copy(isLoading = true)) }
        }

        viewModelScope.launch {
            songRepository.getSongs(
                channelId = channel.id,
                page = currentPage,
                limit = pageSize,
                search = songbookState.searchQuery.takeIf { it.isNotBlank() },
                categoryId = songbookState.selectedCategory?.id,
                artistId = songbookState.selectedArtist?.id,
                difficulty = songbookState.selectedDifficulty,
                favoritesOnly = songbookState.showFavoritesOnly,
                sortBy = songbookState.selectedSortOption.apiValue,
            )
                .onSuccess { result ->
                    _uiState.update { state ->
                        val newSongs = if (resetPage) result.songs else state.songbookState.songs + result.songs
                        state.copy(
                            songbookState = state.songbookState.copy(
                                isLoading = false,
                                isLoadingMore = false,
                                songs = newSongs,
                                hasMorePages = result.hasMorePages,
                            ),
                        )
                    }
                }
                .onFailure { exception ->
                    _uiState.update {
                        it.copy(
                            songbookState = it.songbookState.copy(
                                isLoading = false,
                                isLoadingMore = false,
                            ),
                            error = exception.message ?: "곡을 불러오는데 실패했습니다",
                        )
                    }
                }
        }
    }

    private fun loadCategories() {
        viewModelScope.launch {
            songRepository.getCategories(channelIdentifier)
                .onSuccess { categories ->
                    val koreanCollator = java.text.Collator.getInstance(java.util.Locale.KOREAN)
                    val sortedCategories = categories.sortedWith { a, b ->
                        val orderA = a.displayOrder ?: Int.MIN_VALUE
                        val orderB = b.displayOrder ?: Int.MIN_VALUE
                        when {
                            orderA != orderB -> orderB.compareTo(orderA)
                            else -> koreanCollator.compare(a.name, b.name)
                        }
                    }
                    _uiState.update {
                        it.copy(songbookState = it.songbookState.copy(categories = sortedCategories))
                    }
                }
        }
    }

    private fun loadArtists() {
        viewModelScope.launch {
            songRepository.getArtists(channelIdentifier)
                .onSuccess { artists ->
                    val sortedArtists = artists.sortedByDescending { it.songCount ?: 0 }
                    _uiState.update {
                        it.copy(songbookState = it.songbookState.copy(artists = sortedArtists))
                    }
                }
        }
    }

    private fun searchSongs(query: String) {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(searchQuery = query))
        }
        loadSongs()
    }

    private fun selectCategory(category: chat.rogi.rogichat.channelport.core.model.song.Category?) {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(selectedCategory = category))
        }
        loadSongs()
    }

    private fun toggleFavoritesOnly() {
        _uiState.update {
            it.copy(
                songbookState = it.songbookState.copy(
                    showFavoritesOnly = !it.songbookState.showFavoritesOnly,
                ),
            )
        }
        loadSongs()
    }

    private fun toggleSongFavorite(song: Song) {
        viewModelScope.launch {
            favoriteRepository.toggleFavoriteSong(song.id, song.isLiked)
                .onSuccess { newState ->
                    _uiState.update { state ->
                        val likeCountDelta = if (newState) 1 else -1
                        val updatedSongs = state.songbookState.songs.map {
                            if (it.id == song.id) {
                                it.copy(
                                    isLiked = newState,
                                    likeCount = (it.likeCount + likeCountDelta).coerceAtLeast(0),
                                )
                            } else {
                                it
                            }
                        }
                        val updatedSelectedSong = state.songbookState.selectedSong?.let {
                            if (it.id == song.id) {
                                it.copy(
                                    isLiked = newState,
                                    likeCount = (it.likeCount + likeCountDelta).coerceAtLeast(0),
                                )
                            } else {
                                it
                            }
                        }
                        state.copy(
                            songbookState = state.songbookState.copy(
                                songs = updatedSongs,
                                selectedSong = updatedSelectedSong,
                            ),
                        )
                    }
                }
                .onFailure { exception ->
                    _uiState.update {
                        it.copy(error = exception.message ?: "즐겨찾기 변경에 실패했습니다")
                    }
                }
        }
    }

    private fun loadMoreSongs() {
        val songbookState = _uiState.value.songbookState
        if (songbookState.isLoadingMore || !songbookState.hasMorePages) return

        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(isLoadingMore = true))
        }
        currentPage++
        loadSongs(resetPage = false)
    }

    private fun refreshSongbook() {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(isRefreshing = true))
        }
        currentPage = 1

        viewModelScope.launch {
            val channel = _uiState.value.channel ?: return@launch
            val songbookState = _uiState.value.songbookState

            songRepository.getSongs(
                channelId = channel.id,
                page = 1,
                limit = pageSize,
                search = songbookState.searchQuery.takeIf { it.isNotBlank() },
                categoryId = songbookState.selectedCategory?.id,
                artistId = songbookState.selectedArtist?.id,
                difficulty = songbookState.selectedDifficulty,
                favoritesOnly = songbookState.showFavoritesOnly,
            )
                .onSuccess { result ->
                    _uiState.update { state ->
                        state.copy(
                            songbookState = state.songbookState.copy(
                                isRefreshing = false,
                                isLoading = false,
                                songs = result.songs,
                                hasMorePages = result.hasMorePages,
                            ),
                        )
                    }
                }
                .onFailure {
                    _uiState.update {
                        it.copy(songbookState = it.songbookState.copy(isRefreshing = false))
                    }
                }

            // Also refresh categories and artists
            loadCategories()
            loadArtists()
        }
    }

    private fun selectSong(song: Song) {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(selectedSong = song))
        }
    }

    private fun dismissSongDetail() {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(selectedSong = null))
        }
    }

    // Filter functions
    private fun showFilterSheet() {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(showFilterSheet = true))
        }
    }

    private fun dismissFilterSheet() {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(showFilterSheet = false))
        }
    }

    private fun selectArtist(artist: chat.rogi.rogichat.channelport.core.model.song.Artist?) {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(selectedArtist = artist))
        }
    }

    private fun selectDifficulty(difficulty: Int?) {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(selectedDifficulty = difficulty))
        }
    }

    private fun clearFilters() {
        _uiState.update {
            it.copy(
                songbookState = it.songbookState.copy(
                    selectedArtist = null,
                    selectedDifficulty = null,
                ),
            )
        }
    }

    private fun applyFilters() {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(showFilterSheet = false))
        }
        loadSongs()
    }

    // Sort functions
    private fun showSortSheet() {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(showSortSheet = true))
        }
    }

    private fun dismissSortSheet() {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(showSortSheet = false))
        }
    }

    private fun selectSortOption(option: SongSortOption) {
        _uiState.update {
            it.copy(songbookState = it.songbookState.copy(
                selectedSortOption = option,
                showSortSheet = false,
            ))
        }
        loadSongs()
    }

    // Schedule functions
    private fun initSchedule() {
        currentYearMonth = LocalDate.now(ZoneId.of("Asia/Seoul"))
        updateScheduleDisplay()
        loadSchedules()
    }

    private fun changeMonth(delta: Int) {
        currentYearMonth = currentYearMonth.plusMonths(delta.toLong())
        updateScheduleDisplay()
        loadSchedules()
    }

    private fun updateScheduleDisplay() {
        val formatter = DateTimeFormatter.ofPattern("yyyy년 M월")
        val apiFormatter = DateTimeFormatter.ofPattern("yyyy-MM")
        _uiState.update {
            it.copy(
                scheduleState = it.scheduleState.copy(
                    currentYearMonth = currentYearMonth.format(apiFormatter),
                    displayMonth = currentYearMonth.format(formatter),
                ),
            )
        }
    }

    private fun loadSchedules() {
        val channel = _uiState.value.channel ?: return
        val yearMonth = _uiState.value.scheduleState.currentYearMonth

        _uiState.update { it.copy(scheduleState = it.scheduleState.copy(isLoading = true)) }

        viewModelScope.launch {
            scheduleRepository.getChannelSchedules(channel.id, yearMonth)
                .onSuccess { schedules ->
                    _uiState.update {
                        it.copy(
                            scheduleState = it.scheduleState.copy(
                                isLoading = false,
                                schedules = schedules,
                            ),
                        )
                    }
                }
                .onFailure { exception ->
                    _uiState.update {
                        it.copy(
                            scheduleState = it.scheduleState.copy(isLoading = false),
                            error = exception.message ?: "일정을 불러오는데 실패했습니다",
                        )
                    }
                }
        }
    }

    private fun refreshSchedule() {
        val channel = _uiState.value.channel ?: return
        val yearMonth = _uiState.value.scheduleState.currentYearMonth

        _uiState.update { it.copy(scheduleState = it.scheduleState.copy(isRefreshing = true)) }

        viewModelScope.launch {
            scheduleRepository.getChannelSchedules(channel.id, yearMonth)
                .onSuccess { schedules ->
                    _uiState.update {
                        it.copy(
                            scheduleState = it.scheduleState.copy(
                                isRefreshing = false,
                                isLoading = false,
                                schedules = schedules,
                            ),
                        )
                    }
                }
                .onFailure {
                    _uiState.update {
                        it.copy(scheduleState = it.scheduleState.copy(isRefreshing = false))
                    }
                }
        }
    }

    private fun deleteSchedule() {
        val schedule = _uiState.value.scheduleState.selectedSchedule ?: return

        viewModelScope.launch {
            scheduleRepository.deleteSchedule(schedule.id)
                .onSuccess {
                    _uiState.update {
                        it.copy(
                            scheduleState = it.scheduleState.copy(
                                showDetailSheet = false,
                                selectedSchedule = null,
                            ),
                        )
                    }
                    _messageEvent.emit("일정이 삭제되었습니다")
                    loadSchedules()
                }
                .onFailure { exception ->
                    _uiState.update {
                        it.copy(error = exception.message ?: "일정 삭제에 실패했습니다")
                    }
                }
        }
    }

    fun updateSchedule(request: UpdateScheduleRequest) {
        val schedule = _uiState.value.scheduleState.selectedSchedule ?: return

        viewModelScope.launch {
            scheduleRepository.updateSchedule(schedule.id, request)
                .onSuccess {
                    _uiState.update {
                        it.copy(
                            scheduleState = it.scheduleState.copy(
                                showEditSheet = false,
                                selectedSchedule = null,
                            ),
                        )
                    }
                    _messageEvent.emit("일정이 수정되었습니다")
                    loadSchedules()
                }
                .onFailure { exception ->
                    _uiState.update {
                        it.copy(error = exception.message ?: "일정 수정에 실패했습니다")
                    }
                }
        }
    }

    // Info functions
    private fun loadProfile(channelId: Int) {
        _uiState.update { it.copy(infoState = it.infoState.copy(isLoading = true)) }

        viewModelScope.launch {
            channelRepository.getChannelProfile(channelId)
                .onSuccess { profile ->
                    _uiState.update {
                        it.copy(
                            infoState = it.infoState.copy(
                                isLoading = false,
                                profile = profile,
                            ),
                        )
                    }
                }
                .onFailure {
                    _uiState.update {
                        it.copy(infoState = it.infoState.copy(isLoading = false))
                    }
                }
        }
    }

    private fun loadPricingSettings(channelId: Int) {
        viewModelScope.launch {
            songPricingRepository.getPricingSettings(channelId)
                .onSuccess { settings ->
                    _uiState.update { it.copy(pricingSettings = settings) }
                }
                .onFailure { Timber.d(it, "Failed to load pricing settings") }
        }
    }

    // Guestbook functions




















    override fun onCleared() {
        socketJob?.cancel()
        liveRequestPollingJob?.cancel()
    }
}
