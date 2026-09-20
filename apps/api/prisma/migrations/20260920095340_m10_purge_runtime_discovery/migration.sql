-- CreateTable
CREATE TABLE `deletion_purge_discovery` (
    `source_id` CHAR(64) NOT NULL,
    `environment` VARCHAR(10) NOT NULL,
    `cursor` CHAR(36) NULL,
    `next_scan_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`source_id`, `environment`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
