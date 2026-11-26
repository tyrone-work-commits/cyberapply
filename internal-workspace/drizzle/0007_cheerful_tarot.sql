CREATE TABLE `cyber_private_videos` (
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`last_claim` text,
	`claim_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`application_deleted` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'saved' NOT NULL,
	PRIMARY KEY(`owner_id`, `request_id`)
);
