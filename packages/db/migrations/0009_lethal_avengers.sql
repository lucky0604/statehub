CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`integration_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`summary_json` text,
	`input_json` text,
	`result_json` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_import_jobs_workspace` ON `import_jobs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_import_jobs_integration` ON `import_jobs` (`workspace_id`,`integration_id`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`config_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_used_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_integrations_workspace` ON `integrations` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_integrations_provider` ON `integrations` (`workspace_id`,`provider`);