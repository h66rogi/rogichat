-- CreateTable
CREATE TABLE `live_sessions` (
    `id` INTEGER NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `platform` ENUM('soop', 'chzzk', 'cime', 'youtube', 'meloming', 'other') NULL,
    `platform_channel_id` VARCHAR(64) NULL,
    `status` ENUM('active', 'ended', 'paused') NOT NULL DEFAULT 'active',
    `session_type` ENUM('standard', 'sync') NOT NULL DEFAULT 'standard',
    `visibility` ENUM('PUBLIC', 'PRIVATE') NOT NULL DEFAULT 'PUBLIC',
    `overlay_token` VARCHAR(64) NOT NULL,
    `started_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `ended_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `playback_revision` INTEGER NOT NULL DEFAULT 0,

    INDEX `idx_live_session_channel_status`(`channel_id`, `status`),
    INDEX `idx_live_session_channel_type_status`(`channel_id`, `session_type`, `status`),
    INDEX `idx_live_session_channel_status_visibility`(`channel_id`, `status`, `visibility`),
    INDEX `idx_live_session_user_id`(`user_id`),
    INDEX `idx_live_session_overlay_token`(`overlay_token`),
    INDEX `idx_live_session_platform_channel_status`(`platform`, `platform_channel_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `song_requests` (
    `id` INTEGER NOT NULL,
    `live_session_id` INTEGER NOT NULL,
    `song_id` INTEGER NULL,
    `source_channel_id` CHAR(36) NULL,
    `raw_artist` VARCHAR(255) NOT NULL,
    `raw_title` VARCHAR(255) NOT NULL,
    `raw_message` TEXT NULL,
    `requester_platform_id` VARCHAR(64) NOT NULL,
    `requester_nickname` VARCHAR(255) NOT NULL,
    `status` ENUM('pending', 'accepted', 'rejected', 'playing', 'completed') NOT NULL DEFAULT 'pending',
    `source` ENUM('chat', 'donation', 'manual', 'competitor') NOT NULL DEFAULT 'chat',
    `request_type` ENUM('normal', 'random') NOT NULL DEFAULT 'normal',
    `donation_amount` INTEGER NULL,
    `donation_native_amount` INTEGER NULL,
    `donation_currency` VARCHAR(191) NULL,
    `donation_rate_version` INTEGER NULL,
    `stream_message_id` VARCHAR(128) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `queue_order` INTEGER NOT NULL DEFAULT 0,
    `calculated_price` INTEGER NULL,
    `price_source` ENUM('song', 'category', 'difficulty', 'default', 'free') NULL,
    `played_at` DATETIME(0) NULL,
    `completed_at` DATETIME(0) NULL,
    `rejection_reason` VARCHAR(255) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `request_user_id` CHAR(36) NULL,
    `is_anonymous` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `song_requests_stream_message_id_key`(`stream_message_id`),
    INDEX `idx_song_request_session_status`(`live_session_id`, `status`),
    INDEX `idx_song_request_queue_order`(`live_session_id`, `queue_order`),
    INDEX `idx_song_request_source_channel`(`source_channel_id`),
    INDEX `idx_song_request_song_id`(`song_id`),
    INDEX `idx_song_request_song_created`(`song_id`, `created_at` DESC),
    INDEX `idx_song_request_session_requester_status`(`live_session_id`, `requester_platform_id`, `status`),
    INDEX `idx_song_request_user_id`(`request_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `live_session_settings` (
    `id` INTEGER NOT NULL,
    `live_session_id` INTEGER NOT NULL,
    `request_enabled` BOOLEAN NOT NULL DEFAULT true,
    `paused` BOOLEAN NOT NULL DEFAULT false,
    `request_command` VARCHAR(50) NOT NULL DEFAULT '!신청',
    `max_queue_size` INTEGER NOT NULL DEFAULT 50,
    `donation_priority_enabled` BOOLEAN NOT NULL DEFAULT true,
    `enforce_donation_minimum_price` BOOLEAN NOT NULL DEFAULT true,
    `karaoke_playback_mode` ENUM('direct', 'youtube') NOT NULL DEFAULT 'direct',
    `karaoke_video_type` ENUM('karaoke', 'original') NOT NULL DEFAULT 'karaoke',
    `donation_only_enabled` BOOLEAN NOT NULL DEFAULT false,
    `request_mode` ENUM('everyone', 'verified_only', 'chat_only') NOT NULL DEFAULT 'everyone',
    `chat_request_enabled` BOOLEAN NOT NULL DEFAULT true,
    `donation_request_enabled` BOOLEAN NOT NULL DEFAULT true,
    `allow_anonymous` BOOLEAN NOT NULL DEFAULT false,
    `require_song_match` BOOLEAN NOT NULL DEFAULT true,
    `random_request_enabled` BOOLEAN NOT NULL DEFAULT true,
    `sync_chat_requests_enabled` BOOLEAN NOT NULL DEFAULT true,
    `sync_random_song_command` VARCHAR(50) NOT NULL DEFAULT '!노래랜덤',
    `sync_random_song_min_donation` INTEGER NOT NULL DEFAULT 100,
    `sync_random_streamer_command` VARCHAR(50) NOT NULL DEFAULT '!스트리머랜덤',
    `sync_random_streamer_min_donation` INTEGER NOT NULL DEFAULT 100,
    `prevent_duplicate_songs` BOOLEAN NOT NULL DEFAULT false,
    `blocked_category_ids` JSON NOT NULL,
    `max_requests_per_user` INTEGER NOT NULL DEFAULT 0,
    `max_total_requests` INTEGER NOT NULL DEFAULT 50,
    `show_requester_name` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `live_session_settings_live_session_id_key`(`live_session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_song_request_settings` (
    `id` INTEGER NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `request_command` VARCHAR(50) NOT NULL DEFAULT '!신청',
    `max_queue_size` INTEGER NOT NULL DEFAULT 50,
    `donation_priority_enabled` BOOLEAN NOT NULL DEFAULT true,
    `enforce_donation_minimum_price` BOOLEAN NOT NULL DEFAULT true,
    `karaoke_playback_mode` ENUM('direct', 'youtube') NOT NULL DEFAULT 'direct',
    `karaoke_video_type` ENUM('karaoke', 'original') NOT NULL DEFAULT 'karaoke',
    `donation_only_enabled` BOOLEAN NOT NULL DEFAULT false,
    `request_mode` ENUM('everyone', 'verified_only', 'chat_only') NOT NULL DEFAULT 'everyone',
    `chat_request_enabled` BOOLEAN NOT NULL DEFAULT true,
    `donation_request_enabled` BOOLEAN NOT NULL DEFAULT true,
    `allow_anonymous` BOOLEAN NOT NULL DEFAULT false,
    `require_song_match` BOOLEAN NOT NULL DEFAULT true,
    `random_request_enabled` BOOLEAN NOT NULL DEFAULT true,
    `prevent_duplicate_songs` BOOLEAN NOT NULL DEFAULT false,
    `blocked_category_ids` JSON NOT NULL,
    `max_requests_per_user` INTEGER NOT NULL DEFAULT 0,
    `max_total_requests` INTEGER NOT NULL DEFAULT 50,
    `show_requester_name` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `channel_song_request_settings_channel_id_key`(`channel_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `live_sessions` ADD CONSTRAINT `live_sessions_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_sessions` ADD CONSTRAINT `live_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_requests` ADD CONSTRAINT `song_requests_live_session_id_fkey` FOREIGN KEY (`live_session_id`) REFERENCES `live_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_requests` ADD CONSTRAINT `song_requests_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_requests` ADD CONSTRAINT `song_requests_source_channel_id_fkey` FOREIGN KEY (`source_channel_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_requests` ADD CONSTRAINT `song_requests_request_user_id_fkey` FOREIGN KEY (`request_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `live_session_settings` ADD CONSTRAINT `live_session_settings_live_session_id_fkey` FOREIGN KEY (`live_session_id`) REFERENCES `live_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_song_request_settings` ADD CONSTRAINT `channel_song_request_settings_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
