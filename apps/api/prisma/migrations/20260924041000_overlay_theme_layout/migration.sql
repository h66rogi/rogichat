-- AlterTable
ALTER TABLE `channel_overlay_layouts` MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT;

-- CreateTable
CREATE TABLE `channel_overlay_themes` (
    `channel_id` CHAR(36) NOT NULL,
    `default_theme_id` VARCHAR(64) NOT NULL DEFAULT 'brutalist',
    `default_options_json` JSON NOT NULL,
    `updated_at` DATETIME(0) NOT NULL,

    PRIMARY KEY (`channel_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_overlay_widget_themes` (
    `channel_id` CHAR(36) NOT NULL,
    `widget_type` VARCHAR(32) NOT NULL,
    `theme_id` VARCHAR(64) NULL,
    `options_json` JSON NULL,
    `updated_at` DATETIME(0) NOT NULL,

    PRIMARY KEY (`channel_id`, `widget_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `channel_overlay_themes` ADD CONSTRAINT `channel_overlay_themes_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_overlay_widget_themes` ADD CONSTRAINT `channel_overlay_widget_themes_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channel_overlay_themes`(`channel_id`) ON DELETE CASCADE ON UPDATE CASCADE;
