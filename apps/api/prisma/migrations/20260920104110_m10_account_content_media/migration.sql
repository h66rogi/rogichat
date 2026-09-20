-- CreateTable
CREATE TABLE `account_content_checkpoints` (
    `request_id` CHAR(36) NOT NULL,
    `message_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `content_owner_user_id` CHAR(36) NOT NULL,
    `deletion_root_id` CHAR(36) NULL,
    `environment` VARCHAR(10) NOT NULL,
    `requested_at` DATETIME(3) NOT NULL,
    `ledger_sha256` BINARY(32) NOT NULL,
    `rows_purged_at` DATETIME(3) NULL,

    INDEX `account_content_checkpoints_room_id_message_id_idx`(`room_id`, `message_id`),
    PRIMARY KEY (`request_id`, `message_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_media_provenance` (
    `request_id` CHAR(36) NOT NULL,
    `reference_kind` VARCHAR(16) NOT NULL,
    `reference_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `content_owner_user_id` CHAR(36) NOT NULL,
    `asset_owner_user_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NULL,
    `requested_at` DATETIME(3) NOT NULL,
    `ledger_sha256` BINARY(32) NOT NULL,
    `disposition` VARCHAR(16) NOT NULL,

    INDEX `account_media_provenance_asset_id_idx`(`asset_id`),
    PRIMARY KEY (`request_id`, `reference_kind`, `reference_id`, `asset_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media_cleanup_checkpoints` (
    `asset_id` CHAR(36) NOT NULL,
    `object_cursor` CHAR(36) NULL,

    PRIMARY KEY (`asset_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media_cleanup_attempts` (
    `object_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `attempt_id` CHAR(36) NOT NULL,
    `object_key` VARCHAR(191) NOT NULL,
    `writer_acknowledged` BOOLEAN NOT NULL DEFAULT false,
    `delete_observed_at` DATETIME(3) NULL,

    INDEX `media_cleanup_attempts_asset_id_object_id_idx`(`asset_id`, `object_id`),
    PRIMARY KEY (`object_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_media_scans` (
    `request_id` CHAR(36) NOT NULL,
    `asset_cursor` CHAR(36) NULL,

    PRIMARY KEY (`request_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
