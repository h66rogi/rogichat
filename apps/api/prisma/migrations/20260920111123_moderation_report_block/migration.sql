-- CreateTable
CREATE TABLE `actor_blocks` (
    `room_id` CHAR(36) NOT NULL,
    `blocker_actor_id` CHAR(36) NOT NULL,
    `target_actor_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `actor_blocks_room_id_target_actor_id_blocker_actor_id_idx`(`room_id`, `target_actor_id`, `blocker_actor_id`),
    PRIMARY KEY (`room_id`, `blocker_actor_id`, `target_actor_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `moderation_reports` (
    `id` CHAR(36) NOT NULL,
    `reporter_user_id` CHAR(36) NOT NULL,
    `idempotency_key` CHAR(36) NOT NULL,
    `payload_digest` BINARY(32) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `message_id` CHAR(36) NOT NULL,
    `root_message_id` CHAR(36) NOT NULL,
    `content_owner_user_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(16) NOT NULL,
    `detail` VARCHAR(1000) NULL,
    `detail_expires_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'received',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved_at` DATETIME(3) NULL,

    INDEX `moderation_reports_status_id_idx`(`status`, `id`),
    INDEX `moderation_reports_detail_expires_at_id_idx`(`detail_expires_at`, `id`),
    INDEX `moderation_reports_room_id_root_message_id_idx`(`room_id`, `root_message_id`),
    INDEX `moderation_reports_content_owner_user_id_idx`(`content_owner_user_id`),
    UNIQUE INDEX `moderation_reports_reporter_user_id_idempotency_key_key`(`reporter_user_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `moderation_audit` (
    `id` CHAR(36) NOT NULL,
    `operator_user_id` CHAR(36) NOT NULL,
    `report_id` CHAR(36) NULL,
    `room_id` CHAR(36) NULL,
    `target_actor_id` CHAR(36) NULL,
    `action` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `moderation_audit_report_id_created_at_idx`(`report_id`, `created_at`),
    INDEX `moderation_audit_room_id_created_at_idx`(`room_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
