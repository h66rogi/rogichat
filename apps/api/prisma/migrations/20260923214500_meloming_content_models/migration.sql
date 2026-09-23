-- AlterTable
ALTER TABLE `songs` ADD COLUMN `global_song_id` INTEGER NULL,
    ADD COLUMN `mr_video_key` VARCHAR(500) NULL,
    ADD COLUMN `mr_video_url` TEXT NULL,
    ADD COLUMN `preferred_lyrics_offset_ms` INTEGER NULL,
    ADD COLUMN `preferred_pitch_semitones` INTEGER NULL,
    ADD COLUMN `r2_cache_key` VARCHAR(200) NULL;

-- CreateTable
CREATE TABLE `song_video_preferences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `song_id` INTEGER NOT NULL,
    `video_key` VARCHAR(128) NOT NULL,
    `video_id` VARCHAR(20) NULL,
    `video_url` TEXT NULL,
    `preferred_lyrics_offset_ms` INTEGER NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_song_video_preferences_video_id`(`video_id`),
    UNIQUE INDEX `unique_song_video_preferences_song_video`(`song_id`, `video_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SongSheetMusic` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `songId` INTEGER NOT NULL,
    `url` TEXT NOT NULL,
    `type` ENUM('PDF', 'IMAGE', 'MUSICXML') NOT NULL,
    `fileName` VARCHAR(255) NULL,
    `fileSize` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPrimary` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SongSheetMusic_songId_sortOrder_idx`(`songId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `unique_songs_channel_globalsong` ON `songs`(`channel_id`, `global_song_id`);

-- AddForeignKey
ALTER TABLE `song_video_preferences` ADD CONSTRAINT `song_video_preferences_song_id_fkey` FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `SongSheetMusic` ADD CONSTRAINT `SongSheetMusic_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `songs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
