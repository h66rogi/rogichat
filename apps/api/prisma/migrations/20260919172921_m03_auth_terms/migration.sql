-- AlterTable
ALTER TABLE `login_transactions` ADD COLUMN `terms_version` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `terms_version` VARCHAR(32) NULL;
