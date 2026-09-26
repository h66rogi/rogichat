package chat.rogi.rogichat.channelport.core.domain.repository

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
import kotlinx.coroutines.flow.Flow

interface ChannelRepository {
    fun getPopularChannels(limit: Int = 20): Flow<List<Channel>>
    fun getRecentChannels(limit: Int = 20): Flow<List<Channel>>
    suspend fun getChannel(identifier: String): Result<Channel>
    suspend fun getChannelProfile(channelId: Int): Result<ChannelProfile>
    suspend fun getChannelWardrobe(identifier: String): Result<ChannelWardrobeResponse>
    suspend fun getChannelPermission(identifier: String): Result<ChannelPermission>
    suspend fun getChannelFeatureSettings(
        identifier: String,
    ): Result<chat.rogi.rogichat.channelport.core.model.channel.ChannelFeatureSettingsResponse>
    suspend fun searchChannels(keyword: String, page: Int, limit: Int): Result<List<Channel>>
    suspend fun getMyChannels(): Result<List<MyChannel>>
    suspend fun updateChannel(identifier: String, request: UpdateChannelRequest): Result<Channel>
    suspend fun uploadImage(fileName: String, contentType: String, imageBytes: ByteArray): Result<UploadImageResponse>
    suspend fun getMembershipCatalog(channelId: Int): Result<ChannelMembershipCatalog>
    suspend fun getMyMembership(channelId: Int): Result<MyChannelMembership>
    suspend fun getMembershipManagement(channelId: Int): Result<ChannelMembershipManagement>
    suspend fun createMembershipPlan(channelId: Int, request: CreateChannelMembershipPlanRequest): Result<Unit>
    suspend fun updateMembershipPlan(channelId: Int, planId: String, request: UpdateChannelMembershipPlanRequest): Result<Unit>
    suspend fun replaceMembershipPlanEmoticons(channelId: Int, planId: String, request: ReplaceChannelMembershipPlanEmoticonsRequest): Result<Unit>
}
