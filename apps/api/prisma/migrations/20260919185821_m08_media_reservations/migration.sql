-- CreateTable
CREATE TABLE `media_budget` (
    `id` VARCHAR(16) NOT NULL,
    `reserved_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `limit_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 10737418240,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media_daily_usage` (
    `user_id` CHAR(36) NOT NULL,
    `day` DATE NOT NULL,
    `input_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,

    PRIMARY KEY (`user_id`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media_assets` (
    `id` CHAR(36) NOT NULL,
    `owner_user_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NULL,
    `kind` VARCHAR(16) NOT NULL,
    `content_type` VARCHAR(64) NOT NULL,
    `state` VARCHAR(16) NOT NULL DEFAULT 'RESERVED',
    `declared_bytes` BIGINT UNSIGNED NOT NULL,
    `reserved_bytes` BIGINT UNSIGNED NOT NULL,
    `upload_token` CHAR(36) NULL,
    `upload_until` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `media_assets_owner_user_id_state_expires_at_idx`(`owner_user_id`, `state`, `expires_at`),
    INDEX `media_assets_state_upload_until_idx`(`state`, `upload_until`),
    UNIQUE INDEX `media_assets_room_id_id_key`(`room_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media_objects` (
    `id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `attempt_id` CHAR(36) NOT NULL,
    `variant` VARCHAR(16) NOT NULL,
    `object_key` VARCHAR(191) NOT NULL,
    `state` VARCHAR(16) NOT NULL DEFAULT 'ALLOCATED',
    `byte_length` BIGINT UNSIGNED NULL,
    `sha256` CHAR(64) NULL,
    `width` INTEGER UNSIGNED NULL,
    `height` INTEGER UNSIGNED NULL,
    `duration_ms` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `media_objects_object_key_key`(`object_key`),
    UNIQUE INDEX `media_objects_asset_id_attempt_id_variant_key`(`asset_id`, `attempt_id`, `variant`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_attachments` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `message_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `position` TINYINT UNSIGNED NOT NULL,

    UNIQUE INDEX `message_attachments_room_id_message_id_position_key`(`room_id`, `message_id`, `position`),
    UNIQUE INDEX `message_attachments_asset_id_key`(`asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `media_daily_usage` ADD CONSTRAINT `media_daily_usage_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media_objects` ADD CONSTRAINT `media_objects_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_attachments` ADD CONSTRAINT `message_attachments_room_id_message_id_fkey` FOREIGN KEY (`room_id`, `message_id`) REFERENCES `messages`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `message_attachments` ADD CONSTRAINT `message_attachments_room_id_asset_id_fkey` FOREIGN KEY (`room_id`, `asset_id`) REFERENCES `media_assets`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
