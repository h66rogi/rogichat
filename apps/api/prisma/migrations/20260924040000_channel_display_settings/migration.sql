-- CreateTable
CREATE TABLE `channel_display_settings` (
    `channel_id` CHAR(36) NOT NULL,
    `profile_image_url` VARCHAR(2048) NULL,
    `additional_links` JSON NULL,
    `theme_color` VARCHAR(7) NOT NULL DEFAULT '#ff8c9d',
    `channel_description` TEXT NULL,
    `visibility` VARCHAR(8) NOT NULL DEFAULT 'PUBLIC',
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`channel_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `channel_display_settings` ADD CONSTRAINT `channel_display_settings_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
