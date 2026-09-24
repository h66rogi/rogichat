-- CreateTable
CREATE TABLE `lyrics_quota_settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `free_limit` INTEGER NULL,
    `pro_limit` INTEGER NULL,
    `updated_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lyrics_quota_windows` (
    `user_id` CHAR(36) NOT NULL,
    `window_started_at` DATETIME(3) NULL,
    `window_ends_at` DATETIME(3) NULL,
    `used_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_lyrics_quota_window_end`(`window_ends_at`),
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lyrics_quota_consumptions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` CHAR(36) NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `live_session_id` INTEGER NOT NULL,
    `song_request_id` INTEGER NOT NULL,
    `window_started_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_lyrics_quota_user_window`(`user_id`, `window_started_at`),
    UNIQUE INDEX `uq_lyrics_quota_consumption_context`(`channel_id`, `live_session_id`, `song_request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `lyrics_quota_windows` ADD CONSTRAINT `lyrics_quota_windows_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lyrics_quota_consumptions` ADD CONSTRAINT `lyrics_quota_consumptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lyrics_quota_consumptions` ADD CONSTRAINT `lyrics_quota_consumptions_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lyrics_quota_consumptions` ADD CONSTRAINT `lyrics_quota_consumptions_live_session_id_fkey` FOREIGN KEY (`live_session_id`) REFERENCES `live_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lyrics_quota_consumptions` ADD CONSTRAINT `lyrics_quota_consumptions_song_request_id_fkey` FOREIGN KEY (`song_request_id`) REFERENCES `song_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
