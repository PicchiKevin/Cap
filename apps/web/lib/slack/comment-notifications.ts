import { createHash } from "node:crypto";
import { db } from "@cap/database";
import { comments, users, videos } from "@cap/database/schema";
import { serverEnv } from "@cap/env";
import { User, Video } from "@cap/web-domain";
import { eq, inArray } from "drizzle-orm";
import { sendSlackDirectMessage } from "./client";
import {
	getSlackNotificationInstallationToken,
	listSlackInstallations,
} from "./installations";

const DONE_MESSAGE = "This is done";

export type SlackCommentNotificationInput = {
	videoId: string;
	authorId: string;
	comment: { id: string; content: string };
	parentCommentId?: string | null;
	kind: "comment" | "reply" | "resolution";
};

type ThreadComment = {
	id: string;
	parentCommentId: string | null;
	authorId: string;
};

export type SlackDelivery = {
	teamId: string;
	email: string;
	text: string;
	blocks: unknown[];
	clientMessageId: string;
};

const isDoneMessage = (content: string) =>
	content.trim().toLowerCase() === DONE_MESSAGE.toLowerCase();

const slackNotificationHeadline = ({
	authorName,
	videoName,
	isReply,
	done,
}: {
	authorName: string;
	videoName: string;
	isReply: boolean;
	done: boolean;
}) => {
	if (done) {
		return `:white_check_mark: *${authorName}* marked a thread as done on *${videoName}*`;
	}
	if (isReply) {
		return `:speech_balloon: *${authorName}* replied in a thread on *${videoName}*`;
	}
	return `:speech_balloon: *${authorName}* commented on *${videoName}*`;
};

const slackNotificationPreview = ({
	content,
	done,
}: {
	content: string;
	done: boolean;
}) => {
	if (done) return null;
	if (content.length <= 300) return content;
	return `${content.slice(0, 300)}…`;
};

export const resolveSlackThreadRoot = (
	parentCommentId: string | null | undefined,
	commentsById: Map<string, Pick<ThreadComment, "parentCommentId">>,
) => {
	let currentId = parentCommentId;
	const visited = new Set<string>();
	while (currentId && !visited.has(currentId)) {
		visited.add(currentId);
		const comment = commentsById.get(currentId);
		if (!comment?.parentCommentId) return currentId;
		currentId = comment.parentCommentId;
	}
	return parentCommentId ?? null;
};

export const collectSlackThreadParticipantIds = ({
	threadRootId,
	threadComments,
}: {
	threadRootId: string;
	threadComments: ThreadComment[];
}) => {
	const commentsById = new Map(
		threadComments.map((comment) => [comment.id, comment]),
	);
	const children = new Map<string, ThreadComment[]>();
	for (const comment of threadComments) {
		if (!comment.parentCommentId) continue;
		const siblings = children.get(comment.parentCommentId) ?? [];
		siblings.push(comment);
		children.set(comment.parentCommentId, siblings);
	}

	const participantIds = new Set<string>();
	const pending = [threadRootId];
	const visited = new Set<string>();
	while (pending.length > 0) {
		const commentId = pending.pop();
		if (!commentId || visited.has(commentId)) continue;
		visited.add(commentId);
		const comment = commentsById.get(commentId);
		if (comment) participantIds.add(comment.authorId);
		for (const child of children.get(commentId) ?? []) {
			pending.push(child.id);
		}
	}
	return participantIds;
};

const clientMessageId = ({
	commentId,
	teamId,
	recipientId,
}: {
	commentId: string;
	teamId: string;
	recipientId: string;
}) => {
	const value = createHash("sha256")
		.update(`${commentId}:${teamId}:${recipientId}`)
		.digest("hex");
	return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
};

export const prepareSlackCommentDeliveries = async (
	input: SlackCommentNotificationInput,
): Promise<SlackDelivery[]> => {
	const database = db();
	const [video] = await database
		.select({ orgId: videos.orgId, ownerId: videos.ownerId, name: videos.name })
		.from(videos)
		.where(eq(videos.id, Video.VideoId.make(input.videoId)))
		.limit(1);
	if (!video) return [];

	const threadComments = await database
		.select({
			id: comments.id,
			parentCommentId: comments.parentCommentId,
			authorId: comments.authorId,
		})
		.from(comments)
		.where(eq(comments.videoId, Video.VideoId.make(input.videoId)));
	const commentsById = new Map<string, ThreadComment>(
		threadComments.map((comment): [string, ThreadComment] => [
			comment.id,
			{
				id: comment.id,
				parentCommentId: comment.parentCommentId,
				authorId: comment.authorId,
			},
		]),
	);
	const threadRootId = resolveSlackThreadRoot(
		input.parentCommentId,
		commentsById,
	);
	const recipientIds = threadRootId
		? collectSlackThreadParticipantIds({ threadRootId, threadComments })
		: new Set<string>();
	recipientIds.add(video.ownerId);
	recipientIds.delete(input.authorId);
	if (recipientIds.size === 0) return [];

	const [author, recipients, installations] = await Promise.all([
		database
			.select({ name: users.name, email: users.email })
			.from(users)
			.where(eq(users.id, User.UserId.make(input.authorId)))
			.limit(1)
			.then(([user]) => user),
		database
			.select({ id: users.id, email: users.email })
			.from(users)
			.where(
				inArray(
					users.id,
					[...recipientIds].map((id) => User.UserId.make(id)),
				),
			),
		listSlackInstallations(video.orgId),
	]);
	const authorName = author?.name || author?.email || "Someone";
	const isReply = input.kind !== "comment";
	const done =
		input.kind === "resolution" || isDoneMessage(input.comment.content);
	const videoName = video.name || "Untitled Video";
	const threadUrl = isReply
		? `${serverEnv().WEB_URL}/s/${input.videoId}?reply=${input.comment.id}`
		: `${serverEnv().WEB_URL}/s/${input.videoId}?comment=${input.comment.id}`;
	const headline = slackNotificationHeadline({
		authorName,
		videoName,
		isReply,
		done,
	});
	const preview = slackNotificationPreview({
		content: input.comment.content,
		done,
	});
	const text = done
		? `${authorName} marked a thread as done on ${videoName}`
		: `${authorName} commented on ${videoName}: ${input.comment.content}`;
	const blocks: unknown[] = [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: preview ? `${headline}\n>${preview}` : headline,
			},
		},
		{
			type: "context",
			elements: [{ type: "mrkdwn", text: `<${threadUrl}|View thread>` }],
		},
	];

	return installations
		.filter((installation) => !installation.needsReauthorization)
		.flatMap((installation) =>
			recipients.flatMap((recipient) =>
				recipient.email
					? [
							{
								teamId: installation.teamId,
								email: recipient.email,
								text,
								blocks,
								clientMessageId: clientMessageId({
									commentId: input.comment.id,
									teamId: installation.teamId,
									recipientId: recipient.id,
								}),
							},
						]
					: [],
			),
		);
};

export const deliverSlackCommentNotification = async (
	delivery: SlackDelivery,
) => {
	const token = await getSlackNotificationInstallationToken(delivery.teamId);
	if (!token) return;
	await sendSlackDirectMessage({ token, ...delivery });
};

export const deliverSlackCommentNotifications = async ({
	deliveries,
	deliver,
}: {
	deliveries: SlackDelivery[];
	deliver: (delivery: SlackDelivery) => Promise<void>;
}) => {
	const failures: unknown[] = [];
	for (const delivery of deliveries) {
		try {
			await deliver(delivery);
		} catch (error) {
			failures.push(error);
		}
	}
	return failures;
};
