package chat.rogi.rogichat.channelport.core.model.channel

import kotlinx.serialization.Serializable

/**
 * The public membership catalogue returned by the API. Store product IDs are
 * identifiers only; the localized price must always be read from Play Billing.
 */
@Serializable
data class ChannelMembershipCatalog(
    val channel: ChannelMembershipChannel,
    val plans: List<ChannelMembershipPlan> = emptyList(),
)

@Serializable
data class ChannelMembershipChannel(
    val id: Int,
    val name: String,
)

@Serializable
data class ChannelMembershipPlan(
    val id: String,
    val code: String,
    val name: String,
    val description: String? = null,
    val webMonthlyPrice: Int = 0,
    val iosProductId: String? = null,
    val androidProductId: String? = null,
    val iosMonthlyPrice: Int? = null,
    val androidMonthlyPrice: Int? = null,
    val availableOn: ChannelMembershipAvailability = ChannelMembershipAvailability(),
    val emoticons: List<ChannelMembershipEmoticon> = emptyList(),
)

@Serializable
data class ChannelMembershipAvailability(
    val web: Boolean = false,
    val ios: Boolean = false,
    val android: Boolean = false,
)

@Serializable
data class ChannelMembershipEmoticon(
    val id: Int,
    val shortcode: String,
    val imageUrl: String,
    val imageType: String,
)

@Serializable
data class MyChannelMembership(
    val channel: ChannelMembershipChannel,
    val plans: List<ChannelMembershipPlan> = emptyList(),
    val membership: ChannelMembershipEntitlement? = null,
)

@Serializable
data class ChannelMembershipEntitlement(
    val id: String,
    val plan: ChannelMembershipPlanReference,
    val endsAt: String,
    val autoRenew: Boolean,
    val billingSource: String,
)

@Serializable
data class ChannelMembershipPlanReference(
    val id: String,
    val code: String,
    val name: String,
)

/** Creator-only channel membership settings. Provider product mapping and
 * settlement economics are deliberately omitted from this native surface. */
@Serializable
data class ChannelMembershipManagement(
    val channel: ChannelMembershipChannel,
    val plans: List<ChannelMembershipManagedPlan> = emptyList(),
    val availableEmoticons: List<ChannelMembershipEmoticon> = emptyList(),
)

@Serializable
data class ChannelMembershipManagedPlan(
    val id: String,
    val code: String,
    val name: String,
    val description: String? = null,
    val isActive: Boolean = false,
    val sortOrder: Int = 0,
    val hasIOSProduct: Boolean = false,
    val hasAndroidProduct: Boolean = false,
    val webMonthlyPrice: Int = 0,
    val iosMonthlyPrice: Int? = null,
    val androidMonthlyPrice: Int? = null,
    val emoticonIds: List<Int> = emptyList(),
)

@Serializable
data class CreateChannelMembershipPlanRequest(
    val code: String,
    val name: String,
    val description: String? = null,
    val webMonthlyPrice: Int,
    val isActive: Boolean = false,
    val sortOrder: Int = 0,
)

@Serializable
data class UpdateChannelMembershipPlanRequest(
    val name: String,
    val description: String? = null,
    val webMonthlyPrice: Int,
    val isActive: Boolean,
    val sortOrder: Int,
)

@Serializable
data class ReplaceChannelMembershipPlanEmoticonsRequest(
    val emoticonIds: List<Int>,
)

@Serializable
data class ChannelMembershipEmoticonReplacement(
    val planId: String,
    val emoticonIds: List<Int> = emptyList(),
)
