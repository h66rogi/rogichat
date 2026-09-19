-- AlterTable
ALTER TABLE `room_members` ADD COLUMN `acl_epoch` BIGINT UNSIGNED NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `profile_changes` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `public_changed` BOOLEAN NOT NULL,
    `streamer_changed` BOOLEAN NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `profile_changes_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
