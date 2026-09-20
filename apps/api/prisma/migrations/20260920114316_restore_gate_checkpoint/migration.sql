-- CreateTable
CREATE TABLE `restore_gate_checkpoints` (
    `run_id` VARCHAR(256) NOT NULL,
    `target_id` VARCHAR(256) NOT NULL,
    `context_sha256` CHAR(64) NOT NULL,
    `boundary_sha256` CHAR(64) NOT NULL,
    `boundary_issuer` CHAR(64) NOT NULL,
    `epoch` CHAR(36) NOT NULL,
    `phase` VARCHAR(32) NOT NULL DEFAULT 'NEW',
    `provider_phase` VARCHAR(16) NOT NULL DEFAULT 'identities',
    `provider_after_id` CHAR(36) NULL,
    `observation_sha256` CHAR(64) NULL,
    `release_nonce` CHAR(32) NULL,
    `release_sha256` CHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `quarantined_at` DATETIME(3) NULL,
    `consumed_at` DATETIME(3) NULL,

    UNIQUE INDEX `restore_gate_checkpoints_target_id_key`(`target_id`),
    UNIQUE INDEX `restore_gate_checkpoints_release_nonce_key`(`release_nonce`),
    PRIMARY KEY (`run_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
