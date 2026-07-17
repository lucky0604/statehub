CREATE TABLE `external_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`external_source` text NOT NULL,
	`external_id` text NOT NULL,
	`external_url` text NOT NULL,
	`sync_status` text DEFAULT 'linked' NOT NULL,
	`last_synced_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_links_unique` ON `external_links` (`workspace_id`,`entity_type`,`entity_id`,`external_source`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_external_links_workspace` ON `external_links` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_external_links_entity` ON `external_links` (`workspace_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_external_links_project` ON `external_links` (`workspace_id`,`project_id`);