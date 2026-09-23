CREATE TABLE `channel_pricing_settings` (
    `id` INTEGER NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `default_price` INTEGER NULL,
    `difficulty_prices` JSON NULL,
    `pricing_enabled` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `channel_pricing_settings_channel_id_key`(`channel_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `channel_pricing_settings` ADD CONSTRAINT `channel_pricing_settings_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
