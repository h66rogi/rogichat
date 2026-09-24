/*
  Warnings:

  - A unique constraint covering the columns `[overlay_token]` on the table `rooms` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `rooms` ADD COLUMN `overlay_token` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `rooms_overlay_token_key` ON `rooms`(`overlay_token`);
