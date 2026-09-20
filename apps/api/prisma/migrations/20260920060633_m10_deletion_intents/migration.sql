-- CreateTable
CREATE TABLE `deletion_intents` (
    `request_id` CHAR(36) NOT NULL,
    `environment` VARCHAR(10) NOT NULL,
    `actor_user_id` CHAR(36) NOT NULL,
    `scope` VARCHAR(7) NOT NULL,
    `target_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NULL,
    `requested_at` DATETIME(3) NOT NULL,
    `ledger_sha256` BINARY(32) NOT NULL,
    `blocked_at` DATETIME(3) NULL,

    PRIMARY KEY (`request_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
