-- CreateTable
CREATE TABLE `sticker_audit_events` (
    `id` CHAR(36) NOT NULL,
    `sticker_id` CHAR(36) NOT NULL,
    `actor_user_id` CHAR(36) NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sticker_audit_events_sticker_id_created_at_idx`(`sticker_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sticker_audit_events` ADD CONSTRAINT `sticker_audit_events_sticker_id_fkey` FOREIGN KEY (`sticker_id`) REFERENCES `sticker_catalog`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sticker_audit_events` ADD CONSTRAINT `sticker_audit_events_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
