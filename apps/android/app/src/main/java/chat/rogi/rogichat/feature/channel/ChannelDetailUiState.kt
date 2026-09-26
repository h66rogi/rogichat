package chat.rogi.rogichat.feature.channel

import chat.rogi.rogichat.channelport.core.model.channel.Channel
import chat.rogi.rogichat.channelport.core.model.channel.ChannelPermission
import chat.rogi.rogichat.channelport.core.model.channel.ChannelProfile
import chat.rogi.rogichat.channelport.core.model.channel.ChannelWardrobeCategory
import chat.rogi.rogichat.channelport.core.model.channel.ChannelWardrobeItem
import chat.rogi.rogichat.channelport.core.model.schedule.Schedule
import chat.rogi.rogichat.channelport.core.model.song.Artist
import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.PricingSettings
import chat.rogi.rogichat.channelport.core.model.song.Song

data class ChannelDetailUiState(
    val isLoading: Boolean = true,
    val channel: Channel? = null,
    val permission: ChannelPermission = ChannelPermission(),
    val isFavorite: Boolean = false,
    val favoritesCount: Int = 0,
    val selectedTab: ChannelTab = ChannelTab.SONGBOOK,
    /** feature-settings 기반 노출 탭 (순서 반영). 실패 시 폴백 순서 유지 */
    val visibleTabs: List<ChannelTab> = DEFAULT_CHANNEL_TABS,
    /** 서버 커스텀 라벨 (없으면 enum title 사용) */
    val tabLabels: Map<ChannelTab, String> = emptyMap(),
    val error: String? = null,
    val showLoginRequiredDialog: Boolean = false,
    val pricingSettings: PricingSettings? = null,
    // Songbook state
    val songbookState: SongbookState = SongbookState(),
    // Guestbook state
    // Schedule state
    val scheduleState: ScheduleState = ScheduleState(),
    // Info state
    val infoState: InfoState = InfoState(),
    val wardrobeState: ChannelWardrobeState = ChannelWardrobeState(),
)

data class ChannelWardrobeState(
    val isLoading: Boolean = false,
    val categories: List<ChannelWardrobeCategory> = emptyList(),
    val items: List<ChannelWardrobeItem> = emptyList(),
    val error: String? = null,
)

enum class SongSortOption(val apiValue: String, val displayName: String) {
    NEWEST("newest", "최신순"),
    OLDEST("oldest", "오래된순"),
    TITLE("title", "제목순 (가나다)"),
    ARTIST("artist", "가수순 (가나다)"),
    LIKES_DESC("likes_desc", "좋아요 많은 순"),
}

data class SongbookState(
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val songs: List<Song> = emptyList(),
    val searchQuery: String = "",
    val categories: List<Category> = emptyList(),
    val artists: List<Artist> = emptyList(),
    val selectedCategory: Category? = null,
    val selectedArtist: Artist? = null,
    val selectedDifficulty: Int? = null,
    val showFavoritesOnly: Boolean = false,
    val showFilterSheet: Boolean = false,
    val showSortSheet: Boolean = false,
    val selectedSortOption: SongSortOption = SongSortOption.NEWEST,
    val hasMorePages: Boolean = false,
    val isLoadingMore: Boolean = false,
    val selectedSong: Song? = null,
    val liveRequestState: LiveSongRequestUiState = LiveSongRequestUiState(),
    val isRequestSubmitting: Boolean = false,
    val showLiveRequestSheet: Boolean = false,
) {
    val hasActiveFilters: Boolean
        get() = selectedArtist != null || selectedDifficulty != null

    val activeFilterCount: Int
        get() = listOfNotNull(selectedArtist, selectedDifficulty).size
}

data class LiveSongRequestUiState(
    val isLive: Boolean = false,
    val sessionId: Int? = null,
    val requestEnabled: Boolean = false,
    val paused: Boolean = false,
    val maxQueueSize: Int = 0,
    val queueCount: Int = 0,
    val isQueueFull: Boolean = false,
    val canRequest: Boolean = false,
    val showRequestUI: Boolean = false,
    val loading: Boolean = false,
    val preventDuplicateSongs: Boolean = false,
    val blockedCategoryIds: List<Int> = emptyList(),
    val requestedSongIds: List<Int> = emptyList(),
    val queueItems: List<chat.rogi.rogichat.channelport.core.model.song.SongRequestQueueItem> = emptyList(),
    val isLoadingQueue: Boolean = false,
)

data class ScheduleState(
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val schedules: List<Schedule> = emptyList(),
    val currentYearMonth: String = "",
    val displayMonth: String = "",
    val selectedSchedule: Schedule? = null,
    val showDetailSheet: Boolean = false,
    val showEditSheet: Boolean = false,
    val showDeleteDialog: Boolean = false,
)

data class InfoState(
    val isLoading: Boolean = true,
    val profile: ChannelProfile? = null,
)

enum class ChannelTab(val title: String) {
    WARDROBE("옷장"),
    SETLIST("셋리스트"),
    SONGBOOK("노래책"),
    SCHEDULE("일정"),
    INFO("정보"),
}

/** feature-settings 로드 실패/미로드 시 폴백 순서 (기존 하드코딩과 동일 + 홈) */
val DEFAULT_CHANNEL_TABS: List<ChannelTab> = listOf(ChannelTab.SONGBOOK, ChannelTab.SCHEDULE, ChannelTab.SETLIST, ChannelTab.WARDROBE)

sealed interface ChannelDetailEvent {
    data class TabSelected(val tab: ChannelTab) : ChannelDetailEvent
    data object ToggleFavorite : ChannelDetailEvent
    data object Share : ChannelDetailEvent
    data object Refresh : ChannelDetailEvent
    data object ErrorDismissed : ChannelDetailEvent
    // Songbook events
    data class SongSearchChanged(val query: String) : ChannelDetailEvent
    data class CategorySelected(val category: Category?) : ChannelDetailEvent
    data object ToggleFavoritesOnly : ChannelDetailEvent
    data class ToggleSongFavorite(val song: Song) : ChannelDetailEvent
    data object LoadMoreSongs : ChannelDetailEvent
    data class SongSelected(val song: Song) : ChannelDetailEvent
    data object SongDetailDismissed : ChannelDetailEvent
    data object RefreshSongbook : ChannelDetailEvent
    data class SongRequestSubmit(val song: Song) : ChannelDetailEvent
    data object LoginDialogDismissed : ChannelDetailEvent
    data object ShowLiveRequestSheet : ChannelDetailEvent
    data object DismissLiveRequestSheet : ChannelDetailEvent
    // Filter events
    data object ShowFilterSheet : ChannelDetailEvent
    data object DismissFilterSheet : ChannelDetailEvent
    data class ArtistSelected(val artist: Artist?) : ChannelDetailEvent
    data class DifficultySelected(val difficulty: Int?) : ChannelDetailEvent
    data object ClearFilters : ChannelDetailEvent
    data object ApplyFilters : ChannelDetailEvent
    // Sort events
    data object ShowSortSheet : ChannelDetailEvent
    data object DismissSortSheet : ChannelDetailEvent
    data class SortOptionSelected(val option: SongSortOption) : ChannelDetailEvent
    // Schedule events
    data object PreviousMonth : ChannelDetailEvent
    data object NextMonth : ChannelDetailEvent
    data object RefreshSchedule : ChannelDetailEvent
    data class ScheduleSelected(val schedule: Schedule) : ChannelDetailEvent
    data object DismissScheduleDetail : ChannelDetailEvent
    data object ShowEditSchedule : ChannelDetailEvent
    data object DismissEditSchedule : ChannelDetailEvent
    data object ShowDeleteScheduleDialog : ChannelDetailEvent
    data object DismissDeleteScheduleDialog : ChannelDetailEvent
    data object ConfirmDeleteSchedule : ChannelDetailEvent
}
