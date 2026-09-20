-- CreateTable
CREATE TABLE `deletion_replay_sources` (
    `source_id` CHAR(64) NOT NULL,
    `environment` VARCHAR(10) NOT NULL,
    `cursor` VARCHAR(2048) NULL,
    `generation` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `discovery_token` CHAR(36) NULL,
    `discovery_epoch` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `discovery_until` DATETIME(3) NULL,
    `next_lane` VARCHAR(5) NOT NULL DEFAULT 'NEW',
    `current_failure_code` VARCHAR(32) NULL,
    `last_failure_code` VARCHAR(32) NULL,
    `first_failure_at` DATETIME(3) NULL,
    `last_failure_at` DATETIME(3) NULL,

    PRIMARY KEY (`source_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deletion_replay_entries` (
    `source_id` CHAR(64) NOT NULL,
    `key_sha256` CHAR(64) NOT NULL,
    `object_key` VARCHAR(1024) NULL,
    `classification` VARCHAR(16) NOT NULL,
    `phase` VARCHAR(5) NOT NULL DEFAULT 'APPLY',
    `state` VARCHAR(8) NOT NULL DEFAULT 'READY',
    `evidence_conflict` BOOLEAN NOT NULL DEFAULT false,
    `receipt_sha256` CHAR(64) NULL,
    `discovered_generation` BIGINT UNSIGNED NOT NULL,
    `processed_generation` BIGINT UNSIGNED NULL,
    `next_attempt_at` DATETIME(3) NOT NULL,
    `first_failure_at` DATETIME(3) NULL,
    `last_failure_at` DATETIME(3) NULL,
    `last_failure_code` VARCHAR(32) NULL,
    `attempt_count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `claim_token` CHAR(36) NULL,
    `claim_epoch` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `claim_until` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `deletion_replay_due`(`source_id`, `state`, `next_attempt_at`, `key_sha256`),
    PRIMARY KEY (`source_id`, `key_sha256`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `deletion_replay_entries` ADD CONSTRAINT `deletion_replay_entries_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `deletion_replay_sources`(`source_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
