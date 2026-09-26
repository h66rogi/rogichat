package chat.rogi.rogichat.channelport.core.data.repository

import chat.rogi.rogichat.channelport.core.domain.repository.ChannelRepository
import chat.rogi.rogichat.channelport.core.model.channel.Channel
import chat.rogi.rogichat.channelport.core.model.channel.ChannelMembershipCatalog
import chat.rogi.rogichat.channelport.core.model.channel.ChannelMembershipManagement
import chat.rogi.rogichat.channelport.core.model.channel.CreateChannelMembershipPlanRequest
import chat.rogi.rogichat.channelport.core.model.channel.MyChannelMembership
import chat.rogi.rogichat.channelport.core.model.channel.ReplaceChannelMembershipPlanEmoticonsRequest
import chat.rogi.rogichat.channelport.core.model.channel.UpdateChannelMembershipPlanRequest
import chat.rogi.rogichat.channelport.core.model.channel.ChannelPermission
import chat.rogi.rogichat.channelport.core.model.channel.ChannelProfile
import chat.rogi.rogichat.channelport.core.model.channel.ChannelWardrobeResponse
import chat.rogi.rogichat.channelport.core.model.channel.MyChannel
import chat.rogi.rogichat.channelport.core.model.channel.UpdateChannelRequest
import chat.rogi.rogichat.channelport.core.model.upload.UploadImageResponse
import chat.rogi.rogichat.channelport.core.network.api.ChannelApi
import chat.rogi.rogichat.channelport.core.network.api.UploadApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import timber.log.Timber

class ChannelRepositoryImpl constructor(
    private val channelApi: ChannelApi,
    private val uploadApi: UploadApi,
) : ChannelRepository {

    override fun getPopularChannels(limit: Int): Flow<List<Channel>> = flow {
        try {
            val channels = channelApi.getPopularChannels(limit)
            emit(channels)
        } catch (e: Exception) {
            Timber.e(e, "Failed to get popular channels")
            emit(emptyList())
        }
    }

    override fun getRecentChannels(limit: Int): Flow<List<Channel>> = flow {
        try {
            val channels = channelApi.getRecentChannels(limit)
            emit(channels)
        } catch (e: Exception) {
            Timber.e(e, "Failed to get recent channels")
            emit(emptyList())
        }
    }

    override suspend fun getChannel(identifier: String): Result<Channel> = runCatching {
        channelApi.getChannel(identifier)
    }.onFailure { Timber.e(it, "Failed to get channel: $identifier") }

    override suspend fun getChannelProfile(channelId: Int): Result<ChannelProfile> = runCatching {
        channelApi.getChannelProfile(channelId)
    }.onFailure { Timber.e(it, "Failed to get channel profile: $channelId") }

    override suspend fun getChannelWardrobe(identifier: String): Result<ChannelWardrobeResponse> = runCatching {
        channelApi.getChannelWardrobe(identifier)
    }.onFailure { Timber.e(it, "Failed to get channel wardrobe: $identifier") }

    override suspend fun getChannelFeatureSettings(
        identifier: String,
    ): Result<chat.rogi.rogichat.channelport.core.model.channel.ChannelFeatureSettingsResponse> = runCatching {
        channelApi.getChannelFeatureSettings(identifier)
    }.onFailure { Timber.e(it, "Failed to get channel feature settings: $identifier") }

    override suspend fun getChannelPermission(identifier: String): Result<ChannelPermission> = runCatching {
        channelApi.getChannelPermission(identifier)
    }.onFailure { Timber.e(it, "Failed to get channel permission: $identifier") }

    override suspend fun searchChannels(
        keyword: String,
        page: Int,
        limit: Int,
    ): Result<List<Channel>> = runCatching {
        channelApi.searchChannels(keyword, page, limit).channels.map { it.toDomain() }
    }.onFailure { Timber.e(it, "Failed to search channels: $keyword") }

    override suspend fun getMyChannels(): Result<List<MyChannel>> = runCatching {
        channelApi.getMyChannels()
    }.onFailure { Timber.e(it, "Failed to get my channels") }

    override suspend fun updateChannel(
        identifier: String,
        request: UpdateChannelRequest,
    ): Result<Channel> = runCatching {
        channelApi.updateChannel(identifier, request)
    }.onFailure { Timber.e(it, "Failed to update channel: $identifier") }

    override suspend fun uploadImage(
        fileName: String,
        contentType: String,
        imageBytes: ByteArray,
    ): Result<UploadImageResponse> = runCatching {
        uploadApi.uploadImage(fileName, contentType, imageBytes)
    }.onFailure { Timber.e(it, "Failed to upload image") }

    override suspend fun getMembershipCatalog(channelId: Int): Result<ChannelMembershipCatalog> = runCatching {
        channelApi.getMembershipCatalog(channelId)
    }.onFailure { Timber.e(it, "Failed to get membership catalog: $channelId") }

    override suspend fun getMyMembership(channelId: Int): Result<MyChannelMembership> = runCatching {
        channelApi.getMyMembership(channelId)
    }.onFailure { Timber.e(it, "Failed to get my channel membership: $channelId") }

    override suspend fun getMembershipManagement(channelId: Int): Result<ChannelMembershipManagement> = runCatching {
        channelApi.getMembershipManagement(channelId)
    }.onFailure { Timber.e(it, "Failed to get membership management: $channelId") }

    override suspend fun createMembershipPlan(channelId: Int, request: CreateChannelMembershipPlanRequest): Result<Unit> = runCatching {
        channelApi.createMembershipPlan(channelId, request)
        Unit
    }.onFailure { Timber.e(it, "Failed to create membership plan: $channelId") }

    override suspend fun updateMembershipPlan(channelId: Int, planId: String, request: UpdateChannelMembershipPlanRequest): Result<Unit> = runCatching {
        channelApi.updateMembershipPlan(channelId, planId, request)
        Unit
    }.onFailure { Timber.e(it, "Failed to update membership plan: $channelId/$planId") }

    override suspend fun replaceMembershipPlanEmoticons(channelId: Int, planId: String, request: ReplaceChannelMembershipPlanEmoticonsRequest): Result<Unit> = runCatching {
        channelApi.replaceMembershipPlanEmoticons(channelId, planId, request)
        Unit
    }.onFailure { Timber.e(it, "Failed to replace membership emoticons: $channelId/$planId") }
}
