CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text,
	`work_item_id` text,
	`agent` text NOT NULL,
	`model` text,
	`run_type` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`summary` text,
	`files_changed_json` text DEFAULT '[]' NOT NULL,
	`commands_run_json` text DEFAULT '[]' NOT NULL,
	`test_result` text,
	`commit_sha` text,
	`base_sha` text,
	`head_sha` text,
	`git_branch` text,
	`dirty_state` text,
	`repo_remote_url` text,
	`risks_json` text DEFAULT '[]' NOT NULL,
	`next_steps_json` text DEFAULT '[]' NOT NULL,
	`raw_artifact_url` text,
	`evidence_trust_state` text DEFAULT 'unknown' NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runs_workspace_project` ON `agent_runs` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_runs_feature` ON `agent_runs` (`workspace_id`,`feature_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_runs_work_item` ON `agent_runs` (`workspace_id`,`work_item_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_runs_status` ON `agent_runs` (`workspace_id`,`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text,
	`work_item_id` text,
	`agent_run_id` text,
	`evidence_type` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`artifact_url` text,
	`trust_state` text DEFAULT 'unknown' NOT NULL,
	`staleness_state` text DEFAULT 'unknown' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_evidence_workspace_project` ON `evidence` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_evidence_agent_run` ON `evidence` (`workspace_id`,`agent_run_id`);--> statement-breakpoint
CREATE INDEX `idx_evidence_work_item` ON `evidence` (`workspace_id`,`work_item_id`);--> statement-breakpoint
CREATE INDEX `idx_evidence_feature` ON `evidence` (`workspace_id`,`feature_id`);--> statement-breakpoint
CREATE TABLE `idempotency_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`tool_name` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_idem_workspace_key` ON `idempotency_records` (`workspace_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_idem_workspace_created` ON `idempotency_records` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `personal_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tokens_hash` ON `personal_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_tokens_workspace` ON `personal_tokens` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `todos` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text,
	`work_item_id` text,
	`agent_run_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`type` text DEFAULT 'implementation' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`source` text DEFAULT 'remote_mcp' NOT NULL,
	`confidence` text DEFAULT 'none' NOT NULL,
	`evidence_required` integer DEFAULT 0 NOT NULL,
	`evidence_summary` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_todos_workspace_project` ON `todos` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_todos_work_item` ON `todos` (`workspace_id`,`work_item_id`);--> statement-breakpoint
CREATE INDEX `idx_todos_feature` ON `todos` (`workspace_id`,`feature_id`);--> statement-breakpoint
CREATE INDEX `idx_todos_agent_run` ON `todos` (`workspace_id`,`agent_run_id`);