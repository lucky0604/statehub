CREATE TABLE `features` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_features_project_name` ON `features` (`project_id`,`name`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_features_project_sort` ON `features` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_features_workspace_project` ON `features` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_labels_project_name` ON `labels` (`project_id`,`name`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_labels_project_sort` ON `labels` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `project_counters` (
	`project_id` text PRIMARY KEY NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`identifier` text NOT NULL,
	`default_state_id` text,
	`default_assignee_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_ws_slug` ON `projects` (`workspace_id`,`slug`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_ws_identifier` ON `projects` (`workspace_id`,`identifier`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `states` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status_group` text NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_states_project_name` ON `states` (`project_id`,`name`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_states_project_sort` ON `states` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`avatar_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `work_item_labels` (
	`workspace_id` text NOT NULL,
	`work_item_id` text NOT NULL,
	`label_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_wil_work_item` ON `work_item_labels` (`work_item_id`);--> statement-breakpoint
CREATE INDEX `idx_wil_label` ON `work_item_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text,
	`parent_work_item_id` text,
	`sequence_id` integer NOT NULL,
	`project_identifier` text NOT NULL,
	`title` text NOT NULL,
	`description_markdown` text,
	`state_id` text,
	`status_group` text DEFAULT 'backlog' NOT NULL,
	`type` text DEFAULT 'task' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`confidence` text DEFAULT 'none' NOT NULL,
	`start_date` integer,
	`target_date` integer,
	`completed_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_items_project_sequence` ON `work_items` (`project_id`,`sequence_id`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_work_items_ws_project_state` ON `work_items` (`workspace_id`,`project_id`,`state_id`);--> statement-breakpoint
CREATE INDEX `idx_work_items_ws_project_feature` ON `work_items` (`workspace_id`,`project_id`,`feature_id`);--> statement-breakpoint
CREATE INDEX `idx_work_items_ws_project_priority` ON `work_items` (`workspace_id`,`project_id`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_work_items_ws_project_updated` ON `work_items` (`workspace_id`,`project_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspace_members_ws_user` ON `workspace_members` (`workspace_id`,`user_id`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspaces_slug` ON `workspaces` (`slug`) WHERE deleted_at IS NULL;