-- DropForeignKey
ALTER TABLE `command_receipts` DROP FOREIGN KEY `command_receipts_room_id_message_id_fkey`;

-- DropForeignKey
ALTER TABLE `deletion_requests` DROP FOREIGN KEY `deletion_requests_room_id_message_id_fkey`;

-- AlterTable
ALTER TABLE `rooms` ADD COLUMN `content_epoch` BIGINT UNSIGNED NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `message_purge_checkpoints` (
    `request_id` CHAR(36) NOT NULL,
    `environment` VARCHAR(10) NOT NULL,
    `actor_user_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `target_id` CHAR(36) NOT NULL,
    `requested_at` DATETIME(3) NOT NULL,
    `ledger_sha256` BINARY(32) NOT NULL,
    `rows_purged_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`request_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- RenameIndex
ALTER TABLE `command_receipts` RENAME INDEX `command_receipts_room_id_message_id_fkey` TO `command_receipts_room_id_message_id_idx`;

-- RenameIndex
ALTER TABLE `deletion_requests` RENAME INDEX `deletion_requests_room_id_message_id_fkey` TO `deletion_requests_room_id_message_id_idx`;
