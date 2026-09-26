package chat.rogi.rogichat.channelport.core.network.socket

import chat.rogi.rogichat.channelport.core.network.api.BaseUrlProvider

class SongLiveSocketManagerFactory constructor(
    private val baseUrlProvider: BaseUrlProvider,
) {
    fun create(): SongLiveSocketManager = SongLiveSocketManager(baseUrlProvider)
}
