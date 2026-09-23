-- Meloming Clip/ClipChannel/ClipStat/ClipRequest, with Rogichat room/user UUID FKs.
CREATE TABLE `clips` (
  `id` INTEGER NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `platform` ENUM('youtube', 'soop', 'chzzk', 'meloming') NOT NULL DEFAULT 'meloming',
  `video_id` VARCHAR(100) NULL,
  `video_url` TEXT NULL,
  `thumbnail_url` TEXT NULL,
  `duration` INTEGER NULL,
  `status` ENUM('visible', 'hidden', 'deleted') NOT NULL DEFAULT 'visible',
  `content_type` ENUM('song_clip', 'uploaded_clip') NOT NULL DEFAULT 'song_clip',
  `publish_to_hot_clip` BOOLEAN NOT NULL DEFAULT true,
  `media_type` ENUM('embed', 'direct_file') NOT NULL DEFAULT 'embed',
  `self_hosted` BOOLEAN NOT NULL DEFAULT false,
  `auto_generated` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `deleted_at` DATETIME(0) NULL,
  INDEX `idx_clips_status_created` (`status`, `created_at`),
  INDEX `idx_clips_platform_video_id` (`platform`, `video_id`),
  INDEX `idx_clips_content_type_status_created` (`content_type`, `status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `clip_channels` (
  `id` INTEGER NOT NULL,
  `clip_id` INTEGER NOT NULL,
  `channel_id` CHAR(36) NOT NULL,
  `song_id` INTEGER NULL,
  `is_primary` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  INDEX `idx_clip_channels_song_id` (`song_id`),
  UNIQUE INDEX `uq_clip_channel` (`clip_id`, `channel_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `clip_stats` (
  `clip_id` INTEGER NOT NULL,
  `like_count` INTEGER NOT NULL DEFAULT 0,
  `comment_count` INTEGER NOT NULL DEFAULT 0,
  `view_count` INTEGER NOT NULL DEFAULT 0,
  `hot_score` DOUBLE NOT NULL DEFAULT 0,
  INDEX `idx_clip_stats_hot_score` (`hot_score`),
  PRIMARY KEY (`clip_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `clip_requests` (
  `id` INTEGER NOT NULL,
  `requester_id` CHAR(36) NOT NULL,
  `channel_id` CHAR(36) NOT NULL,
  `song_id` INTEGER NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `platform` ENUM('youtube', 'soop', 'chzzk', 'meloming') NOT NULL DEFAULT 'meloming',
  `video_id` VARCHAR(100) NULL,
  `video_url` TEXT NULL,
  `thumbnail_url` TEXT NULL,
  `duration` INTEGER NULL,
  `publish_to_hot_clip` BOOLEAN NOT NULL DEFAULT true,
  `status` ENUM('pending', 'approved', 'rejected', 'canceled') NOT NULL DEFAULT 'pending',
  `processed_by_id` CHAR(36) NULL,
  `processed_at` DATETIME(0) NULL,
  `rejection_reason` VARCHAR(500) NULL,
  `approved_clip_id` INTEGER NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  UNIQUE INDEX `clip_requests_approved_clip_id_key` (`approved_clip_id`),
  INDEX `idx_clip_requests_requester_status` (`requester_id`, `status`),
  INDEX `idx_clip_requests_channel_status` (`channel_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `clip_channels` ADD CONSTRAINT `clip_channels_clip_id_fkey` FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `clip_channels` ADD CONSTRAINT `clip_channels_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `clip_channels` ADD CONSTRAINT `clip_channels_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `clip_stats` ADD CONSTRAINT `clip_stats_clip_id_fkey` FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `clip_requests` ADD CONSTRAINT `clip_requests_requester_id_fkey` FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `clip_requests` ADD CONSTRAINT `clip_requests_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `clip_requests` ADD CONSTRAINT `clip_requests_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `clip_requests` ADD CONSTRAINT `clip_requests_processed_by_id_fkey` FOREIGN KEY (`processed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `clip_requests` ADD CONSTRAINT `clip_requests_approved_clip_id_fkey` FOREIGN KEY (`approved_clip_id`) REFERENCES `clips`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
