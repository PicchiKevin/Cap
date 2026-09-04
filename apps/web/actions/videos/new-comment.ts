"use server";

import { db } from "@cap/database";
import { getCurrentUser } from "@cap/database/auth/session";
import { nanoId } from "@cap/database/helpers";
import {
	comments,
	slackCommentNotificationOutbox,
	videos,
} from "@cap/database/schema";
import { provideOptionalAuth, VideosPolicy } from "@cap/web-backend";
import type { ImageUpload } from "@cap/web-domain";
import { Comment, Policy, type Video } from "@cap/web-domain";
import { eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { revalidatePath } from "next/cache";
import { createNotification } from "@/lib/Notification";
import * as EffectRuntime from "@/lib/server";
import { enqueueSlackCommentNotification } from "@/lib/slack-notifications";

export async function newComment(data: {
	content: string;
	videoId: Video.VideoId;
	type: "text" | "emoji" | "event";
	event?: Comment.Event | null;
	authorImage: ImageUpload.ImageUrl | null;
	parentCommentId: Comment.CommentId;
	timestamp: number | null;
}) {
	const user = await getCurrentUser();

	if (!user) {
		throw new Error("User not authenticated");
	}

	const content = data.content;
	const videoId = data.videoId;
	const type = data.type;
	const parentCommentId = data.parentCommentId;
	const timestamp = data.timestamp;
	const event = data.event ?? null;
	const isResolutionEvent =
		type === "event" &&
		typeof parentCommentId === "string" &&
		parentCommentId.trim().length > 0 &&
		event?.type === "resolution" &&
		Object.keys(event).length === 1;
	if (type === "event" && !isResolutionEvent) {
		throw new Error("Resolution events require a parent comment");
	}
	if (type !== "event" && event) {
		throw new Error("Only event comments can include event metadata");
	}
	if (type !== "text" && type !== "emoji" && type !== "event") {
		throw new Error("Invalid comment type");
	}
	const conditionalType = event
		? null
		: parentCommentId
			? "reply"
			: type === "emoji"
				? "reaction"
				: "comment";

	if (!content || !videoId) {
		throw new Error("Content and videoId are required");
	}

	// Authentication alone isn't authorization: without this, any logged-in user could
	// comment on someone else's private video by guessing its id.
	//
	// This also fetches the video row (rather than gating a no-op) because
	// canView returns true for a nonexistent videoId by design, so a bogus id
	// would otherwise reach the insert below.
	const accessExit = await Effect.gen(function* () {
		const videosPolicy = yield* VideosPolicy;
		return yield* Effect.promise(() =>
			db()
				.select({ id: videos.id })
				.from(videos)
				.where(eq(videos.id, videoId))
				.limit(1),
		).pipe(Policy.withPublicPolicy(videosPolicy.canView(videoId)));
	}).pipe(provideOptionalAuth, EffectRuntime.runPromiseExit);

	if (Exit.isFailure(accessExit)) {
		console.error("Video access check failed:", accessExit);
		throw new Error("Video not found");
	}

	if (accessExit.value.length === 0) {
		throw new Error("Video not found");
	}

	const id = Comment.CommentId.make(nanoId());

	const newComment = {
		id: id,
		authorId: user.id,
		type: type,
		content: content,
		videoId: videoId,
		timestamp: timestamp ?? null,
		parentCommentId: parentCommentId,
		mediaKey: null,
		mediaDuration: null,
		mediaMeta: null,
		event,
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	const slackNotificationInput =
		conditionalType === "comment" || conditionalType === "reply"
			? {
					videoId,
					authorId: user.id,
					comment: { id, content },
					parentCommentId,
					kind: conditionalType as "comment" | "reply",
				}
			: event?.type === "resolution"
				? {
						videoId,
						authorId: user.id,
						comment: { id, content },
						parentCommentId,
						kind: "resolution" as const,
					}
				: null;

	await db().transaction(async (tx) => {
		await tx.insert(comments).values(newComment);
		if (slackNotificationInput) {
			await tx.insert(slackCommentNotificationOutbox).values({
				commentId: id,
				payload: slackNotificationInput,
			});
		}
	});

	if (slackNotificationInput) {
		await enqueueSlackCommentNotification();
	}

	if (conditionalType) {
		try {
			await createNotification({
				type: conditionalType,
				videoId,
				authorId: user.id,
				comment: { id, content },
				parentCommentId,
			});
		} catch (error) {
			console.error("Failed to create notification:", error);
		}
	}

	// Add author name to the returned data
	const commentWithAuthor = {
		...newComment,
		authorName: user.name,
		authorImage: data.authorImage,
		sending: false,
	};

	revalidatePath(`/s/${videoId}`);

	return commentWithAuthor;
}
