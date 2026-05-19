CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`query` text,
	`states` text,
	`issuer_type` text,
	`deadline_preset` text,
	`published_preset` text,
	`frequency` text DEFAULT 'daily' NOT NULL,
	`notification_channel` text DEFAULT 'email' NOT NULL,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`last_matched_at` text,
	`last_notified_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_alerts_user_id` ON `alerts` (`user_id`);--> statement-breakpoint
CREATE TABLE `bid_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`bid_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`size_label` text,
	`mime_type` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`bid_id`) REFERENCES `bids`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_bid_attachments_bid_id` ON `bid_attachments` (`bid_id`);--> statement-breakpoint
CREATE TABLE `bids` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_bid_id` text,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`full_description` text,
	`original_category` text,
	`amount` text,
	`amount_min` integer,
	`amount_max` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`published_date` text,
	`deadline_date` text,
	`issuer_name` text NOT NULL,
	`issuer_type` text NOT NULL,
	`state_code` text NOT NULL,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
	`source_url` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`raw_payload` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bids_dedupe_key` ON `bids` (`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bids_source_source_bid_id` ON `bids` (`source`,`source_bid_id`);--> statement-breakpoint
CREATE INDEX `idx_bids_active_deadline` ON `bids` (`is_active`,`deadline_date`);--> statement-breakpoint
CREATE INDEX `idx_bids_published_date` ON `bids` (`published_date`);--> statement-breakpoint
CREATE INDEX `idx_bids_state_code` ON `bids` (`state_code`);--> statement-breakpoint
CREATE INDEX `idx_bids_issuer_type` ON `bids` (`issuer_type`);--> statement-breakpoint
CREATE INDEX `idx_bids_source` ON `bids` (`source`);--> statement-breakpoint
CREATE TABLE `crawler_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`run_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`duration_ms` integer,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`error_stack` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `idx_crawler_logs_source_started` ON `crawler_logs` (`source`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_crawler_logs_run_id` ON `crawler_logs` (`run_id`);--> statement-breakpoint
CREATE TABLE `data_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`issuer_type` text NOT NULL,
	`state_code` text NOT NULL,
	`base_url` text,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`cadence` text DEFAULT 'daily' NOT NULL,
	`last_success_at` text,
	`last_failure_at` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved_bids` (
	`user_id` text NOT NULL,
	`bid_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `bid_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bid_id`) REFERENCES `bids`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_saved_bids_bid_id` ON `saved_bids` (`bid_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sessions_token_hash` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`password_hash` text,
	`display_name` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);