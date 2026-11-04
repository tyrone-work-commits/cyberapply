CREATE TABLE `cyber_career_records` (
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	`write_token` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `kind`, `id`)
);
--> statement-breakpoint
CREATE TABLE `cyber_career_usage` (
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`period` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `kind`, `period`)
);
--> statement-breakpoint
CREATE TABLE `cyber_career_versions` (
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `kind`, `id`, `version`)
);
