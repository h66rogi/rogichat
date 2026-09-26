import Foundation

// MARK: - Domain Models

struct PricingSettings {
    let channelId: Int
    let pricingEnabled: Bool
    let defaultPrice: Int?
    let defaultPrices: [String: Int?]?
    let difficultyPrices: [String: Int?]?
    let difficultyPricesByCurrency: [String: [String: Int?]?]?
    let currencyUnit: String
    let currencyConfigs: [CurrencyConfig]
}

struct CurrencyConfig: Identifiable {
    var id: String { key }
    let key: String
    let unit: String
    let amount: Int?
}

// MARK: - DTOs

struct PricingSettingsDTO: Decodable {
    let channelId: Int?
    let pricingEnabled: Bool?
    let defaultPrice: Int?
    let defaultPrices: [String: Int?]?
    let difficultyPrices: [String: Int?]?
    let difficultyPricesByCurrency: [String: [String: Int?]?]?
    let currencyUnit: String?
    let currencyConfigs: [CurrencyConfigDTO]?

    func toDomain() -> PricingSettings {
        PricingSettings(
            channelId: channelId ?? 0,
            pricingEnabled: pricingEnabled ?? false,
            defaultPrice: defaultPrice,
            defaultPrices: defaultPrices,
            difficultyPrices: difficultyPrices,
            difficultyPricesByCurrency: difficultyPricesByCurrency,
            currencyUnit: currencyUnit ?? "",
            currencyConfigs: currencyConfigs?.map { $0.toDomain() } ?? []
        )
    }
}

struct CurrencyConfigDTO: Decodable {
    let key: String
    let unit: String
    let amount: Int?

    func toDomain() -> CurrencyConfig {
        CurrencyConfig(key: key, unit: unit, amount: amount)
    }
}

// MARK: - Request Payload

struct UpdatePricingSettingsPayload: Encodable {
    let pricingEnabled: Bool?
    let defaultPrice: Int?
    let defaultPrices: [String: Int?]?
    let difficultyPrices: [String: Int?]?
    let difficultyPricesByCurrency: [String: [String: Int?]?]?
    let currencyConfigs: [CurrencyConfigPayload]?

    init(
        pricingEnabled: Bool? = nil,
        defaultPrice: Int? = nil,
        defaultPrices: [String: Int?]? = nil,
        difficultyPrices: [String: Int?]? = nil,
        difficultyPricesByCurrency: [String: [String: Int?]?]? = nil,
        currencyConfigs: [CurrencyConfigPayload]? = nil
    ) {
        self.pricingEnabled = pricingEnabled
        self.defaultPrice = defaultPrice
        self.defaultPrices = defaultPrices
        self.difficultyPrices = difficultyPrices
        self.difficultyPricesByCurrency = difficultyPricesByCurrency
        self.currencyConfigs = currencyConfigs
    }
}

struct CurrencyConfigPayload: Encodable {
    let key: String
    let unit: String
    let amount: Int?
}
