import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@cap/database";
import { users, videos } from "@cap/database/schema";
import { buildEnv, serverEnv } from "@cap/env";
import { Video } from "@cap/web-domain";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const SIGNATURE_VERSION = "v0";
const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

interface SlackLinkSharedEvent {
	type: "link_shared";
	channel: string;
	message_ts: string;
	links: { url: string; domain: string }[];
}

interface SlackEventPayload {
	type: string;
	challenge?: string;
	event?: SlackLinkSharedEvent | { type: string };
}

const verifySlackSignature = (
	signingSecret: string,
	request: NextRequest,
	rawBody: string,
) => {
	const timestamp = request.headers.get("x-slack-request-timestamp");
	const signature = request.headers.get("x-slack-signature");
	if (!timestamp || !signature) return false;

	const age = Math.abs(Date.now() / 1000 - Number(timestamp));
	if (!Number.isFinite(age) || age > MAX_TIMESTAMP_SKEW_SECONDS) return false;

	const expected = `${SIGNATURE_VERSION}=${createHmac("sha256", signingSecret)
		.update(`${SIGNATURE_VERSION}:${timestamp}:${rawBody}`)
		.digest("hex")}`;

	const expectedBuffer = Buffer.from(expected);
	const signatureBuffer = Buffer.from(signature);
	return (
		expectedBuffer.length === signatureBuffer.length &&
		timingSafeEqual(expectedBuffer, signatureBuffer)
	);
};

const extractVideoId = (url: string) => {
	try {
		const parsed = new URL(url);
		const match = parsed.pathname.match(/^\/(?:s|embed)\/([0-9a-z]+)\/?$/);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
};

const buildUnfurl = (video: {
	id: string;
	name: string;
	authorName: string | null;
}) => {
	const webUrl = buildEnv.NEXT_PUBLIC_WEB_URL;
	const title = video.name.slice(0, 200) || "Cap Recording";

	return {
		blocks: [
			{
				type: "video",
				title: { type: "plain_text", text: title },
				title_url: `${webUrl}/s/${video.id}`,
				video_url: `${webUrl}/embed/${video.id}`,
				thumbnail_url: `${webUrl}/api/video/og?videoId=${video.id}`,
				alt_text: title,
				provider_name: "Cap",
				...(video.authorName ? { author_name: video.authorName } : {}),
			},
		],
	};
};

const handleLinkShared = async (
	botToken: string,
	event: SlackLinkSharedEvent,
) => {
	const unfurls: Record<string, ReturnType<typeof buildUnfurl>> = {};

	for (const link of event.links) {
		const videoId = extractVideoId(link.url);
		if (!videoId) continue;

		const [video] = await db()
			.select({
				id: videos.id,
				name: videos.name,
				public: videos.public,
				isScreenshot: videos.isScreenshot,
				authorName: users.name,
			})
			.from(videos)
			.leftJoin(users, eq(videos.ownerId, users.id))
			.where(eq(videos.id, Video.VideoId.make(videoId)))
			.limit(1);

		// only unfurl public videos: Slack previews are visible to the whole
		// channel regardless of who can actually open the link
		if (!video || !video.public || video.isScreenshot) continue;

		unfurls[link.url] = buildUnfurl(video);
	}

	if (Object.keys(unfurls).length === 0) return;

	const response = await fetch("https://slack.com/api/chat.unfurl", {
		method: "POST",
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			Authorization: `Bearer ${botToken}`,
		},
		body: JSON.stringify({
			channel: event.channel,
			ts: event.message_ts,
			unfurls,
		}),
	});

	const result = (await response.json()) as { ok: boolean; error?: string };
	if (!result.ok) {
		console.error("[slack/events] chat.unfurl failed:", result.error);
	}
};

export async function POST(request: NextRequest) {
	const env = serverEnv();
	const signingSecret = env.SLACK_SIGNING_SECRET;
	const botToken = env.SLACK_BOT_TOKEN;

	if (!signingSecret || !botToken) {
		return new Response("Slack integration is not configured", {
			status: 404,
		});
	}

	const rawBody = await request.text();

	if (!verifySlackSignature(signingSecret, request, rawBody)) {
		return new Response("Invalid signature", { status: 401 });
	}

	let payload: SlackEventPayload;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return new Response("Invalid payload", { status: 400 });
	}

	if (payload.type === "url_verification") {
		return Response.json({ challenge: payload.challenge });
	}

	if (
		payload.type === "event_callback" &&
		payload.event?.type === "link_shared"
	) {
		try {
			await handleLinkShared(botToken, payload.event as SlackLinkSharedEvent);
		} catch (error) {
			// always ack: Slack retries non-200s and disables slow endpoints
			console.error("[slack/events] Failed to unfurl links:", error);
		}
	}

	return new Response("ok", { status: 200 });
}
