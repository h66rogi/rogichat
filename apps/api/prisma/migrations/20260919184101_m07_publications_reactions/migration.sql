-- CreateTable
CREATE TABLE `message_publications` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `source_message_id` CHAR(36) NOT NULL,
    `source_version` BIGINT UNSIGNED NOT NULL,
    `publisher_member_id` CHAR(36) NOT NULL,
    `published_message_id` CHAR(36) NULL,
    `state` ENUM('PREPARING', 'PUBLISHED', 'REVOKED') NOT NULL DEFAULT 'PREPARING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `message_publications_room_id_source_message_id_source_versio_key`(`room_id`, `source_message_id`, `source_version`),
    UNIQUE INDEX `message_publications_room_id_id_key`(`room_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_reactions` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `message_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `emoji` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `message_reactions_room_id_message_id_member_id_key`(`room_id`, `message_id`, `member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `message_publications` ADD CONSTRAINT `message_publications_room_id_source_message_id_fkey` FOREIGN KEY (`room_id`, `source_message_id`) REFERENCES `messages`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `message_publications` ADD CONSTRAINT `message_publications_room_id_published_message_id_fkey` FOREIGN KEY (`room_id`, `published_message_id`) REFERENCES `messages`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `message_publications` ADD CONSTRAINT `message_publications_room_id_publisher_member_id_fkey` FOREIGN KEY (`room_id`, `publisher_member_id`) REFERENCES `room_members`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `message_reactions` ADD CONSTRAINT `message_reactions_room_id_message_id_fkey` FOREIGN KEY (`room_id`, `message_id`) REFERENCES `messages`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `message_reactions` ADD CONSTRAINT `message_reactions_room_id_member_id_fkey` FOREIGN KEY (`room_id`, `member_id`) REFERENCES `room_members`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
