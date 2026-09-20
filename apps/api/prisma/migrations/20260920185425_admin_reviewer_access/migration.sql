-- AlterTable
ALTER TABLE `admin_capabilities` ADD COLUMN `manage_test_access` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `reviewer_expires_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `password_accounts` (
    `user_id` CHAR(36) NOT NULL,
    `login_id` VARCHAR(64) NOT NULL,
    `password_hash` VARCHAR(256) NOT NULL,
    `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `disabled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `password_accounts_login_id_key`(`login_id`),
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `room_test_grants` (
    `id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `period_id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `payload_digest` BINARY(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,

    INDEX `room_test_grants_room_id_member_id_expires_at_idx`(`room_id`, `member_id`, `expires_at`),
    UNIQUE INDEX `room_test_grants_member_id_request_id_key`(`member_id`, `request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `access_audit` (
    `id` CHAR(36) NOT NULL,
    `operator_user_id` CHAR(36) NOT NULL,
    `target_user_id` CHAR(36) NULL,
    `room_id` CHAR(36) NULL,
    `grant_id` CHAR(36) NULL,
    `action` VARCHAR(40) NOT NULL,
    `reason_digest` BINARY(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `access_audit_operator_user_id_created_at_idx`(`operator_user_id`, `created_at`),
    INDEX `access_audit_target_user_id_created_at_idx`(`target_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `password_accounts` ADD CONSTRAINT `password_accounts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_test_grants` ADD CONSTRAINT `room_test_grants_room_id_member_id_fkey` FOREIGN KEY (`room_id`, `member_id`) REFERENCES `room_members`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
