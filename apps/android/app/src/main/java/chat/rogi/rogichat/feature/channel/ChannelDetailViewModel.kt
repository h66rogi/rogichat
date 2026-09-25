package chat.rogi.rogichat.feature.channel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.YearMonth
import java.time.ZoneId

// ChannelDetailViewModel from meloming-android ecb3dbed supplies the StateFlow,
// parallel shell loading, selected-tab state and per-section loading pattern.
enum class ChannelTab(val title: String, val key: String) {
    SONGBOOK("노래책", "musicbook"), SCHEDULE("캘린더", "schedule"),
    SETLIST("셋리스트", "setlist"), WARDROBE("옷장", "wardrobe");
    companion object { fun fromKey(key: String) = entries.firstOrNull { it.key == key } }
}

data class ChannelDetailUiState(
    val isLoading: Boolean = true,
    val channel: Channel? = null,
    val profile: ChannelProfile? = null,
    val visibleTabs: List<ChannelTab> = ChannelTab.entries,
    val tabLabels: Map<ChannelTab, String> = emptyMap(),
    val selectedTab: ChannelTab = ChannelTab.SONGBOOK,
    val error: String? = null,
    val sectionLoading: Boolean = false,
    val sectionError: String? = null,
    val songs: List<Song> = emptyList(),
    val songSearch: String = "",
    val songTotal: Int = 0,
    val songPage: Int = 1,
    val month: String = YearMonth.now(ZoneId.of("Asia/Seoul")).toString(),
    val schedules: List<Schedule> = emptyList(),
    val wardrobe: ChannelWardrobeResponse = ChannelWardrobeResponse(),
    val selectedCategory: Int? = null,
    val setlists: List<ChannelSetlistSummary> = emptyList(),
    val setlistDetail: ChannelSetlistDetail? = null,
)

class ChannelDetailViewModel(private val repository: ChannelRepository) : ViewModel() {
    private val mutable = MutableStateFlow(ChannelDetailUiState())
    val uiState = mutable.asStateFlow()
    private var sectionJob: Job? = null
    private var detailJob: Job? = null
    private var shellJob: Job? = null

    init { refresh() }

    fun refresh() {
        shellJob?.cancel()
        shellJob = viewModelScope.launch {
            mutable.update { it.copy(isLoading = it.channel == null, error = null) }
            try {
                val channel = repository.getChannel()
                val (profile, settings, count) = coroutineScope {
                    val profile = async { try { repository.getProfile() } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { null } }
                    val settings = async { try { repository.getFeatureSettings() } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { null } }
                    val count = async { try { repository.getFavoritesCount() } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { null } }
                    Triple(profile.await(), settings.await(), count.await())
                }
                val tabs = settings?.items?.sortedBy { it.order }?.filter { it.isEnabled }
                    ?.mapNotNull { ChannelTab.fromKey(it.key) }?.distinct() ?: ChannelTab.entries
                val labels = settings?.items?.mapNotNull { item ->
                    ChannelTab.fromKey(item.key)?.let { tab -> tab to (item.displayLabel ?: tab.title) }
                }?.toMap().orEmpty()
                mutable.update {
                    it.copy(channel = channel.copy(favoritesCount = count?.totalFavorites ?: channel.favoritesCount), profile = profile, visibleTabs = tabs, tabLabels = labels,
                        selectedTab = if (it.selectedTab in tabs) it.selectedTab else tabs.firstOrNull() ?: it.selectedTab,
                        isLoading = false)
                }
                if (tabs.isNotEmpty()) loadSelected()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { mutable.update { it.copy(isLoading = false, error = "잠시 후 다시 시도해 주세요.") } }
        }
    }

    fun selectTab(tab: ChannelTab) {
        if (tab !in mutable.value.visibleTabs) return
        mutable.update { it.copy(selectedTab = tab, sectionError = null) }
        loadSelected()
    }

    fun searchSongs(query: String) {
        mutable.update { it.copy(songSearch = query.take(255), songPage = 1) }
        if (mutable.value.selectedTab == ChannelTab.SONGBOOK) loadSelected(debounce = true)
    }

    fun loadMoreSongs() {
        val state = mutable.value
        if (state.sectionLoading || state.songs.size >= state.songTotal) return
        val next = state.songPage + 1
        sectionJob = viewModelScope.launch {
            mutable.update { it.copy(sectionLoading = true, sectionError = null) }
            try {
                val page = repository.getSongs(next, state.songSearch)
                mutable.update { it.copy(songs = it.songs + page.songs.map(SongDTO::toDomain),
                    songPage = next, songTotal = page.total, sectionLoading = false) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { mutable.update { it.copy(sectionLoading = false, sectionError = "노래를 더 불러올 수 없어요.") } }
        }
    }

    fun moveMonth(offset: Long) {
        mutable.update { it.copy(month = YearMonth.parse(it.month).plusMonths(offset).toString()) }
        loadSelected()
    }

    fun selectCategory(id: Int?) { mutable.update { it.copy(selectedCategory = id) } }

    fun openSetlist(sessionId: Int) {
        detailJob?.cancel()
        detailJob = viewModelScope.launch {
            mutable.update { it.copy(setlistDetail = null, sectionError = null) }
            try { mutable.update { it.copy(setlistDetail = repository.getSetlist(sessionId)) } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { mutable.update { it.copy(sectionError = "셋리스트를 불러올 수 없어요.") } }
        }
    }
    fun closeSetlist() { detailJob?.cancel(); mutable.update { it.copy(setlistDetail = null) } }

    fun retrySection() = loadSelected()

    private fun loadSelected(debounce: Boolean = false) {
        sectionJob?.cancel()
        sectionJob = viewModelScope.launch {
            if (debounce) delay(250)
            val state = mutable.value
            mutable.update { it.copy(sectionLoading = true, sectionError = null) }
            try {
                when (state.selectedTab) {
                    ChannelTab.SONGBOOK -> {
                        val page = repository.getSongs(search = state.songSearch)
                        mutable.update { it.copy(songs = page.songs.map(SongDTO::toDomain), songTotal = page.total,
                            songPage = 1, sectionLoading = false) }
                    }
                    ChannelTab.SCHEDULE -> {
                        val page = repository.getSchedules(state.month)
                        mutable.update { it.copy(schedules = page.items.map(ScheduleDTO::toDomain), sectionLoading = false) }
                    }
                    ChannelTab.SETLIST -> {
                        val page = repository.getSetlists()
                        mutable.update { it.copy(setlists = page.setlists, sectionLoading = false) }
                    }
                    ChannelTab.WARDROBE -> {
                        val wardrobe = repository.getWardrobe()
                        mutable.update { it.copy(wardrobe = wardrobe, sectionLoading = false) }
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { mutable.update { it.copy(sectionLoading = false, sectionError = "잠시 후 다시 시도해 주세요.") } }
        }
    }
}
