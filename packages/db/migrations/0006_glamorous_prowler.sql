CREATE TABLE `project_repo_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`alias_url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_repo_aliases_ws_url` ON `project_repo_aliases` (`workspace_id`,`alias_url`);--> statement-breakpoint
CREATE INDEX `idx_repo_aliases_ws_project` ON `project_repo_aliases` (`workspace_id`,`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `repo_url` text;