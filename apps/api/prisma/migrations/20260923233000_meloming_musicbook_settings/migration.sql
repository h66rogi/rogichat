CREATE TABLE `channel_overlay_layouts` (
    `id` INTEGER NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `layout_type` VARCHAR(32) NOT NULL,
    `layout_json` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uq_channel_overlay_layouts_channel_type`(`channel_id`, `layout_type`),
    INDEX `idx_channel_overlay_layouts_channel_id`(`channel_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `channel_overlay_layouts` ADD CONSTRAINT `channel_overlay_layouts_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
