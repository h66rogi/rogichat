-- AlterTable
ALTER TABLE `auth_sessions` ADD COLUMN `client_id` VARCHAR(32) NULL,
    ADD COLUMN `transport` ENUM('WEB', 'NATIVE') NOT NULL DEFAULT 'WEB';
