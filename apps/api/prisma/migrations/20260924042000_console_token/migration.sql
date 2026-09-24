/*
  Warnings:

  - A unique constraint covering the columns `[console_token]` on the table `rooms` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `rooms` ADD COLUMN `console_token` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `rooms_console_token_key` ON `rooms`(`console_token`);
