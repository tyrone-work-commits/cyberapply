CREATE TABLE `cyber_ai_usage` (
	`owner_id` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `day`)
);
