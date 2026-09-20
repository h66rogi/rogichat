/*
  Warnings:

  - A unique constraint covering the columns `[launch_digest]` on the table `login_transactions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[completion_digest]` on the table `login_transactions` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `login_transactions` ADD COLUMN `app_challenge` VARCHAR(43) NULL,
    ADD COLUMN `bound_generation` BIGINT UNSIGNED NULL,
    ADD COLUMN `channel` ENUM('WEB', 'NATIVE') NOT NULL DEFAULT 'WEB',
    ADD COLUMN `client_id` VARCHAR(32) NULL,
    ADD COLUMN `completion_digest` BINARY(32) NULL,
    ADD COLUMN `completion_expires` DATETIME(3) NULL,
    ADD COLUMN `identity_payload` BLOB NULL,
    ADD COLUMN `launch_digest` BINARY(32) NULL,
    ADD COLUMN `launch_expires` DATETIME(3) NULL,
    ADD COLUMN `launch_payload` BLOB NULL,
    ADD COLUMN `launched_at` DATETIME(3) NULL,
    ADD COLUMN `return_state` VARCHAR(43) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `login_transactions_launch_digest_key` ON `login_transactions`(`launch_digest`);

-- CreateIndex
CREATE UNIQUE INDEX `login_transactions_completion_digest_key` ON `login_transactions`(`completion_digest`);
