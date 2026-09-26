package chat.rogi.rogichat.channelport.core.network.api

import chat.rogi.rogichat.channelport.core.model.song.PricingSettings
import chat.rogi.rogichat.channelport.core.model.song.PricingSettingsDto
import chat.rogi.rogichat.channelport.core.model.song.UpdatePricingSettingsPayload
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType

class SongPricingApi constructor(
    private val apiClient: ApiClient,
) {
    suspend fun getPricingSettings(channelId: Int): PricingSettings {
        val response = apiClient.get<PricingSettingsDto>("/v1/channels/$channelId/pricing-settings")
        return response.toDomain()
    }

    suspend fun updatePricingSettings(channelId: Int, payload: UpdatePricingSettingsPayload): PricingSettings {
        val response = apiClient.put<PricingSettingsDto>("/v1/channels/$channelId/pricing-settings") {
            contentType(ContentType.Application.Json)
            setBody(payload)
        }
        return response.toDomain()
    }
}
