CREATE TABLE `song_export_logs` (
    `id` INTEGER NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `song_count` INTEGER NOT NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` TEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_song_export_log_user_id`(`user_id`),
    INDEX `idx_song_export_log_channel_id`(`channel_id`),
    INDEX `idx_song_export_log_created_at`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
