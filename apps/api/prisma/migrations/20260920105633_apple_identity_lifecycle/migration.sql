/*
  Warnings:

  - A unique constraint covering the columns `[provider,issuer,scope,subject]` on the table `auth_identities` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `auth_identities_provider_issuer_subject_key` ON `auth_identities`;

-- AlterTable
ALTER TABLE `auth_identities` ADD COLUMN `revoked_at` DATETIME(3) NULL,
    ADD COLUMN `scope` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `verified_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `apple_auth_transactions` (
    `id` CHAR(36) NOT NULL,
    `audience` VARCHAR(32) NOT NULL,
    `client_id` VARCHAR(16) NOT NULL,
    `intent` VARCHAR(16) NOT NULL,
    `state_digest` BINARY(32) NOT NULL,
    `nonce` VARCHAR(43) NOT NULL,
    `code_challenge` VARCHAR(43) NOT NULL,
    `return_state` VARCHAR(43) NOT NULL,
    `user_id` CHAR(36) NULL,
    `session_id` CHAR(36) NULL,
    `bound_generation` BIGINT UNSIGNED NULL,
    `terms_version` VARCHAR(32) NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `code_digest` BINARY(32) NULL,
    `completion_digest` BINARY(32) NULL,
    `completion_expires` DATETIME(3) NULL,
    `proof` BLOB NULL,

    UNIQUE INDEX `apple_auth_transactions_state_digest_key`(`state_digest`),
    UNIQUE INDEX `apple_auth_transactions_code_digest_key`(`code_digest`),
    UNIQUE INDEX `apple_auth_transactions_completion_digest_key`(`completion_digest`),
    INDEX `apple_auth_transactions_expires_at_idx`(`expires_at`),
    INDEX `apple_auth_transactions_user_id_status_idx`(`user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `apple_provider_credentials` (
    `id` CHAR(36) NOT NULL,
    `transaction_id` CHAR(36) NOT NULL,
    `lease_token` CHAR(36) NULL,
    `identity_id` CHAR(36) NULL,
    `user_id` CHAR(36) NULL,
    `audience` VARCHAR(191) NOT NULL,
    `token` BLOB NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `expires_at` DATETIME(3) NOT NULL,
    `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attempts` INTEGER UNSIGNED NOT NULL DEFAULT 0,

    UNIQUE INDEX `apple_provider_credentials_transaction_id_key`(`transaction_id`),
    INDEX `apple_provider_credentials_status_available_at_idx`(`status`, `available_at`),
    INDEX `apple_provider_credentials_user_id_status_idx`(`user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `apple_notification_receipts` (
    `digest` BINARY(32) NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`digest`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `apple_identity_events` (
    `scope` VARCHAR(64) NOT NULL,
    `subject` VARBINARY(191) NOT NULL,
    `revoked_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`scope`, `subject`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `auth_identities_provider_issuer_scope_subject_key` ON `auth_identities`(`provider`, `issuer`, `scope`, `subject`);
