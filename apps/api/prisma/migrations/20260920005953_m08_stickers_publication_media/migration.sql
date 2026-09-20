/*
  Warnings:

  - A unique constraint covering the columns `[asset_id,id]` on the table `media_objects` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE `sticker_catalog` (
    `id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `label` VARCHAR(64) NOT NULL,
    `registered_by_user_id` CHAR(36) NOT NULL,
    `approved_by_user_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sticker_catalog_asset_id_key`(`asset_id`),
    INDEX `sticker_catalog_status_id_idx`(`status`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_stickers` (
    `room_id` CHAR(36) NOT NULL,
    `message_id` CHAR(36) NOT NULL,
    `sticker_id` CHAR(36) NOT NULL,

    PRIMARY KEY (`room_id`, `message_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `publication_media` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `publication_id` CHAR(36) NOT NULL,
    `position` TINYINT UNSIGNED NOT NULL,
    `source_asset_id` CHAR(36) NOT NULL,
    `source_object_id` CHAR(36) NOT NULL,
    `destination_asset_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `publication_media_destination_asset_id_key`(`destination_asset_id`),
    UNIQUE INDEX `publication_media_publication_id_position_key`(`publication_id`, `position`),
    UNIQUE INDEX `publication_media_room_id_destination_asset_id_key`(`room_id`, `destination_asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `media_objects_asset_id_id_key` ON `media_objects`(`asset_id`, `id`);

-- AddForeignKey
ALTER TABLE `sticker_catalog` ADD CONSTRAINT `sticker_catalog_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sticker_catalog` ADD CONSTRAINT `sticker_catalog_registered_by_user_id_fkey` FOREIGN KEY (`registered_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sticker_catalog` ADD CONSTRAINT `sticker_catalog_approved_by_user_id_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_stickers` ADD CONSTRAINT `message_stickers_room_id_message_id_fkey` FOREIGN KEY (`room_id`, `message_id`) REFERENCES `messages`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `message_stickers` ADD CONSTRAINT `message_stickers_sticker_id_fkey` FOREIGN KEY (`sticker_id`) REFERENCES `sticker_catalog`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `publication_media` ADD CONSTRAINT `publication_media_room_id_publication_id_fkey` FOREIGN KEY (`room_id`, `publication_id`) REFERENCES `message_publications`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `publication_media` ADD CONSTRAINT `publication_media_room_id_source_asset_id_fkey` FOREIGN KEY (`room_id`, `source_asset_id`) REFERENCES `media_assets`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `publication_media` ADD CONSTRAINT `publication_media_source_asset_id_source_object_id_fkey` FOREIGN KEY (`source_asset_id`, `source_object_id`) REFERENCES `media_objects`(`asset_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `publication_media` ADD CONSTRAINT `publication_media_room_id_destination_asset_id_fkey` FOREIGN KEY (`room_id`, `destination_asset_id`) REFERENCES `media_assets`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
