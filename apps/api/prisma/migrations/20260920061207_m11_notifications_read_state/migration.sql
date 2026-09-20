/*
  Warnings:

  - A unique constraint covering the columns `[id,user_id]` on the table `auth_sessions` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE `own_read_states` (
    `member_id` CHAR(36) NOT NULL,
    `stream_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `period_id` CHAR(36) NOT NULL,
    `last_read_order` BIGINT UNSIGNED NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`member_id`, `stream_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `user_id` CHAR(36) NOT NULL,
    `push_enabled` BOOLEAN NOT NULL DEFAULT false,
    `generation` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_subscriptions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `audience` VARCHAR(32) NOT NULL,
    `endpoint` VARCHAR(2048) NOT NULL,
    `endpoint_digest` BINARY(32) NOT NULL,
    `p256dh` VARCHAR(128) NOT NULL,
    `auth_secret` VARCHAR(64) NOT NULL,
    `generation` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `account_generation` BIGINT UNSIGNED NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `push_subscriptions_endpoint_digest_key`(`endpoint_digest`),
    INDEX `push_subscriptions_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    INDEX `push_subscriptions_session_id_user_id_idx`(`session_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_deliveries` (
    `id` CHAR(36) NOT NULL,
    `subscription_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `message_id` CHAR(36) NOT NULL,
    `subscription_generation` BIGINT UNSIGNED NOT NULL,
    `account_generation` BIGINT UNSIGNED NOT NULL,
    `preference_generation` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `push_deliveries_room_id_message_id_idx`(`room_id`, `message_id`),
    UNIQUE INDEX `push_deliveries_intent_key`(`subscription_id`, `message_id`, `subscription_generation`, `preference_generation`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `auth_sessions_id_user_id_key` ON `auth_sessions`(`id`, `user_id`);

-- AddForeignKey
ALTER TABLE `own_read_states` ADD CONSTRAINT `own_read_states_room_id_member_id_period_id_fkey` FOREIGN KEY (`room_id`, `member_id`, `period_id`) REFERENCES `membership_periods`(`room_id`, `member_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `own_read_states` ADD CONSTRAINT `own_read_states_room_id_stream_id_fkey` FOREIGN KEY (`room_id`, `stream_id`) REFERENCES `message_streams`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_session_id_user_id_fkey` FOREIGN KEY (`session_id`, `user_id`) REFERENCES `auth_sessions`(`id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `push_deliveries` ADD CONSTRAINT `push_deliveries_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `push_deliveries` ADD CONSTRAINT `push_deliveries_room_id_message_id_fkey` FOREIGN KEY (`room_id`, `message_id`) REFERENCES `messages`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
