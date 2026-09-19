-- CreateTable
CREATE TABLE `stream_pairs` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `left_member_id` CHAR(36) NOT NULL,
    `right_member_id` CHAR(36) NOT NULL,
    `stream_id` CHAR(36) NOT NULL,

    UNIQUE INDEX `stream_pairs_stream_id_key`(`stream_id`),
    UNIQUE INDEX `stream_pairs_room_id_left_member_id_right_member_id_key`(`room_id`, `left_member_id`, `right_member_id`),
    UNIQUE INDEX `stream_pairs_room_id_stream_id_key`(`room_id`, `stream_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `stream_id` CHAR(36) NOT NULL,
    `sender_member_id` CHAR(36) NOT NULL,
    `content_owner_user_id` CHAR(36) NOT NULL,
    `deletion_root_id` CHAR(36) NULL,
    `quote_id` CHAR(36) NULL,
    `content_kind` VARCHAR(16) NOT NULL DEFAULT 'TEXT',
    `text_content` TEXT NULL,
    `version` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `created_order` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,
    `moderated` BOOLEAN NOT NULL DEFAULT false,

    INDEX `messages_room_id_stream_id_created_order_idx`(`room_id`, `stream_id`, `created_order`),
    INDEX `messages_room_id_created_order_idx`(`room_id`, `created_order`),
    INDEX `messages_content_owner_user_id_deleted_at_idx`(`content_owner_user_id`, `deleted_at`),
    UNIQUE INDEX `messages_room_id_id_key`(`room_id`, `id`),
    UNIQUE INDEX `messages_room_id_stream_id_id_key`(`room_id`, `stream_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `command_receipts` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `actor_id` CHAR(36) NOT NULL,
    `client_message_id` CHAR(36) NOT NULL,
    `message_id` CHAR(36) NOT NULL,
    `digest_version` TINYINT UNSIGNED NOT NULL DEFAULT 1,
    `payload_digest` BINARY(32) NULL,
    `deleted` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `command_receipts_room_id_actor_id_client_message_id_key`(`room_id`, `actor_id`, `client_message_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `room_events` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `stream_id` CHAR(36) NOT NULL,
    `message_id` CHAR(36) NOT NULL,
    `message_version` BIGINT UNSIGNED NOT NULL,
    `event_order` BIGINT UNSIGNED NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `room_events_room_id_stream_id_event_order_idx`(`room_id`, `stream_id`, `event_order`),
    UNIQUE INDEX `room_events_room_id_event_order_key`(`room_id`, `event_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deletion_requests` (
    `id` CHAR(36) NOT NULL,
    `actor_user_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `message_id` CHAR(36) NOT NULL,
    `state` ENUM('BLOCKED', 'PURGING', 'LIVE_PURGED', 'BACKUPS_EXPIRED') NOT NULL DEFAULT 'BLOCKED',
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `deletion_requests_actor_user_id_message_id_key`(`actor_user_id`, `message_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` CHAR(36) NOT NULL,
    `purpose` ENUM('REALTIME_HINT', 'MEDIA', 'PUBLICATION', 'PURGE', 'PUSH', 'LEDGER_EXPORT') NOT NULL,
    `room_id` CHAR(36) NULL,
    `resource_id` CHAR(36) NULL,
    `state` ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `generation` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `lease_owner` CHAR(36) NULL,
    `lease_token` CHAR(36) NULL,
    `lease_until` DATETIME(3) NULL,
    `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attempts` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `max_attempts` INTEGER UNSIGNED NOT NULL DEFAULT 5,
    `last_error_code` VARCHAR(32) NULL,
    `dedupe_key` BINARY(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `jobs_purpose_state_available_at_id_idx`(`purpose`, `state`, `available_at`, `id`),
    INDEX `jobs_purpose_state_lease_until_id_idx`(`purpose`, `state`, `lease_until`, `id`),
    UNIQUE INDEX `jobs_purpose_dedupe_key_key`(`purpose`, `dedupe_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `stream_pairs` ADD CONSTRAINT `stream_pairs_room_id_left_member_id_fkey` FOREIGN KEY (`room_id`, `left_member_id`) REFERENCES `room_members`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stream_pairs` ADD CONSTRAINT `stream_pairs_room_id_right_member_id_fkey` FOREIGN KEY (`room_id`, `right_member_id`) REFERENCES `room_members`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stream_pairs` ADD CONSTRAINT `stream_pairs_room_id_stream_id_fkey` FOREIGN KEY (`room_id`, `stream_id`) REFERENCES `message_streams`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_room_id_stream_id_fkey` FOREIGN KEY (`room_id`, `stream_id`) REFERENCES `message_streams`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_room_id_sender_member_id_fkey` FOREIGN KEY (`room_id`, `sender_member_id`) REFERENCES `room_members`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_content_owner_user_id_fkey` FOREIGN KEY (`content_owner_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_room_id_deletion_root_id_fkey` FOREIGN KEY (`room_id`, `deletion_root_id`) REFERENCES `messages`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_room_id_quote_id_fkey` FOREIGN KEY (`room_id`, `quote_id`) REFERENCES `messages`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `command_receipts` ADD CONSTRAINT `command_receipts_room_id_actor_id_fkey` FOREIGN KEY (`room_id`, `actor_id`) REFERENCES `room_members`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `command_receipts` ADD CONSTRAINT `command_receipts_room_id_message_id_fkey` FOREIGN KEY (`room_id`, `message_id`) REFERENCES `messages`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `room_events` ADD CONSTRAINT `room_events_room_id_stream_id_message_id_fkey` FOREIGN KEY (`room_id`, `stream_id`, `message_id`) REFERENCES `messages`(`room_id`, `stream_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `deletion_requests` ADD CONSTRAINT `deletion_requests_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deletion_requests` ADD CONSTRAINT `deletion_requests_room_id_message_id_fkey` FOREIGN KEY (`room_id`, `message_id`) REFERENCES `messages`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
