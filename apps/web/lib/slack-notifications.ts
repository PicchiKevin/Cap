import { db } from "@cap/database";
import { comments, users, videos } from "@cap/database/schema";
import { serverEnv } from "@cap/env";
import { Comment, User, Video } from "@cap/web-domain";
import { and, eq, inArray, or } from "drizzle-orm";

// keep in sync with DONE_MESSAGE in the share page's threadState.ts
const DONE_MESSAGE = "This is done";

const SLACK_USER_CACHE_TTL_MS = 60 * 60 * 1000;

// email -> { slackUserId (null = no Slack account), fetchedAt }
const slackUserCache = new Map<
	string,
	{ slackUserId: string | null; fetchedAt: number }
>();

const slackApi = async <T extends { ok: boolean; error?: string }>(
	botToken: string,
	method: string,
	body: Record<string, unknown>,
): Promise<T | null> => {
	try {
		const response = await fetch(`https://slack.com/api/${method}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				Authorization: `Bearer ${botToken}`,
			},
			body: JSON.stringify(body),
		});
		return (await response.json()) as T;
	} catch (error) {
		console.error(`[slack-notifications] ${method} request failed:`, error);
		return null;
	}
};

const lookupSlackUserId = async (botToken: string, email: string) => {
	const cached = slackUserCache.get(email);
	if (cached && Date.now() - cached.fetchedAt < SLACK_USER_CACHE_TTL_MS) {
		return cached.slackUserId;
	}

	// users.lookupByEmail rejects JSON bodies (invalid_arguments) — query only
	type LookupResult = { ok: boolean; error?: string; user?: { id: string } };
	let result: LookupResult | null = null;
	try {
		const response = await fetch(
			`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
			{ headers: { Authorization: `Bearer ${botToken}` } },
		);
		result = (await response.json()) as LookupResult;
	} catch (error) {
		console.error(
			"[slack-notifications] users.lookupByEmail request failed:",
			error,
		);
	}

	// users_not_found is expected for emails without a Slack account
	const slackUserId = result?.ok && result.user ? result.user.id : null;
	if (result && (result.ok || result.error === "users_not_found")) {
		slackUserCache.set(email, { slackUserId, fetchedAt: Date.now() });
	} else if (result) {
		// missing_scope / invalid_auth etc. — surface it, otherwise DMs fail silently
		console.error(
			`[slack-notifications] users.lookupByEmail failed: ${result.error}`,
		);
	}
	return slackUserId;
};

const isDoneMessage = (content: string) =>
	content.trim().toLowerCase() === DONE_MESSAGE.toLowerCase();

interface CommentEventInput {
	videoId: string;
	authorId: string;
	comment: { id: string; content: string };
	parentCommentId?: string | null;
}

const collectRecipientIds = async (input: CommentEventInput) => {
	const database = db();
	const recipientIds = new Set<string>();

	const [video] = await database
		.select({ ownerId: videos.ownerId, name: videos.name })
		.from(videos)
		.where(eq(videos.id, Video.VideoId.make(input.videoId)))
		.limit(1);
	if (!video) return null;

	recipientIds.add(video.ownerId);

	const threadRootId = input.parentCommentId;
	if (threadRootId) {
		const participants = await database
			.select({ authorId: comments.authorId })
			.from(comments)
			.where(
				and(
					eq(comments.videoId, Video.VideoId.make(input.videoId)),
					or(
						eq(comments.id, Comment.CommentId.make(threadRootId)),
						eq(comments.parentCommentId, Comment.CommentId.make(threadRootId)),
					),
				),
			);
		for (const participant of participants) {
			recipientIds.add(participant.authorId);
		}
	}

	recipientIds.delete(input.authorId);

	return { recipientIds, videoName: video.name || "Untitled Video" };
};

/**
 * DM the people involved in a comment thread on Slack. Recipients are the
 * video owner plus, for replies, everyone who has written in the thread —
 * never the author of the event itself. Fire-and-forget: callers should not
 * await this on the request path.
 */
export async function sendSlackCommentNotification(input: CommentEventInput) {
	try {
		const botToken = serverEnv().SLACK_BOT_TOKEN;
		if (!botToken) return;

		const collected = await collectRecipientIds(input);
		if (!collected || collected.recipientIds.size === 0) return;

		const database = db();

		const [author] = await database
			.select({ name: users.name, email: users.email })
			.from(users)
			.where(eq(users.id, User.UserId.make(input.authorId)))
			.limit(1);
		const authorName = author?.name || author?.email || "Someone";

		const recipients = await database
			.select({ id: users.id, email: users.email })
			.from(users)
			.where(
				inArray(
					users.id,
					[...collected.recipientIds].map((id) => User.UserId.make(id)),
				),
			);

		const webUrl = serverEnv().WEB_URL;
		const isReply = Boolean(input.parentCommentId);
		const done = isDoneMessage(input.comment.content);
		const threadUrl = isReply
			? `${webUrl}/s/${input.videoId}?reply=${input.comment.id}`
			: `${webUrl}/s/${input.videoId}?comment=${input.comment.id}`;

		let headline: string;
		if (done) {
			headline = `:white_check_mark: *${authorName}* marked a thread as done on *${collected.videoName}*`;
		} else if (isReply) {
			headline = `:speech_balloon: *${authorName}* replied in a thread on *${collected.videoName}*`;
		} else {
			headline = `:speech_balloon: *${authorName}* commented on *${collected.videoName}*`;
		}

		const preview = done
			? null
			: input.comment.content.length > 300
				? `${input.comment.content.slice(0, 300)}…`
				: input.comment.content;

		const text = done
			? `${authorName} marked a thread as done on ${collected.videoName}`
			: `${authorName} commented on ${collected.videoName}: ${input.comment.content}`;

		const blocks = [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: preview ? `${headline}\n>${preview}` : headline,
				},
			},
			{
				type: "context",
				elements: [
					{
						type: "mrkdwn",
						text: `<${threadUrl}|View thread>`,
					},
				],
			},
		];

		await Promise.all(
			recipients.map(async (recipient) => {
				if (!recipient.email) return;
				const slackUserId = await lookupSlackUserId(botToken, recipient.email);
				if (!slackUserId) return;

				const result = await slackApi<{ ok: boolean; error?: string }>(
					botToken,
					"chat.postMessage",
					{ channel: slackUserId, text, blocks, unfurl_links: false },
				);
				if (result && !result.ok) {
					console.error(
						`[slack-notifications] chat.postMessage failed for ${slackUserId}:`,
						result.error,
					);
				}
			}),
		);
	} catch (error) {
		console.error(
			"[slack-notifications] Failed to send comment notification:",
			error,
		);
	}
}
