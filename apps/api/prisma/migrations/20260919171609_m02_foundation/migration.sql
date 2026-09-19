-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'DELETING', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
    `membership_generation` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_profiles` (
    `user_id` CHAR(36) NOT NULL,
    `nickname` VARCHAR(40) NOT NULL,
    `birthday_month` TINYINT UNSIGNED NULL,
    `birthday_day` TINYINT UNSIGNED NULL,
    `birthday_visible_to_streamers` BOOLEAN NOT NULL DEFAULT false,
    `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_soop` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `provider_subject` VARBINARY(191) NOT NULL,
    `status` ENUM('VERIFIED', 'REVOKED') NOT NULL DEFAULT 'VERIFIED',
    `verified_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `platform_soop_user_id_key`(`user_id`),
    UNIQUE INDEX `platform_soop_provider_subject_key`(`provider_subject`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_identities` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `issuer` VARBINARY(191) NOT NULL,
    `subject` VARBINARY(191) NOT NULL,
    `status` ENUM('VERIFIED', 'REVOKED') NOT NULL DEFAULT 'VERIFIED',

    UNIQUE INDEX `auth_identities_provider_issuer_subject_key`(`provider`, `issuer`, `subject`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_digest` BINARY(32) NOT NULL,
    `csrf_digest` BINARY(32) NOT NULL,
    `audience` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `auth_sessions_token_digest_key`(`token_digest`),
    INDEX `auth_sessions_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    INDEX `auth_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `login_transactions` (
    `id` CHAR(36) NOT NULL,
    `state_digest` BINARY(32) NOT NULL,
    `browser_digest` BINARY(32) NOT NULL,
    `verifier` VARBINARY(128) NOT NULL,
    `intent` VARCHAR(16) NOT NULL,
    `audience` VARCHAR(32) NOT NULL,
    `user_id` CHAR(36) NULL,
    `session_id` CHAR(36) NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `expires_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `login_transactions_state_digest_key`(`state_digest`),
    INDEX `login_transactions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `creator_accounts` (
    `user_id` CHAR(36) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_capabilities` (
    `user_id` CHAR(36) NOT NULL,
    `manage_rooms` BOOLEAN NOT NULL DEFAULT false,
    `manage_users` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rooms` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `mode` ENUM('FAN', 'GROUP') NOT NULL,
    `status` ENUM('ACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `policy_version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `history_policy` ENUM('ALL_AVAILABLE', 'SINCE_JOIN') NOT NULL DEFAULT 'SINCE_JOIN',
    `join_policy` ENUM('OPEN_AUTHENTICATED', 'INVITE_ONLY', 'APPROVAL', 'PASSWORD') NOT NULL DEFAULT 'OPEN_AUTHENTICATED',
    `owner_member_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `room_counters` (
    `room_id` CHAR(36) NOT NULL,
    `last_order` BIGINT UNSIGNED NOT NULL DEFAULT 0,

    PRIMARY KEY (`room_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `room_members` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role` ENUM('FAN', 'STREAMER', 'MEMBER') NOT NULL,
    `status` ENUM('ACTIVE', 'LEFT', 'BANNED') NOT NULL DEFAULT 'ACTIVE',
    `active_period_id` CHAR(36) NULL,

    UNIQUE INDEX `room_members_active_period_id_key`(`active_period_id`),
    UNIQUE INDEX `room_members_room_id_id_active_period_id_key`(`room_id`, `id`, `active_period_id`),
    UNIQUE INDEX `room_members_room_id_user_id_key`(`room_id`, `user_id`),
    UNIQUE INDEX `room_members_room_id_id_key`(`room_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `membership_periods` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `policy_version` INTEGER UNSIGNED NOT NULL,
    `history_policy` ENUM('ALL_AVAILABLE', 'SINCE_JOIN') NOT NULL,
    `visible_from_order` BIGINT UNSIGNED NOT NULL,
    `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `left_at` DATETIME(3) NULL,

    UNIQUE INDEX `membership_periods_room_id_member_id_id_key`(`room_id`, `member_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_streams` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `kind` ENUM('ROOM_SHARED', 'RESTRICTED') NOT NULL,

    UNIQUE INDEX `message_streams_room_id_id_key`(`room_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stream_grants` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `stream_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `can_read` BOOLEAN NOT NULL DEFAULT false,
    `can_send` BOOLEAN NOT NULL DEFAULT false,
    `valid_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `stream_grants_stream_id_member_id_key`(`stream_id`, `member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rate_buckets` (
    `key_digest` BINARY(32) NOT NULL,
    `used` INTEGER UNSIGNED NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `rate_buckets_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`key_digest`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_soop` ADD CONSTRAINT `platform_soop_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_identities` ADD CONSTRAINT `auth_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `creator_accounts` ADD CONSTRAINT `creator_accounts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_capabilities` ADD CONSTRAINT `admin_capabilities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rooms` ADD CONSTRAINT `rooms_id_owner_member_id_fkey` FOREIGN KEY (`id`, `owner_member_id`) REFERENCES `room_members`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `room_counters` ADD CONSTRAINT `room_counters_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_members` ADD CONSTRAINT `room_members_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_members` ADD CONSTRAINT `room_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_members` ADD CONSTRAINT `room_members_room_id_id_active_period_id_fkey` FOREIGN KEY (`room_id`, `id`, `active_period_id`) REFERENCES `membership_periods`(`room_id`, `member_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `membership_periods` ADD CONSTRAINT `membership_periods_room_id_member_id_fkey` FOREIGN KEY (`room_id`, `member_id`) REFERENCES `room_members`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_streams` ADD CONSTRAINT `message_streams_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stream_grants` ADD CONSTRAINT `stream_grants_room_id_stream_id_fkey` FOREIGN KEY (`room_id`, `stream_id`) REFERENCES `message_streams`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stream_grants` ADD CONSTRAINT `stream_grants_room_id_member_id_fkey` FOREIGN KEY (`room_id`, `member_id`) REFERENCES `room_members`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
