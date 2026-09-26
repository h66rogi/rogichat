package chat.rogi.rogichat.channelport.core.data.repository

import chat.rogi.rogichat.channelport.core.domain.repository.SongPricingRepository
import chat.rogi.rogichat.channelport.core.model.song.PricingSettings
import chat.rogi.rogichat.channelport.core.model.song.UpdatePricingSettingsPayload
import chat.rogi.rogichat.channelport.core.network.api.SongPricingApi
import timber.log.Timber

class SongPricingRepositoryImpl constructor(
    private val songPricingApi: SongPricingApi,
) : SongPricingRepository {

    override suspend fun getPricingSettings(channelId: Int): Result<PricingSettings> = runCatching {
        songPricingApi.getPricingSettings(channelId)
    }.onFailure {
        Timber.e(it, "Failed to get pricing settings: channelId=$channelId")
    }

    override suspend fun updatePricingSettings(channelId: Int, payload: UpdatePricingSettingsPayload): Result<PricingSettings> = runCatching {
        songPricingApi.updatePricingSettings(channelId, payload)
    }.onFailure {
        Timber.e(it, "Failed to update pricing settings: channelId=$channelId")
    }
}
