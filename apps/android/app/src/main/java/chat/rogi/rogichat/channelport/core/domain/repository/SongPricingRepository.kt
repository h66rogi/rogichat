package chat.rogi.rogichat.channelport.core.domain.repository

import chat.rogi.rogichat.channelport.core.model.song.PricingSettings
import chat.rogi.rogichat.channelport.core.model.song.UpdatePricingSettingsPayload

interface SongPricingRepository {
    suspend fun getPricingSettings(channelId: Int): Result<PricingSettings>
    suspend fun updatePricingSettings(channelId: Int, payload: UpdatePricingSettingsPayload): Result<PricingSettings>
}
