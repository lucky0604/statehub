CREATE TABLE `cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`start_date` integer,
	`end_date` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cycles_project_name` ON `cycles` (`project_id`,`name`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_cycles_project` ON `cycles` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `views` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text,
	`name` text NOT NULL,
	`layout` text DEFAULT 'list' NOT NULL,
	`query_json` text NOT NULL,
	`display_json` text DEFAULT '{}' NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_views_project_name` ON `views` (`project_id`,`owner_id`,`name`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_views_project` ON `views` (`project_id`,`sort_order`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_work_item_labels` (
	`workspace_id` text NOT NULL,
	`work_item_id` text NOT NULL,
	`label_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`work_item_id`, `label_id`)
);
--> statement-breakpoint
INSERT INTO `__new_work_item_labels`("workspace_id", "work_item_id", "label_id", "created_at") SELECT "workspace_id", "work_item_id", "label_id", "created_at" FROM `work_item_labels`;--> statement-breakpoint
DROP TABLE `work_item_labels`;--> statement-breakpoint
ALTER TABLE `__new_work_item_labels` RENAME TO `work_item_labels`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_wil_work_item` ON `work_item_labels` (`work_item_id`);--> statement-breakpoint
CREATE INDEX `idx_wil_label` ON `work_item_labels` (`label_id`);