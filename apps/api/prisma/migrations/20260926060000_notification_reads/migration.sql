-- CreateTable
CREATE TABLE `notification_reads` (
    `user_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `message_id` CHAR(36) NOT NULL,
    `read_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notification_reads_room_id_message_id_idx`(`room_id`, `message_id`),
    PRIMARY KEY (`user_id`, `message_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `room_members_user_id_status_room_id_idx` ON `room_members`(`user_id`, `status`, `room_id`);

-- CreateIndex
CREATE INDEX `messages_created_at_id_idx` ON `messages`(`created_at`, `id`);

-- AddForeignKey
ALTER TABLE `notification_reads` ADD CONSTRAINT `notification_reads_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_reads` ADD CONSTRAINT `notification_reads_room_id_message_id_fkey` FOREIGN KEY (`room_id`, `message_id`) REFERENCES `messages`(`room_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
