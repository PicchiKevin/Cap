import { db } from "@cap/database";
import { slackCommentNotificationOutbox } from "@cap/database/schema";
import type { Comment } from "@cap/web-domain";
import { eq, sql } from "drizzle-orm";
import { start } from "workflow/api";
import { slackCommentNotificationWorkflow } from "@/workflows/slack-comment-notification";

export const admitSlackCommentNotification = async (
	commentId: Comment.CommentId,
) => {
	const database = db();
	const [outbox] = await database
		.select()
		.from(slackCommentNotificationOutbox)
		.where(eq(slackCommentNotificationOutbox.commentId, commentId))
		.limit(1);
	if (!outbox || outbox.state === "queued") return false;

	try {
		await start(slackCommentNotificationWorkflow, [outbox.payload]);
		await database
			.update(slackCommentNotificationOutbox)
			.set({
				state: "queued",
				attempts: sql`${slackCommentNotificationOutbox.attempts} + 1`,
				lastError: null,
				updatedAt: new Date(),
			})
			.where(eq(slackCommentNotificationOutbox.commentId, commentId));
		return true;
	} catch (error) {
		await database
			.update(slackCommentNotificationOutbox)
			.set({
				state: "pending",
				attempts: sql`${slackCommentNotificationOutbox.attempts} + 1`,
				lastError: error instanceof Error ? error.message : "Unknown error",
				updatedAt: new Date(),
			})
			.where(eq(slackCommentNotificationOutbox.commentId, commentId));
		throw error;
	}
};

export const reconcileSlackCommentNotificationAdmissions = async ({
	commentIds,
	admit = admitSlackCommentNotification,
}: {
	commentIds: Comment.CommentId[];
	admit?: (commentId: Comment.CommentId) => Promise<boolean>;
}) => {
	const results = await Promise.allSettled(
		commentIds.map((commentId) => admit(commentId)),
	);
	return results.filter(
		(result): result is PromiseFulfilledResult<boolean> =>
			result.status === "fulfilled" && result.value,
	).length;
};

export const reconcilePendingSlackCommentNotificationAdmissions = async (
	limit = 100,
) => {
	const pending = await db()
		.select({ commentId: slackCommentNotificationOutbox.commentId })
		.from(slackCommentNotificationOutbox)
		.where(eq(slackCommentNotificationOutbox.state, "pending"))
		.orderBy(slackCommentNotificationOutbox.createdAt)
		.limit(limit);
	return reconcileSlackCommentNotificationAdmissions({
		commentIds: pending.map((entry) => entry.commentId),
	});
};

export const enqueueSlackCommentNotification = async () => {
	try {
		await reconcilePendingSlackCommentNotificationAdmissions();
	} catch (error) {
		console.error(
			"[slack-notifications] Failed to admit comment notification:",
			error,
		);
	}
};
