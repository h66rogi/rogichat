package chat.rogi.rogichat.channelport.core.model.song

import kotlinx.serialization.Serializable

// MARK: - Domain Models

data class PricingSettings(
    val channelId: Int,
    val pricingEnabled: Boolean,
    val defaultPrice: Int?,
    val defaultPrices: Map<String, Int?>?,
    val difficultyPrices: Map<String, Int?>?,
    val difficultyPricesByCurrency: Map<String, Map<String, Int?>?>?,
    val currencyUnit: String,
    val currencyConfigs: List<CurrencyConfig>,
)

data class CurrencyConfig(
    val key: String,
    val unit: String,
    val amount: Int?,
)

// MARK: - DTOs

@Serializable
data class PricingSettingsDto(
    val channelId: Int = 0,
    val pricingEnabled: Boolean = false,
    val defaultPrice: Int? = null,
    val defaultPrices: Map<String, Int?>? = null,
    val difficultyPrices: Map<String, Int?>? = null,
    val difficultyPricesByCurrency: Map<String, Map<String, Int?>?>? = null,
    val currencyUnit: String = "",
    val currencyConfigs: List<CurrencyConfigDto> = emptyList(),
) {
    fun toDomain(): PricingSettings = PricingSettings(
        channelId = channelId,
        pricingEnabled = pricingEnabled,
        defaultPrice = defaultPrice,
        defaultPrices = defaultPrices,
        difficultyPrices = difficultyPrices,
        difficultyPricesByCurrency = difficultyPricesByCurrency,
        currencyUnit = currencyUnit,
        currencyConfigs = currencyConfigs.map { it.toDomain() },
    )
}

@Serializable
data class CurrencyConfigDto(
    val key: String,
    val unit: String,
    val amount: Int? = null,
) {
    fun toDomain(): CurrencyConfig = CurrencyConfig(
        key = key,
        unit = unit,
        amount = amount,
    )
}

@Serializable
data class UpdatePricingSettingsPayload(
    val pricingEnabled: Boolean? = null,
    val defaultPrice: Int? = null,
    val defaultPrices: Map<String, Int?>? = null,
    val difficultyPrices: Map<String, Int?>? = null,
    val difficultyPricesByCurrency: Map<String, Map<String, Int?>?>? = null,
    val currencyConfigs: List<CurrencyConfigDto>? = null,
)
