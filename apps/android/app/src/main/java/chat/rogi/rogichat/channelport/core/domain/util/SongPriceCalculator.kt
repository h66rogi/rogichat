package chat.rogi.rogichat.channelport.core.domain.util

import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.CurrencyConfig
import chat.rogi.rogichat.channelport.core.model.song.PricingSettings

enum class PriceSource {
    SONG,
    CATEGORY,
    DIFFICULTY,
    DEFAULT,
    FREE,
}

data class SongPriceInput(
    val price: Int? = null,
    val currencyPrices: Map<String, Int?>? = null,
    val difficulty: Int? = null,
    val categories: List<Category> = emptyList(),
)

data class CalculatedSongPrice(
    val price: Int?,
    val source: PriceSource,
    val currencyKey: String? = null,
)

data class SongPriceItem(
    val currencyKey: String,
    val price: Int?,
    val unit: String,
    val source: PriceSource,
)

object SongPriceCalculator {

    fun calculate(
        song: SongPriceInput,
        pricingSettings: PricingSettings?,
        currencyKey: String? = null,
    ): CalculatedSongPrice {
        // If pricing is disabled or settings are null, return FREE
        if (pricingSettings == null || !pricingSettings.pricingEnabled) {
            return CalculatedSongPrice(price = null, source = PriceSource.FREE, currencyKey = currencyKey)
        }

        val resolvedCurrencyKey = resolveCurrencyKey(song, pricingSettings, currencyKey)

        // Priority 1: Song's own price
        val songPrice = getPriceByCurrencyOrLegacy(
            song.currencyPrices,
            resolvedCurrencyKey,
            song.price
        )
        if (songPrice != null) {
            return CalculatedSongPrice(price = songPrice, source = PriceSource.SONG, currencyKey = resolvedCurrencyKey)
        }

        // Priority 2 & 3: Difficulty and Category (take the higher one)
        val difficultyPrice = getDifficultyPrice(
            song.difficulty,
            resolvedCurrencyKey,
            pricingSettings.difficultyPrices,
            pricingSettings.difficultyPricesByCurrency
        )
        val categoryPrice = getMaxCategoryPrice(song.categories, resolvedCurrencyKey)

        if (difficultyPrice != null || categoryPrice != null) {
            if (difficultyPrice != null && categoryPrice != null) {
                return if (difficultyPrice >= categoryPrice) {
                    CalculatedSongPrice(price = difficultyPrice, source = PriceSource.DIFFICULTY, currencyKey = resolvedCurrencyKey)
                } else {
                    CalculatedSongPrice(price = categoryPrice, source = PriceSource.CATEGORY, currencyKey = resolvedCurrencyKey)
                }
            }
            if (difficultyPrice != null) {
                return CalculatedSongPrice(price = difficultyPrice, source = PriceSource.DIFFICULTY, currencyKey = resolvedCurrencyKey)
            }
            return CalculatedSongPrice(price = categoryPrice, source = PriceSource.CATEGORY, currencyKey = resolvedCurrencyKey)
        }

        // Priority 4: Default price
        val defaultPrice = getPriceByCurrencyOrLegacy(
            pricingSettings.defaultPrices,
            resolvedCurrencyKey,
            pricingSettings.defaultPrice
        )
        if (defaultPrice != null) {
            return CalculatedSongPrice(price = defaultPrice, source = PriceSource.DEFAULT, currencyKey = resolvedCurrencyKey)
        }

        // No price found
        return CalculatedSongPrice(price = null, source = PriceSource.FREE, currencyKey = resolvedCurrencyKey)
    }

    fun getPriceItems(
        song: SongPriceInput,
        pricingSettings: PricingSettings?,
    ): List<SongPriceItem> {
        if (pricingSettings == null || !pricingSettings.pricingEnabled) {
            return emptyList()
        }

        val configs = normalizeCurrencyConfigs(pricingSettings.currencyConfigs)

        // Multi-currency mode
        if (configs.isNotEmpty()) {
            return configs.map { config ->
                val result = calculate(song, pricingSettings, currencyKey = config.key)
                SongPriceItem(
                    currencyKey = config.key,
                    price = result.price,
                    unit = config.unit,
                    source = result.source,
                )
            }
        }

        // Legacy single-currency mode
        val result = calculate(song, pricingSettings)
        if (result.price == null) {
            return emptyList()
        }
        return listOf(
            SongPriceItem(
                currencyKey = "",
                price = result.price,
                unit = pricingSettings.currencyUnit,
                source = result.source,
            )
        )
    }

    // -- Private helpers --

    private fun normalizeCurrencyConfigs(configs: List<CurrencyConfig>?): List<CurrencyConfig> {
        return (configs ?: emptyList()).filter { config ->
            config.key.trim().isNotEmpty() && config.unit.trim().isNotEmpty()
        }
    }

    private fun resolveCurrencyKey(
        song: SongPriceInput,
        pricingSettings: PricingSettings,
        preferredCurrencyKey: String?,
    ): String? {
        if (preferredCurrencyKey != null) {
            return preferredCurrencyKey
        }

        val configs = normalizeCurrencyConfigs(pricingSettings.currencyConfigs)
        if (configs.isNotEmpty()) {
            return configs[0].key
        }

        // Fallback: look for first key in any currency price map
        val priceMaps: List<Map<String, *>?> = buildList {
            add(song.currencyPrices)
            song.categories.forEach { add(it.currencyPrices) }
            add(pricingSettings.defaultPrices)
        }
        for (map in priceMaps) {
            if (map != null) {
                val firstKey = map.keys.firstOrNull()
                if (firstKey != null) {
                    return firstKey
                }
            }
        }

        return null
    }

    private fun getPriceByCurrencyOrLegacy(
        currencyPrices: Map<String, Int?>?,
        currencyKey: String?,
        legacyPrice: Int?,
    ): Int? {
        if (currencyKey != null && currencyPrices != null && currencyPrices.containsKey(currencyKey)) {
            return currencyPrices[currencyKey]
        }
        return legacyPrice
    }

    private fun getDifficultyPrice(
        difficulty: Int?,
        currencyKey: String?,
        difficultyPrices: Map<String, Int?>?,
        difficultyPricesByCurrency: Map<String, Map<String, Int?>?>?,
    ): Int? {
        if (difficulty == null) return null
        val key = difficulty.toString()

        if (currencyKey != null) {
            val byCurrency = difficultyPricesByCurrency?.get(currencyKey)
            if (byCurrency != null && byCurrency.containsKey(key)) {
                return byCurrency[key]
            }
        }

        return difficultyPrices?.get(key)
    }

    private fun getMaxCategoryPrice(
        categories: List<Category>,
        currencyKey: String?,
    ): Int? {
        if (categories.isEmpty()) return null

        val prices = categories.mapNotNull { category ->
            getPriceByCurrencyOrLegacy(category.currencyPrices, currencyKey, category.price)
        }
        if (prices.isEmpty()) return null
        return prices.max()
    }
}
