-- AlterTable
ALTER TABLE `global_songs` ADD COLUMN `iswc` VARCHAR(15) NULL,
    ADD COLUMN `matcher_attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `matcher_confidence` ENUM('HIGH', 'MEDIUM', 'LOW') NULL,
    ADD COLUMN `matcher_last_at` DATETIME(3) NULL,
    ADD COLUMN `matcher_source` ENUM('PRIMARY', 'ALTERNATE_LLM', 'AGENT_RECOVER', 'MANUAL') NULL,
    ADD COLUMN `matcher_status` ENUM('PENDING', 'MATCHED', 'MATCHED_NO_LYRICS', 'MATCHED_INSTRUMENTAL', 'MATCHED_RESTRICTED', 'MATCHED_DUP_OF_OTHER', 'UNMATCHED', 'MANUAL_NEEDED', 'IGNORED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `mxm_album_art_url` TEXT NULL,
    ADD COLUMN `mxm_album_id` INTEGER NULL,
    ADD COLUMN `mxm_album_name` VARCHAR(255) NULL,
    ADD COLUMN `mxm_commontrack_id` INTEGER NULL,
    ADD COLUMN `mxm_explicit` BOOLEAN NULL,
    ADD COLUMN `mxm_genres_json` JSON NULL,
    ADD COLUMN `mxm_has_lyrics` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `mxm_has_richsync` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `mxm_has_subtitles` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `mxm_instrumental` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `mxm_rating` INTEGER NULL,
    ADD COLUMN `mxm_share_url` TEXT NULL,
    ADD COLUMN `mxm_track_id` INTEGER NULL,
    ADD COLUMN `mxm_track_length_sec` INTEGER NULL,
    ADD COLUMN `primary_isrc` VARCHAR(15) NULL,
    ADD COLUMN `spotify_track_id` VARCHAR(30) NULL;

-- CreateTable
CREATE TABLE `global_song_lyrics` (
    `global_song_id` INTEGER NOT NULL,
    `source` ENUM('MUSIXMATCH', 'MANUAL') NOT NULL DEFAULT 'MUSIXMATCH',
    `external_id` VARCHAR(50) NULL,
    `body` MEDIUMTEXT NOT NULL,
    `body_ko_pron` MEDIUMTEXT NULL,
    `body_ko_pron_at` DATETIME(3) NULL,
    `body_translation` MEDIUMTEXT NULL,
    `body_translation_language` VARCHAR(8) NULL,
    `body_translation_at` DATETIME(3) NULL,
    `language` VARCHAR(8) NULL,
    `has_subtitle` BOOLEAN NOT NULL DEFAULT false,
    `subtitle_id` VARCHAR(50) NULL,
    `subtitle_body` MEDIUMTEXT NULL,
    `subtitle_length` INTEGER NULL,
    `has_richsync` BOOLEAN NOT NULL DEFAULT false,
    `richsync_id` VARCHAR(50) NULL,
    `richsync_body` LONGTEXT NULL,
    `copyright_line` VARCHAR(500) NULL,
    `tracking_script_url` TEXT NULL,
    `tracking_pixel_url` TEXT NULL,
    `share_url` TEXT NULL,
    `restricted_kr` BOOLEAN NOT NULL DEFAULT false,
    `restrictions_raw` JSON NULL,
    `fetched_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `global_song_lyrics_fetched_at_idx`(`fetched_at`),
    INDEX `global_song_lyrics_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`global_song_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `global_songs_mxm_track_id_idx` ON `global_songs`(`mxm_track_id`);

-- CreateIndex
CREATE INDEX `global_songs_mxm_commontrack_id_idx` ON `global_songs`(`mxm_commontrack_id`);

-- CreateIndex
CREATE INDEX `global_songs_primary_isrc_idx` ON `global_songs`(`primary_isrc`);

-- CreateIndex
CREATE INDEX `global_songs_matcher_last_at_idx` ON `global_songs`(`matcher_last_at`);

-- CreateIndex
CREATE INDEX `global_songs_matcher_status_matcher_attempts_channel_count_idx` ON `global_songs`(`matcher_status`, `matcher_attempts`, `channel_count` DESC);

-- AddForeignKey
ALTER TABLE `global_song_lyrics` ADD CONSTRAINT `global_song_lyrics_global_song_id_fkey` FOREIGN KEY (`global_song_id`) REFERENCES `global_songs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
