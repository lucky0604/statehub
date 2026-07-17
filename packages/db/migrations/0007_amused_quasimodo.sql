CREATE TABLE `ai_pm_action_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`feature_id` text,
	`ai_pm_query_id` text NOT NULL,
	`action_type` text NOT NULL,
	`title` text NOT NULL,
	`reason` text,
	`risk` text,
	`requires_confirmation` integer DEFAULT 0 NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`edit_count` integer DEFAULT 0 NOT NULL,
	`applied_at` integer,
	`applied_by` text,
	`dismissed_at` integer,
	`dismissed_by` text,
	`dismiss_reason` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_pm_cards_workspace_status` ON `ai_pm_action_cards` (`workspace_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_pm_cards_query` ON `ai_pm_action_cards` (`workspace_id`,`ai_pm_query_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_pm_cards_feature` ON `ai_pm_action_cards` (`workspace_id`,`feature_id`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`feature_id` text,
	`decision_text` text NOT NULL,
	`rationale` text,
	`source` text NOT NULL,
	`linked_action_id` text,
	`linked_weekly_review_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_decisions_workspace_project` ON `decisions` (`workspace_id`,`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_decisions_workspace_feature` ON `decisions` (`workspace_id`,`feature_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_decisions_action` ON `decisions` (`workspace_id`,`linked_action_id`);--> statement-breakpoint
CREATE TABLE `weekly_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`week_start` integer NOT NULL,
	`week_end` integer NOT NULL,
	`summary_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_weekly_reviews_workspace_week` ON `weekly_reviews` (`workspace_id`,`week_start`);--> statement-breakpoint
CREATE INDEX `idx_weekly_reviews_workspace_project` ON `weekly_reviews` (`workspace_id`,`project_id`,`created_at`);