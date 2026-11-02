CREATE TABLE `service_settings` (
  `user_id` text PRIMARY KEY NOT NULL CHECK (`user_id` = 'owner'),
  `encrypted_payload` text NOT NULL,
  `updated_at` text NOT NULL
);
