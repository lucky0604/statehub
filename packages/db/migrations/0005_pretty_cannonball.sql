CREATE TABLE `review_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`review_id` text NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text,
	`work_item_id` text,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`file_path` text,
	`line_start` integer,
	`line_end` integer,
	`suggestion` text,
	`status` text DEFAULT 'open' NOT NULL,
	`linked_work_item_id` text,
	`linked_todo_id` text,
	`dismissed_reason` text,
	`dismissed_by` text,
	`dismissed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_findings_workspace_project` ON `review_findings` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_findings_review` ON `review_findings` (`workspace_id`,`review_id`);--> statement-breakpoint
CREATE INDEX `idx_findings_feature` ON `review_findings` (`workspace_id`,`feature_id`);--> statement-breakpoint
CREATE INDEX `idx_findings_work_item` ON `review_findings` (`workspace_id`,`work_item_id`);--> statement-breakpoint
CREATE INDEX `idx_findings_linked_work_item` ON `review_findings` (`workspace_id`,`linked_work_item_id`);--> statement-breakpoint
CREATE INDEX `idx_findings_linked_todo` ON `review_findings` (`workspace_id`,`linked_todo_id`);--> statement-breakpoint
CREATE INDEX `idx_findings_workspace_severity_status` ON `review_findings` (`workspace_id`,`severity`,`status`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text,
	`work_item_id` text,
	`agent_run_id` text,
	`reviewer` text NOT NULL,
	`model` text,
	`verdict` text NOT NULL,
	`summary` text,
	`confidence` text DEFAULT 'none' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_reviews_workspace_project` ON `reviews` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_reviews_feature` ON `reviews` (`workspace_id`,`feature_id`);--> statement-breakpoint
CREATE INDEX `idx_reviews_work_item` ON `reviews` (`workspace_id`,`work_item_id`);--> statement-breakpoint
CREATE INDEX `idx_reviews_agent_run` ON `reviews` (`workspace_id`,`agent_run_id`);--> statement-breakpoint
CREATE INDEX `idx_reviews_workspace_verdict_created` ON `reviews` (`workspace_id`,`verdict`,`created_at`);