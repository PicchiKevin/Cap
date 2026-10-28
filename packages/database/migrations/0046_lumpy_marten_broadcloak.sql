CREATE TABLE `loom_migration_imports` (
	`videoId` varchar(15) NOT NULL,
	`requestId` varchar(15) NOT NULL,
	`createdAt` datetime NOT NULL,
	CONSTRAINT `loom_migration_imports_videoId` PRIMARY KEY(`videoId`)
);
--> statement-breakpoint
CREATE TABLE `loom_migration_requests` (
	`id` varchar(15) NOT NULL,
	`organizationId` varchar(15) NOT NULL,
	`activeOrganizationId` varchar(15),
	`requestedByUserId` varchar(15) NOT NULL,
	`workspaceName` varchar(255),
	`customerNote` text,
	`customerReply` text,
	`invitedAt` datetime,
	`status` varchar(32) NOT NULL DEFAULT 'pending',
	`capMessage` text,
	`expectedVideoCount` int,
	`importedVideoCount` int NOT NULL DEFAULT 0,
	`queuedVideoCount` int NOT NULL DEFAULT 0,
	`activeImportCount` int NOT NULL DEFAULT 0,
	`activeImportLeaseToken` varchar(36),
	`activeImportLeaseUntil` datetime,
	`lastOperatorUserId` varchar(15),
	`lastOperatorAt` datetime,
	`completedAt` datetime,
	`createdAt` datetime NOT NULL,
	`updatedAt` datetime NOT NULL,
	CONSTRAINT `loom_migration_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `loom_migration_active_org_idx` UNIQUE(`activeOrganizationId`)
);
--> statement-breakpoint
CREATE TABLE `loops_sync_jobs` (
	`userId` varchar(15) NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	`nextAttemptAt` datetime NOT NULL,
	`leaseToken` varchar(36),
	`leaseUntil` datetime,
	`failures` int NOT NULL DEFAULT 0,
	`lastError` varchar(64),
	`profileHash` varchar(64),
	`teammateJoinedAt` datetime,
	`syncedEmail` varchar(255),
	`lastSyncedAt` datetime,
	CONSTRAINT `loops_sync_jobs_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `mcp_oauth_clients` (
	`id` varchar(15) NOT NULL,
	`clientId` varchar(128) NOT NULL,
	`clientName` varchar(100) NOT NULL,
	`redirectUris` json NOT NULL,
	`activatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mcp_oauth_clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `client_id_idx` UNIQUE(`clientId`)
);
--> statement-breakpoint
CREATE TABLE `mcp_oauth_codes` (
	`id` varchar(15) NOT NULL,
	`userId` varchar(15) NOT NULL,
	`clientId` varchar(128) NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`codeChallenge` varchar(64) NOT NULL,
	`redirectUri` varchar(512) NOT NULL,
	`resource` varchar(512) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mcp_oauth_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `code_hash_idx` UNIQUE(`codeHash`)
);
--> statement-breakpoint
CREATE TABLE `mcp_oauth_registration_quotas` (
	`windowId` varchar(10) NOT NULL,
	`registrations` int NOT NULL DEFAULT 0,
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `mcp_oauth_registration_quotas_windowId` PRIMARY KEY(`windowId`)
);
--> statement-breakpoint
CREATE TABLE `mcp_oauth_tokens` (
	`id` varchar(15) NOT NULL,
	`userId` varchar(15) NOT NULL,
	`clientId` varchar(128) NOT NULL,
	`familyId` varchar(15) NOT NULL,
	`resource` varchar(512) NOT NULL,
	`accessHash` varchar(64) NOT NULL,
	`refreshHash` varchar(64) NOT NULL,
	`accessExpiresAt` timestamp NOT NULL,
	`refreshExpiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mcp_oauth_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `access_hash_idx` UNIQUE(`accessHash`),
	CONSTRAINT `refresh_hash_idx` UNIQUE(`refreshHash`)
);
--> statement-breakpoint
CREATE TABLE `video_viewer_grants` (
	`id` varchar(15) NOT NULL,
	`videoId` varchar(15) NOT NULL,
	`email` varchar(255) NOT NULL,
	`invitedByUserId` varchar(15) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`revokedAt` timestamp,
	CONSTRAINT `video_viewer_grants_id` PRIMARY KEY(`id`),
	CONSTRAINT `video_email_idx` UNIQUE(`videoId`,`email`)
);
--> statement-breakpoint
ALTER TABLE `organizations` ADD `defaultVideoVisibility` varchar(7);--> statement-breakpoint
ALTER TABLE `users` ADD `marketingOrigin` varchar(20) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `video_viewer_grants` ADD CONSTRAINT `video_viewer_grants_videoId_videos_id_fk` FOREIGN KEY (`videoId`) REFERENCES `videos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `loom_migration_imports_request_idx` ON `loom_migration_imports` (`requestId`);--> statement-breakpoint
CREATE INDEX `loom_migration_org_created_idx` ON `loom_migration_requests` (`organizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `loom_migration_status_created_idx` ON `loom_migration_requests` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `loops_sync_due_idx` ON `loops_sync_jobs` (`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `inactive_created_at_idx` ON `mcp_oauth_clients` (`activatedAt`,`createdAt`);--> statement-breakpoint
CREATE INDEX `expires_at_idx` ON `mcp_oauth_codes` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `expires_at_idx` ON `mcp_oauth_registration_quotas` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `family_id_idx` ON `mcp_oauth_tokens` (`familyId`);--> statement-breakpoint
CREATE INDEX `client_active_idx` ON `mcp_oauth_tokens` (`clientId`,`revokedAt`,`refreshExpiresAt`);--> statement-breakpoint
CREATE INDEX `refresh_expires_at_idx` ON `mcp_oauth_tokens` (`refreshExpiresAt`);--> statement-breakpoint
CREATE INDEX `video_id_idx` ON `notifications` (`videoId`);--> statement-breakpoint
CREATE INDEX `started_at_idx` ON `video_uploads` (`started_at`);--> statement-breakpoint
CREATE INDEX `owner_updated_id_idx` ON `videos` (`ownerId`,`updatedAt`,`id`);--> statement-breakpoint
CREATE INDEX `org_owner_folder_effective_idx` ON `videos` (`orgId`,`ownerId`,`folderId`,`effectiveCreatedAt`);