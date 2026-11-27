CREATE TABLE `cyber_revisions` (
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`payload` text NOT NULL,
	`action` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `cyber_workspaces` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`write_token` text NOT NULL,
	`updated_at` text NOT NULL
);
