CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`feature_id` text,
	`work_item_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`actor_name` text NOT NULL,
	`source` text NOT NULL,
	`idempotency_key` text,
	`payload_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_workspace_entity` ON `events` (`workspace_id`,`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_workspace_type` ON `events` (`workspace_id`,`event_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_workspace_idem` ON `events` (`workspace_id`,`idempotency_key`);