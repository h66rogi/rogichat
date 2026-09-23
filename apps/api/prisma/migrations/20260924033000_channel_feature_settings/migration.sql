CREATE TABLE `channel_feature_settings` (
  `channel_id` CHAR(36) NOT NULL,
  `items` JSON NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`channel_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `channel_feature_settings`
  ADD CONSTRAINT `channel_feature_settings_channel_id_fkey`
  FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
