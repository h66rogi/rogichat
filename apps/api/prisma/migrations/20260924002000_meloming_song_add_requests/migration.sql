CREATE TABLE `song_add_requests` (
    `id` INTEGER NOT NULL,
    `requester_id` CHAR(36) NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `artist_name` VARCHAR(255) NOT NULL,
    `album_art` TEXT NULL,
    `karaoke_url` TEXT NULL,
    `cover_url` TEXT NULL,
    `original_url` TEXT NULL,
    `difficulty` INTEGER NULL,
    `proficiency` INTEGER NULL,
    `song_key` VARCHAR(20) NULL,
    `bpm` INTEGER NULL,
    `lyrics_link` TEXT NULL,
    `lyrics_text` TEXT NULL,
    `category_names` TEXT NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'canceled') NOT NULL DEFAULT 'pending',
    `processed_by_id` CHAR(36) NULL,
    `processed_at` DATETIME(0) NULL,
    `rejection_reason` VARCHAR(500) NULL,
    `approved_song_id` INTEGER NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `song_add_requests_approved_song_id_key`(`approved_song_id`),
    INDEX `idx_song_add_requests_requester_status`(`requester_id`, `status`),
    INDEX `idx_song_add_requests_channel_status`(`channel_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `song_add_requests` ADD CONSTRAINT `song_add_requests_requester_id_fkey` FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `song_add_requests` ADD CONSTRAINT `song_add_requests_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `song_add_requests` ADD CONSTRAINT `song_add_requests_processed_by_id_fkey` FOREIGN KEY (`processed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `song_add_requests` ADD CONSTRAINT `song_add_requests_approved_song_id_fkey` FOREIGN KEY (`approved_song_id`) REFERENCES `songs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
