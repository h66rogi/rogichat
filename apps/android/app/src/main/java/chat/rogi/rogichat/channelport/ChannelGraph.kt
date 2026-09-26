package chat.rogi.rogichat.channelport

import androidx.lifecycle.SavedStateHandle
import chat.rogi.rogichat.channelport.core.data.repository.*
import chat.rogi.rogichat.channelport.core.domain.repository.ChannelSession
import chat.rogi.rogichat.channelport.core.network.api.*
import chat.rogi.rogichat.channelport.core.network.socket.SongLiveSocketManagerFactory
import chat.rogi.rogichat.core.session.CredentialStore
import chat.rogi.rogichat.core.session.SessionSnapshot
import chat.rogi.rogichat.feature.channel.*
import chat.rogi.rogichat.feature.channel.console.ConsoleViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/** Dependency wiring for the copied Meloming feature. */
class ChannelGraph(credentials: CredentialStore, session: StateFlow<SessionSnapshot>, scope: CoroutineScope) {
    private val api = ApiClient(credentials)
    private val channel = ChannelRepositoryImpl(ChannelApi(api), UploadApi(api))
    private val favoritesApi = FavoritesApi(api)
    private val song = SongRepositoryImpl(SongApi(api), favoritesApi)
    private val schedule = ScheduleRepositoryImpl(ScheduleApi(api))
    private val favorite = FavoriteRepositoryImpl(favoritesApi)
    private val requests = SongRequestRepositoryImpl(SongRequestApi(api))
    private val pricing = SongPricingRepositoryImpl(SongPricingApi(api))
    private val category = CategoryRepositoryImpl(CategoryApi(api))
    private val sessions = SessionRepositoryImpl(SessionApi(api))
    private val socketFactory = SongLiveSocketManagerFactory(api)
    private val auth = ChannelSession(api, session, scope)
    private val setlists = ChannelSetlistRepository(api)
    private fun state(handle: SavedStateHandle, channelId: Int? = null, songId: Int? = null) = handle.apply {
        this["channelIdentifier"] = "h66rogi"
        this["channelId"] = channelId
        this["songId"] = songId
    }
    fun detail(handle: SavedStateHandle) = ChannelDetailViewModel(state(handle), channel, song, schedule, favorite, auth, requests,
        SongLiveSocketServiceImpl(socketFactory), pricing, setlists)
    fun addSong(handle: SavedStateHandle, channelId: Int) = AddSongViewModel(state(handle, channelId), song)
    fun editSong(handle: SavedStateHandle, songId: Int) = EditSongViewModel(state(handle, songId = songId), song)
    fun addSchedule(handle: SavedStateHandle, channelId: Int) = AddScheduleViewModel(state(handle, channelId), schedule)
    fun settings(handle: SavedStateHandle) = ChannelSettingsViewModel(state(handle), channel)
    fun categories(handle: SavedStateHandle, channelId: Int) = CategoryManagementViewModel(state(handle, channelId), category)
    fun console(handle: SavedStateHandle, channelId: Int) = ConsoleViewModel(state(handle, channelId), channel, sessions, requests, pricing, song,
        ConsoleSongLiveSocketServiceImpl(socketFactory))
}
