-- CreateTable
CREATE TABLE `video_cache_entries` (
    `video_id` VARCHAR(20) NOT NULL,
    `r2_key` VARCHAR(200) NOT NULL,
    `itag` VARCHAR(20) NOT NULL DEFAULT '18',
    `source` VARCHAR(20) NOT NULL DEFAULT 'youtube',
    `cached_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `last_hit_at` DATETIME(0) NULL,

    PRIMARY KEY (`video_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
