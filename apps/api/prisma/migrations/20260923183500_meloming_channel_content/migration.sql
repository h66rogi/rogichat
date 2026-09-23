-- CreateTable
CREATE TABLE `channel_schedules` (
    `id` INTEGER NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `author_user_id` CHAR(36) NOT NULL,
    `recurring_schedule_id` INTEGER NULL,
    `title` VARCHAR(100) NOT NULL,
    `content` TEXT NULL,
    `start_at` DATETIME(0) NOT NULL,
    `end_at` DATETIME(0) NULL,
    `all_day` BOOLEAN NOT NULL DEFAULT false,
    `is_canceled` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('live', 'collab', 'off', 'etc', 'tbd') NOT NULL DEFAULT 'tbd',
    `visibility` ENUM('PUBLIC', 'PRIVATE') NOT NULL DEFAULT 'PUBLIC',
    `location` VARCHAR(255) NULL,
    `external_url` VARCHAR(500) NULL,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `deleted_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_channel_schedule_channel_start`(`channel_id`, `start_at`),
    INDEX `idx_channel_schedule_author_start`(`author_user_id`, `start_at`),
    INDEX `idx_channel_schedule_is_deleted`(`is_deleted`),
    INDEX `idx_channel_schedule_recurring`(`recurring_schedule_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_recurring_schedules` (
    `id` INTEGER NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `day_of_week` INTEGER NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `start_time` VARCHAR(5) NULL,
    `status` ENUM('live', 'off') NOT NULL DEFAULT 'live',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `channel_recurring_schedules_channel_id_day_of_week_key`(`channel_id`, `day_of_week`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_wardrobe_categories` (
    `id` INTEGER NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `default_aspect_ratio` VARCHAR(8) NOT NULL DEFAULT '1:1',
    `is_enabled` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_channel_wardrobe_categories_channel_order`(`channel_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_wardrobe_items` (
    `id` INTEGER NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `category_id` INTEGER NOT NULL,
    `title` VARCHAR(40) NOT NULL,
    `image_url` TEXT NOT NULL,
    `description` TEXT NULL,
    `tags` JSON NULL,
    `is_visible` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_channel_wardrobe_items_channel_order`(`channel_id`, `sort_order`),
    INDEX `idx_channel_wardrobe_items_category_order`(`category_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` INTEGER NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `color` VARCHAR(32) NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `display_order` INTEGER NULL,
    `price` INTEGER NULL,
    `currency_prices` JSON NULL,
    `created_at` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_categories_channel_id`(`channel_id`),
    INDEX `idx_categories_channel_display_order`(`channel_id`, `display_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `artists` (
    `id` INTEGER NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `name_searchable` VARCHAR(255) NOT NULL DEFAULT '',
    `channel_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_artists_channel_id`(`channel_id`),
    INDEX `idx_artists_name_searchable`(`name_searchable`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `songs` (
    `id` INTEGER NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `title_searchable` VARCHAR(255) NOT NULL DEFAULT '',
    `artist_id` INTEGER NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `album_art` TEXT NULL,
    `karaoke_url` TEXT NULL,
    `cover_url` TEXT NULL,
    `original_url` TEXT NULL,
    `difficulty` INTEGER NULL DEFAULT 1,
    `proficiency` INTEGER NULL,
    `song_key` VARCHAR(40) NULL,
    `bpm` INTEGER NULL,
    `lyrics_link` TEXT NULL,
    `lyrics_text` TEXT NULL,
    `description` TEXT NULL,
    `price` INTEGER NULL,
    `currency_prices` JSON NULL,
    `created_at` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_songs_channel_id`(`channel_id`),
    INDEX `idx_songs_artist_id`(`artist_id`),
    INDEX `idx_songs_title_searchable`(`title_searchable`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_song_likes` (
    `id` INTEGER NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `song_id` INTEGER NOT NULL,
    `created_at` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_user_song_likes_user_created`(`user_id`, `created_at`),
    INDEX `idx_user_song_likes_song_created`(`song_id`, `created_at`),
    UNIQUE INDEX `unique_user_song_like`(`user_id`, `song_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `song_categories` (
    `id` INTEGER NOT NULL,
    `song_id` INTEGER NOT NULL,
    `category_id` INTEGER NOT NULL,

    INDEX `idx_song_categories_category_id`(`category_id`),
    INDEX `idx_song_categories_song_id`(`song_id`),
    UNIQUE INDEX `song_categories_song_id_category_id_key`(`song_id`, `category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_content_counters` (
    `key` VARCHAR(32) NOT NULL,
    `value` INTEGER NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `channel_schedules` ADD CONSTRAINT `channel_schedules_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_schedules` ADD CONSTRAINT `channel_schedules_author_user_id_fkey` FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_schedules` ADD CONSTRAINT `channel_schedules_recurring_schedule_id_fkey` FOREIGN KEY (`recurring_schedule_id`) REFERENCES `channel_recurring_schedules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_recurring_schedules` ADD CONSTRAINT `channel_recurring_schedules_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_wardrobe_categories` ADD CONSTRAINT `channel_wardrobe_categories_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_wardrobe_items` ADD CONSTRAINT `channel_wardrobe_items_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_wardrobe_items` ADD CONSTRAINT `channel_wardrobe_items_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `channel_wardrobe_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `artists` ADD CONSTRAINT `artists_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `songs` ADD CONSTRAINT `songs_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `songs` ADD CONSTRAINT `songs_artist_id_fkey` FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_song_likes` ADD CONSTRAINT `user_song_likes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_song_likes` ADD CONSTRAINT `user_song_likes_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_categories` ADD CONSTRAINT `song_categories_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `song_categories` ADD CONSTRAINT `song_categories_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
