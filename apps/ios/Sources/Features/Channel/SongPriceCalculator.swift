import Foundation

enum PriceSource: String, Equatable {
    case song = "SONG"
    case category = "CATEGORY"
    case difficulty = "DIFFICULTY"
    case default_ = "DEFAULT"
    case free = "FREE"
}

struct SongPriceInput {
    let price: Int?
    let currencyPrices: [String: Int?]?
    let difficulty: Int?
    let categories: [Category]
}

struct CalculatedSongPrice {
    let price: Int?
    let source: PriceSource
    let currencyKey: String?
}

struct SongRequestPriceItem {
    let currencyKey: String?
    let unit: String
    let price: Int?
    let source: PriceSource
}

enum SongPriceCalculator {

    static func calculate(
        song: SongPriceInput,
        settings: PricingSettings?,
        currencyKey: String? = nil
    ) -> CalculatedSongPrice {
        guard let settings = settings, settings.pricingEnabled else {
            return CalculatedSongPrice(price: nil, source: .free, currencyKey: currencyKey)
        }

        let resolvedKey = currencyKey ?? resolveCurrencyKey(song: song, settings: settings)

        // Priority 1: Song price
        let songPrice = getPriceByCurrencyOrLegacy(
            currencyPrices: song.currencyPrices,
            currencyKey: resolvedKey,
            legacyPrice: song.price
        )
        if songPrice != nil {
            return CalculatedSongPrice(price: songPrice, source: .song, currencyKey: resolvedKey)
        }

        // Priority 2 & 3: Difficulty and Category (higher wins)
        let difficultyPrice = getDifficultyPrice(
            difficulty: song.difficulty,
            currencyKey: resolvedKey,
            difficultyPrices: settings.difficultyPrices,
            difficultyPricesByCurrency: settings.difficultyPricesByCurrency
        )
        let categoryPrice = getMaxCategoryPrice(
            categories: song.categories,
            currencyKey: resolvedKey
        )

        if difficultyPrice != nil || categoryPrice != nil {
            if let dp = difficultyPrice, let cp = categoryPrice {
                if dp >= cp {
                    return CalculatedSongPrice(price: dp, source: .difficulty, currencyKey: resolvedKey)
                }
                return CalculatedSongPrice(price: cp, source: .category, currencyKey: resolvedKey)
            }
            if let dp = difficultyPrice {
                return CalculatedSongPrice(price: dp, source: .difficulty, currencyKey: resolvedKey)
            }
            return CalculatedSongPrice(price: categoryPrice, source: .category, currencyKey: resolvedKey)
        }

        // Priority 4: Default price
        let defaultPrice = getPriceByCurrencyOrLegacy(
            currencyPrices: settings.defaultPrices,
            currencyKey: resolvedKey,
            legacyPrice: settings.defaultPrice
        )
        if defaultPrice != nil {
            return CalculatedSongPrice(price: defaultPrice, source: .default_, currencyKey: resolvedKey)
        }

        return CalculatedSongPrice(price: nil, source: .free, currencyKey: resolvedKey)
    }

    static func getPriceItems(
        song: SongPriceInput,
        settings: PricingSettings?
    ) -> [SongRequestPriceItem] {
        guard let settings = settings, settings.pricingEnabled else {
            return []
        }

        let configs = settings.currencyConfigs.filter { !$0.key.isEmpty && !$0.unit.isEmpty }

        if !configs.isEmpty {
            let items = configs.map { config in
                let result = calculate(song: song, settings: settings, currencyKey: config.key)
                return SongRequestPriceItem(
                    currencyKey: config.key,
                    unit: config.unit,
                    price: result.price,
                    source: result.source
                )
            }
            let priced = items.filter { $0.price != nil }
            if !priced.isEmpty { return priced }
            return items.isEmpty ? [] : [items[0]]
        }

        let result = calculate(song: song, settings: settings)
        return [SongRequestPriceItem(
            currencyKey: result.currencyKey,
            unit: resolveUnit(currencyKey: result.currencyKey, settings: settings),
            price: result.price,
            source: result.source
        )]
    }

    // MARK: - Private Helpers

    private static func getPriceByCurrencyOrLegacy(
        currencyPrices: [String: Int?]?,
        currencyKey: String?,
        legacyPrice: Int?
    ) -> Int? {
        if let key = currencyKey,
           let prices = currencyPrices,
           prices.keys.contains(key) {
            return prices[key] ?? nil
        }
        return legacyPrice
    }

    private static func getDifficultyPrice(
        difficulty: Int?,
        currencyKey: String?,
        difficultyPrices: [String: Int?]?,
        difficultyPricesByCurrency: [String: [String: Int?]?]?
    ) -> Int? {
        guard let difficulty = difficulty else { return nil }
        let key = String(difficulty)

        if let currencyKey = currencyKey,
           let byCurrency = difficultyPricesByCurrency?[currencyKey],
           let map = byCurrency,
           map.keys.contains(key) {
            return map[key] ?? nil
        }

        if let prices = difficultyPrices, prices.keys.contains(key) {
            return prices[key] ?? nil
        }

        return nil
    }

    private static func getMaxCategoryPrice(
        categories: [Category],
        currencyKey: String?
    ) -> Int? {
        let prices = categories.compactMap { category -> Int? in
            getPriceByCurrencyOrLegacy(
                currencyPrices: category.currencyPrices,
                currencyKey: currencyKey,
                legacyPrice: category.price
            )
        }
        return prices.isEmpty ? nil : prices.max()
    }

    private static func resolveCurrencyKey(
        song: SongPriceInput,
        settings: PricingSettings
    ) -> String? {
        let configs = settings.currencyConfigs.filter { !$0.key.isEmpty && !$0.unit.isEmpty }
        if let first = configs.first { return first.key }

        // Check song currencyPrices
        if let key = song.currencyPrices?.keys.first { return key }
        // Check category currencyPrices
        for cat in song.categories {
            if let key = cat.currencyPrices?.keys.first { return key }
        }
        // Check defaultPrices
        if let key = settings.defaultPrices?.keys.first { return key }

        return nil
    }

    private static func resolveUnit(currencyKey: String?, settings: PricingSettings) -> String {
        if let key = currencyKey,
           let config = settings.currencyConfigs.first(where: { $0.key == key }) {
            return config.unit
        }
        if !settings.currencyUnit.isEmpty { return settings.currencyUnit }
        return ""
    }
}
