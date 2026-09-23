CREATE TABLE `user_channel_favorites` (
    `id` INTEGER NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `sort_order` INTEGER NULL,
    `created_at` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `unique_user_channel_favorite`(`user_id`, `channel_id`),
    INDEX `idx_user_channel_favorites_user_sort`(`user_id`, `sort_order`),
    INDEX `idx_user_channel_favorites_user_created`(`user_id`, `created_at`),
    INDEX `idx_user_channel_favorites_channel_created`(`channel_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_channel_favorites` ADD CONSTRAINT `user_channel_favorites_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `user_channel_favorites` ADD CONSTRAINT `user_channel_favorites_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
