CREATE TABLE `cyber_agent_presence` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`state` text NOT NULL,
	`seen_at` text NOT NULL
);
