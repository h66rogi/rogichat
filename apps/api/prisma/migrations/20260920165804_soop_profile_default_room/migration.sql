-- AlterTable
ALTER TABLE `platform_soop` ADD COLUMN `profile_image_url` VARCHAR(2048) NULL,
    ADD COLUMN `profile_nickname` VARCHAR(40) NULL;

-- AlterTable
ALTER TABLE `user_profiles` ADD COLUMN `avatar_customized` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `nickname_customized` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `provider_profile_initialized` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `default_room_bindings` (
    `key` VARCHAR(32) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `owner_subject_digest` BINARY(32) NULL,
    `owner_bound` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `default_room_bindings_room_id_key`(`room_id`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
