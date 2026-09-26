package chat.rogi.rogichat.channelport.core.domain.util

import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.CurrencyConfig
import chat.rogi.rogichat.channelport.core.model.song.PricingSettings
import org.junit.Assert.*
import org.junit.Test

class SongPriceCalculatorTest {

    // Helper factories
    private fun makeSettings(
        pricingEnabled: Boolean = true,
        defaultPrice: Int? = null,
        defaultPrices: Map<String, Int?>? = null,
        difficultyPrices: Map<String, Int?>? = null,
        difficultyPricesByCurrency: Map<String, Map<String, Int?>?>? = null,
        currencyUnit: String = "",
        currencyConfigs: List<CurrencyConfig> = emptyList(),
    ) = PricingSettings(
        channelId = 1,
        pricingEnabled = pricingEnabled,
        defaultPrice = defaultPrice,
        defaultPrices = defaultPrices,
        difficultyPrices = difficultyPrices,
        difficultyPricesByCurrency = difficultyPricesByCurrency,
        currencyUnit = currencyUnit,
        currencyConfigs = currencyConfigs,
    )

    private fun makeSong(
        price: Int? = null,
        currencyPrices: Map<String, Int?>? = null,
        difficulty: Int? = null,
        categories: List<Category> = emptyList(),
    ) = SongPriceInput(
        price = price,
        currencyPrices = currencyPrices,
        difficulty = difficulty,
        categories = categories,
    )

    private fun makeCategory(
        price: Int? = null,
        currencyPrices: Map<String, Int?>? = null,
    ) = Category(id = 1, name = "Test", color = null, price = price, currencyPrices = currencyPrices)

    // Pricing Disabled
    @Test
    fun `pricing disabled returns free`() {
        val result = SongPriceCalculator.calculate(makeSong(price = 500), makeSettings(pricingEnabled = false))
        assertNull(result.price)
        assertEquals(PriceSource.FREE, result.source)
    }

    @Test
    fun `null settings returns free`() {
        val result = SongPriceCalculator.calculate(makeSong(price = 500), null)
        assertNull(result.price)
        assertEquals(PriceSource.FREE, result.source)
    }

    // Song Price (Priority 1)
    @Test
    fun `song direct price`() {
        val result = SongPriceCalculator.calculate(makeSong(price = 1000), makeSettings())
        assertEquals(1000, result.price)
        assertEquals(PriceSource.SONG, result.source)
    }

    @Test
    fun `song currency price`() {
        val result = SongPriceCalculator.calculate(
            makeSong(currencyPrices = mapOf("SOOP_BALLOON" to 500)),
            makeSettings(currencyConfigs = listOf(CurrencyConfig("SOOP_BALLOON", "byeolpungseon", null))),
            currencyKey = "SOOP_BALLOON"
        )
        assertEquals(500, result.price)
        assertEquals(PriceSource.SONG, result.source)
    }

    @Test
    fun `currency price takes priority over legacy`() {
        val result = SongPriceCalculator.calculate(
            makeSong(price = 1000, currencyPrices = mapOf("SOOP_BALLOON" to 300)),
            makeSettings(currencyConfigs = listOf(CurrencyConfig("SOOP_BALLOON", "byeolpungseon", null))),
            currencyKey = "SOOP_BALLOON"
        )
        assertEquals(300, result.price)
        assertEquals(PriceSource.SONG, result.source)
    }

    // Difficulty Price (Priority 2)
    @Test
    fun `difficulty price legacy`() {
        val result = SongPriceCalculator.calculate(
            makeSong(difficulty = 3),
            makeSettings(difficultyPrices = mapOf("3" to 500))
        )
        assertEquals(500, result.price)
        assertEquals(PriceSource.DIFFICULTY, result.source)
    }

    @Test
    fun `difficulty price by currency`() {
        val result = SongPriceCalculator.calculate(
            makeSong(difficulty = 4),
            makeSettings(
                difficultyPricesByCurrency = mapOf("SOOP_BALLOON" to mapOf("4" to 800)),
                currencyConfigs = listOf(CurrencyConfig("SOOP_BALLOON", "byeolpungseon", null))
            ),
            currencyKey = "SOOP_BALLOON"
        )
        assertEquals(800, result.price)
        assertEquals(PriceSource.DIFFICULTY, result.source)
    }

    // Category Price (Priority 3)
    @Test
    fun `category price max of multiple`() {
        val result = SongPriceCalculator.calculate(
            makeSong(categories = listOf(makeCategory(price = 200), makeCategory(price = 500), makeCategory(price = 100))),
            makeSettings()
        )
        assertEquals(500, result.price)
        assertEquals(PriceSource.CATEGORY, result.source)
    }

    // Difficulty vs Category
    @Test
    fun `difficulty higher than category`() {
        val result = SongPriceCalculator.calculate(
            makeSong(difficulty = 3, categories = listOf(makeCategory(price = 500))),
            makeSettings(difficultyPrices = mapOf("3" to 800))
        )
        assertEquals(800, result.price)
        assertEquals(PriceSource.DIFFICULTY, result.source)
    }

    @Test
    fun `category higher than difficulty`() {
        val result = SongPriceCalculator.calculate(
            makeSong(difficulty = 3, categories = listOf(makeCategory(price = 500))),
            makeSettings(difficultyPrices = mapOf("3" to 300))
        )
        assertEquals(500, result.price)
        assertEquals(PriceSource.CATEGORY, result.source)
    }

    // Default Price (Priority 4)
    @Test
    fun `default price legacy`() {
        val result = SongPriceCalculator.calculate(makeSong(), makeSettings(defaultPrice = 200))
        assertEquals(200, result.price)
        assertEquals(PriceSource.DEFAULT, result.source)
    }

    @Test
    fun `default price by currency`() {
        val result = SongPriceCalculator.calculate(
            makeSong(),
            makeSettings(
                defaultPrices = mapOf("SOOP_BALLOON" to 100),
                currencyConfigs = listOf(CurrencyConfig("SOOP_BALLOON", "byeolpungseon", null))
            ),
            currencyKey = "SOOP_BALLOON"
        )
        assertEquals(100, result.price)
        assertEquals(PriceSource.DEFAULT, result.source)
    }

    // Free
    @Test
    fun `no price anywhere returns free`() {
        val result = SongPriceCalculator.calculate(makeSong(), makeSettings())
        assertNull(result.price)
        assertEquals(PriceSource.FREE, result.source)
    }

    // Full Priority Chain
    @Test
    fun `song price overrides difficulty and default`() {
        val result = SongPriceCalculator.calculate(
            makeSong(price = 2000, difficulty = 3),
            makeSettings(defaultPrice = 100, difficultyPrices = mapOf("3" to 500))
        )
        assertEquals(2000, result.price)
        assertEquals(PriceSource.SONG, result.source)
    }

    // Multi-currency getPriceItems
    @Test
    fun `multi currency returns item per config`() {
        val items = SongPriceCalculator.getPriceItems(
            makeSong(),
            makeSettings(
                defaultPrices = mapOf("SOOP_BALLOON" to 500, "CHZZK_CHEESE" to 2000),
                currencyConfigs = listOf(
                    CurrencyConfig("SOOP_BALLOON", "byeolpungseon", null),
                    CurrencyConfig("CHZZK_CHEESE", "cheese", null)
                )
            )
        )
        assertEquals(2, items.size)
        assertEquals("SOOP_BALLOON", items[0].currencyKey)
        assertEquals(500, items[0].price)
        assertEquals("byeolpungseon", items[0].unit)
        assertEquals("CHZZK_CHEESE", items[1].currencyKey)
        assertEquals(2000, items[1].price)
        assertEquals("cheese", items[1].unit)
    }

    @Test
    fun `pricing disabled returns empty items`() {
        val items = SongPriceCalculator.getPriceItems(makeSong(price = 500), makeSettings(pricingEnabled = false))
        assertTrue(items.isEmpty())
    }

    @Test
    fun `explicit null currency price skips song price and falls through`() {
        val result = SongPriceCalculator.calculate(
            makeSong(price = 1000, currencyPrices = mapOf("SOOP_BALLOON" to null)),
            makeSettings(
                defaultPrice = 500,
                currencyConfigs = listOf(CurrencyConfig("SOOP_BALLOON", "별풍선", null))
            ),
            currencyKey = "SOOP_BALLOON"
        )
        // Currency key exists with null value -> songPrice is null -> falls through to default
        assertEquals(500, result.price)
        assertEquals(PriceSource.DEFAULT, result.source)
    }

    @Test
    fun `price of zero is valid price not free`() {
        val result = SongPriceCalculator.calculate(
            makeSong(price = 0),
            makeSettings()
        )
        assertEquals(0, result.price)
        assertEquals(PriceSource.SONG, result.source)
    }
}
