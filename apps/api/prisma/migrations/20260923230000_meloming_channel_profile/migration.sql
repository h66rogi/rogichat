-- CreateTable
CREATE TABLE `channel_profiles` (
    `id` INTEGER NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `birthday` DATETIME(0) NULL,
    `residence` VARCHAR(255) NULL,
    `heightCm` VARCHAR(32) NULL,
    `weightKg` VARCHAR(32) NULL,
    `nationality` VARCHAR(100) NULL,
    `gender` ENUM('MALE', 'FEMALE', 'NONBINARY', 'OTHER', 'SECRET') NULL,
    `symbolColor` VARCHAR(20) NULL,
    `agency` VARCHAR(255) NULL,
    `nickname` VARCHAR(100) NULL,
    `description` LONGTEXT NULL,
    `affiliatedGroups` JSON NULL,
    `fandomName` VARCHAR(100) NULL,
    `religion` VARCHAR(100) NULL,
    `education` JSON NULL,
    `mbti` ENUM('ISTJ', 'ISTP', 'ISFJ', 'ISFP', 'INTJ', 'INTP', 'INFJ', 'INFP', 'ESTP', 'ESTJ', 'ESFP', 'ESFJ', 'ENTP', 'ENTJ', 'ENFP', 'ENFJ') NULL,
    `alias` JSON NULL,
    `debutDate` DATETIME(0) NULL,
    `broadcastingPlatforms` JSON NULL,
    `bio` TEXT NULL,
    `links` JSON NULL,
    `home_description` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `channel_profiles_channel_id_key`(`channel_id`),
    INDEX `idx_channel_profile_channel_id`(`channel_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `channel_profiles` ADD CONSTRAINT `channel_profiles_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
