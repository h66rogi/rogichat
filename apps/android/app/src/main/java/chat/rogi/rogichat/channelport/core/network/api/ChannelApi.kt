package chat.rogi.rogichat.channelport.core.network.api

import chat.rogi.rogichat.channelport.core.model.channel.Channel
import chat.rogi.rogichat.channelport.core.model.channel.ChannelMembershipCatalog
import chat.rogi.rogichat.channelport.core.model.channel.ChannelMembershipEmoticonReplacement
import chat.rogi.rogichat.channelport.core.model.channel.ChannelMembershipManagement
import chat.rogi.rogichat.channelport.core.model.channel.ChannelMembershipManagedPlan
import chat.rogi.rogichat.channelport.core.model.channel.CreateChannelMembershipPlanRequest
import chat.rogi.rogichat.channelport.core.model.channel.MyChannelMembership
import chat.rogi.rogichat.channelport.core.model.channel.ReplaceChannelMembershipPlanEmoticonsRequest
import chat.rogi.rogichat.channelport.core.model.channel.UpdateChannelMembershipPlanRequest
import chat.rogi.rogichat.channelport.core.model.channel.ChannelDTO
import chat.rogi.rogichat.channelport.core.model.channel.ChannelPermission
import chat.rogi.rogichat.channelport.core.model.channel.ChannelProfile
import chat.rogi.rogichat.channelport.core.model.channel.ChannelWardrobeResponse
import chat.rogi.rogichat.channelport.core.model.channel.MyChannel
import chat.rogi.rogichat.channelport.core.model.channel.MyChannelDTO
import chat.rogi.rogichat.channelport.core.model.channel.UpdateChannelRequest
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType

class ChannelApi constructor(
    private val apiClient: ApiClient,
) {
    suspend fun getPopularChannels(limit: Int = 20): List<Channel> =
        apiClient.get<List<ChannelDTO>>("/v1/channel/list/famous") {
            url {
                parameters.append("limit", limit.toString())
            }
        }.map { it.toDomain() }

    suspend fun getRecentChannels(limit: Int = 20): List<Channel> =
        apiClient.get<List<ChannelDTO>>("/v1/channel/list/recent") {
            url {
                parameters.append("limit", limit.toString())
            }
        }.map { it.toDomain() }

    suspend fun getChannel(identifier: String): Channel =
        apiClient.get<ChannelDTO>("/v1/channel/$identifier").toDomain()

    suspend fun getChannelFeatureSettings(identifier: String): chat.rogi.rogichat.channelport.core.model.channel.ChannelFeatureSettingsResponse =
        apiClient.get("/v1/channel/$identifier/feature-settings")

    suspend fun getChannelProfile(channelId: Int): ChannelProfile =
        apiClient.get("/v1/channel/$channelId/profile")

    suspend fun getChannelWardrobe(identifier: String): ChannelWardrobeResponse =
        apiClient.get("/v1/channel/$identifier/wardrobe")

    suspend fun getChannelPermission(identifier: String): ChannelPermission =
        apiClient.get("/v1/channel/$identifier/permission")

    suspend fun searchChannels(
        keyword: String,
        page: Int = 1,
        limit: Int = 20,
    ): ChannelSearchResponse = apiClient.get("/v1/channel/search") {
        url {
            parameters.append("keyword", keyword)
            parameters.append("page", page.toString())
            parameters.append("limit", limit.toString())
        }
    }

    suspend fun getMyChannels(): List<MyChannel> =
        apiClient.get<List<MyChannelDTO>>("/v1/channel/my").map { it.toDomain() }

    suspend fun updateChannel(
        identifier: String,
        request: UpdateChannelRequest,
    ): Channel = apiClient.put<ChannelDTO>("/v1/channel/$identifier") {
        contentType(ContentType.Application.Json)
        setBody(request)
    }.toDomain()

    suspend fun getMembershipCatalog(channelId: Int): ChannelMembershipCatalog =
        apiClient.get("/v1/channel/$channelId/membership")

    suspend fun getMyMembership(channelId: Int): MyChannelMembership =
        apiClient.get("/v1/channel/$channelId/membership/me")

    suspend fun getMembershipManagement(channelId: Int): ChannelMembershipManagement =
        apiClient.get("/v1/channel/$channelId/membership/manage")

    suspend fun createMembershipPlan(channelId: Int, request: CreateChannelMembershipPlanRequest): ChannelMembershipManagedPlan =
        apiClient.post("/v1/channel/$channelId/membership/plans") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }

    suspend fun updateMembershipPlan(channelId: Int, planId: String, request: UpdateChannelMembershipPlanRequest): ChannelMembershipManagedPlan =
        apiClient.patch("/v1/channel/$channelId/membership/plans/$planId") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }

    suspend fun replaceMembershipPlanEmoticons(channelId: Int, planId: String, request: ReplaceChannelMembershipPlanEmoticonsRequest): ChannelMembershipEmoticonReplacement =
        apiClient.put("/v1/channel/$channelId/membership/plans/$planId/emoticons") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }
}

@kotlinx.serialization.Serializable
data class ChannelSearchResponse(
    val channels: List<ChannelDTO> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 20,
)
