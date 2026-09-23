-- CreateTable
CREATE TABLE `global_artists` (
    `id` INTEGER NOT NULL,
    `canonical_name` VARCHAR(255) NOT NULL,
    `norm_key` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `global_artists_norm_key_key`(`norm_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `global_artist_aliases` (
    `id` INTEGER NOT NULL,
    `global_artist_id` INTEGER NOT NULL,
    `alias` VARCHAR(255) NOT NULL,
    `norm_alias` VARCHAR(255) NOT NULL,
    `frequency` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `global_artist_aliases_norm_alias_idx`(`norm_alias`),
    UNIQUE INDEX `global_artist_aliases_global_artist_id_norm_alias_key`(`global_artist_id`, `norm_alias`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `global_songs` (
    `id` INTEGER NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `norm_title` VARCHAR(255) NOT NULL,
    `global_artist_id` INTEGER NOT NULL,
    `album_art` TEXT NULL,
    `channel_count` INTEGER NOT NULL DEFAULT 0,
    `norm_version` SMALLINT NOT NULL DEFAULT 1,
    `entity_confidence` ENUM('HIGH', 'MEDIUM', 'LOW') NOT NULL DEFAULT 'MEDIUM',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `global_songs_norm_title_idx`(`norm_title`),
    INDEX `global_songs_global_artist_id_idx`(`global_artist_id`),
    INDEX `global_songs_channel_count_idx`(`channel_count` DESC),
    UNIQUE INDEX `global_songs_norm_title_global_artist_id_key`(`norm_title`, `global_artist_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `global_song_aliases` (
    `id` INTEGER NOT NULL,
    `global_song_id` INTEGER NOT NULL,
    `alias_title` VARCHAR(255) NOT NULL,
    `norm_alias_title` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `global_song_aliases_norm_alias_title_idx`(`norm_alias_title`),
    UNIQUE INDEX `global_song_aliases_global_song_id_norm_alias_title_key`(`global_song_id`, `norm_alias_title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `songs` ADD CONSTRAINT `songs_global_song_id_fkey` FOREIGN KEY (`global_song_id`) REFERENCES `global_songs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_artist_aliases` ADD CONSTRAINT `global_artist_aliases_global_artist_id_fkey` FOREIGN KEY (`global_artist_id`) REFERENCES `global_artists`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_songs` ADD CONSTRAINT `global_songs_global_artist_id_fkey` FOREIGN KEY (`global_artist_id`) REFERENCES `global_artists`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_song_aliases` ADD CONSTRAINT `global_song_aliases_global_song_id_fkey` FOREIGN KEY (`global_song_id`) REFERENCES `global_songs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
