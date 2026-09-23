CREATE TABLE `channel_omakase_settings` (
  `id` INTEGER NOT NULL,
  `channel_id` CHAR(36) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `display_name` VARCHAR(50) NULL,
  `price` INTEGER NOT NULL DEFAULT 0,
  `currency_prices` JSON NULL,
  `count` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL,

  UNIQUE INDEX `channel_omakase_settings_channel_id_key`(`channel_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `omakase_ledger_entries` (
  `id` INTEGER NOT NULL,
  `channel_id` CHAR(36) NOT NULL,
  `live_session_id` INTEGER NULL,
  `song_request_id` INTEGER NULL,
  `type` ENUM('chat_paid','manual_increment','manual_decrement','manual_set','consume_queue','consume_play_now') NOT NULL,
  `delta` INTEGER NOT NULL,
  `balance_after` INTEGER NOT NULL,
  `requester_platform_id` VARCHAR(64) NULL,
  `requester_nickname` VARCHAR(255) NULL,
  `request_user_id` CHAR(36) NULL,
  `stream_message_id` VARCHAR(128) NULL,
  `raw_message` TEXT NULL,
  `donation_amount` INTEGER NULL,
  `donation_native_amount` INTEGER NULL,
  `donation_currency` VARCHAR(32) NULL,
  `actor_user_id` CHAR(36) NULL,
  `reason` VARCHAR(255) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

  UNIQUE INDEX `omakase_ledger_entries_stream_message_id_key`(`stream_message_id`),
  INDEX `idx_omakase_ledger_channel_created`(`channel_id`, `created_at`),
  INDEX `idx_omakase_ledger_session_created`(`live_session_id`, `created_at`),
  INDEX `idx_omakase_ledger_song_request`(`song_request_id`),
  INDEX `idx_omakase_ledger_request_user`(`request_user_id`),
  INDEX `idx_omakase_ledger_actor_user`(`actor_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `channel_omakase_settings`
  ADD CONSTRAINT `channel_omakase_settings_channel_id_fkey`
  FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `omakase_ledger_entries`
  ADD CONSTRAINT `omakase_ledger_entries_channel_id_fkey`
  FOREIGN KEY (`channel_id`) REFERENCES `rooms`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `omakase_ledger_entries`
  ADD CONSTRAINT `omakase_ledger_entries_live_session_id_fkey`
  FOREIGN KEY (`live_session_id`) REFERENCES `live_sessions`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `omakase_ledger_entries`
  ADD CONSTRAINT `omakase_ledger_entries_song_request_id_fkey`
  FOREIGN KEY (`song_request_id`) REFERENCES `song_requests`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `omakase_ledger_entries`
  ADD CONSTRAINT `omakase_ledger_entries_request_user_id_fkey`
  FOREIGN KEY (`request_user_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `omakase_ledger_entries`
  ADD CONSTRAINT `omakase_ledger_entries_actor_user_id_fkey`
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
