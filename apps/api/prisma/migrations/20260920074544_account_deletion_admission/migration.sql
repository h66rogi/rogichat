-- CreateTable
CREATE TABLE `account_deletion_obligations` (
    `user_id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `requested_at` DATETIME(3) NOT NULL,
    `blocked_at` DATETIME(3) NULL,
    `auth_not_before` DATETIME(3) NOT NULL,
    `guard_coverage` BOOLEAN NOT NULL DEFAULT false,
    `state` ENUM('BLOCKED', 'PURGING', 'LIVE_PURGED', 'BACKUPS_EXPIRED') NOT NULL DEFAULT 'BLOCKED',
    `live_purged_at` DATETIME(3) NULL,

    UNIQUE INDEX `account_deletion_obligations_request_id_key`(`request_id`),
    INDEX `account_deletion_obligations_guard_coverage_user_id_idx`(`guard_coverage`, `user_id`),
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `identity_guard_keys` (
    `version` INTEGER UNSIGNED NOT NULL,
    `fingerprint` BINARY(32) NOT NULL,

    PRIMARY KEY (`version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `identity_subject_guards` (
    `subject_hmac` BINARY(32) NOT NULL,
    `key_version` INTEGER UNSIGNED NOT NULL,
    `key_fingerprint` BINARY(32) NOT NULL,
    `request_id` CHAR(36) NULL,
    `user_id` CHAR(36) NULL,
    `requested_at` DATETIME(3) NULL,
    `auth_not_before` DATETIME(3) NULL,
    `live_purged_at` DATETIME(3) NULL,

    INDEX `identity_subject_guards_request_id_idx`(`request_id`),
    PRIMARY KEY (`subject_hmac`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `deletion_intents_environment_scope_target_id_requested_at_re_idx` ON `deletion_intents`(`environment`, `scope`, `target_id`, `requested_at`, `request_id`);

-- CreateIndex
CREATE INDEX `login_transactions_user_id_status_id_idx` ON `login_transactions`(`user_id`, `status`, `id`);
