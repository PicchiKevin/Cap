CREATE TABLE `slack_comment_notification_outbox` (
	`comment_id` varchar(15) NOT NULL,
	`payload` json NOT NULL,
	`state` varchar(16) NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `slack_comment_notification_outbox_comment_id` PRIMARY KEY(`comment_id`)
);
--> statement-breakpoint
CREATE INDEX `slack_notification_outbox_state_idx` ON `slack_comment_notification_outbox` (`state`,`created_at`);