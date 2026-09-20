/*
  Warnings:

  - A unique constraint covering the columns `[avatar_asset_id]` on the table `user_profiles` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `message_attachments_asset_id_key` ON `message_attachments`;

-- AlterTable
ALTER TABLE `admin_capabilities` ADD COLUMN `manage_stickers` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `user_profiles` ADD COLUMN `avatar_asset_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `room_media_policy` (
    `room_id` CHAR(36) NOT NULL,
    `photo_enabled` BOOLEAN NOT NULL DEFAULT true,
    `video_enabled` BOOLEAN NOT NULL DEFAULT true,
    `sticker_enabled` BOOLEAN NOT NULL DEFAULT true,
    `photo_max_bytes` INTEGER UNSIGNED NOT NULL DEFAULT 10485760,
    `video_max_bytes` INTEGER UNSIGNED NOT NULL DEFAULT 52428800,

    PRIMARY KEY (`room_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `message_attachments_asset_id_idx` ON `message_attachments`(`asset_id`);

-- CreateIndex
CREATE UNIQUE INDEX `user_profiles_avatar_asset_id_key` ON `user_profiles`(`avatar_asset_id`);

-- AddForeignKey
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_avatar_asset_id_fkey` FOREIGN KEY (`avatar_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_media_policy` ADD CONSTRAINT `room_media_policy_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
