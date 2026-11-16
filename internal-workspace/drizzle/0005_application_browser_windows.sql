CREATE TABLE `cyber_application_browser_windows` (
 `owner_id` text NOT NULL,
 `request_id` text NOT NULL,
 `claim_id` text NOT NULL,
 `session_id` text NOT NULL,
 `seen_at` integer NOT NULL,
 `closed` integer NOT NULL DEFAULT 0,
 `open_id` text,
 `opened_id` text,
 `error` text NOT NULL DEFAULT '',
 PRIMARY KEY (`owner_id`, `request_id`)
);
