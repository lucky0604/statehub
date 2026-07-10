ALTER TABLE `projects` ADD `type` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `portfolio_priority` text DEFAULT 'P1' NOT NULL;