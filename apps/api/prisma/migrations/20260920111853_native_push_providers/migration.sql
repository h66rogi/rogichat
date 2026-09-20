/*
  Warnings:

  - A unique constraint covering the columns `[installation_id]` on the table `push_subscriptions` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `push_subscriptions` ADD COLUMN `binding_digest` BINARY(32) NULL,
    ADD COLUMN `installation_id` CHAR(36) NULL,
    ADD COLUMN `native_client_id` VARCHAR(16) NULL,
    ADD COLUMN `native_token` BLOB NULL,
    ADD COLUMN `provider` ENUM('WEB', 'APNS', 'FCM') NOT NULL DEFAULT 'WEB',
    MODIFY `endpoint` VARCHAR(2048) NULL,
    MODIFY `p256dh` VARCHAR(128) NULL,
    MODIFY `auth_secret` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `push_subscriptions_installation_id_key` ON `push_subscriptions`(`installation_id`);
