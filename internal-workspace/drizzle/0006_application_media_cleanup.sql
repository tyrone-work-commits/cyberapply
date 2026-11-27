CREATE TABLE `cyber_application_media_cleanup` (
 `owner_id` text NOT NULL,
 `request_id` text NOT NULL,
 `cover_key` text,
 `created_at` text NOT NULL,
 PRIMARY KEY (`owner_id`, `request_id`)
);
