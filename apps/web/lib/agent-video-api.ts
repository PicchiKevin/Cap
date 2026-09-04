import "server-only";

import { createHash } from "node:crypto";
import { db } from "@cap/database";
import { getCurrentUser } from "@cap/database/auth/session";
import {
	agentApiKeys,
	authApiKeys,
	organizations,
	spaces,
	spaceVideos,
	users,
	videos,
} from "@cap/database/schema";
import {
	agentLastUsedRefreshMs,
	isLegacyAgentKeySource,
	makeCurrentUserLayer,
	resolveEffectiveVideoRules,
	Storage,
	shouldRefreshAgentLastUsedAt,
	Videos,
} from "@cap/web-backend";
import { Video } from "@cap/web-domain";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { Effect, Option } from "effect";
import { hasAgentReadScope } from "@/lib/agent-auth";
import { createAgentMediaToken } from "@/lib/agent-media-token";
import { runPromise } from "@/lib/server";

type DbUser = typeof users.$inferSelect;

export type AgentVideoRequestAuthentication =
	| { type: "anonymous" }
	| { type: "authenticated"; user: DbUser }
	| { type: "invalid" };

const parseBearerToken = (request: Request) => {
	const authorization = request.headers.get("authorization");
	if (!authorization) return undefined;
	const [scheme, token, extra] = authorization.trim().split(/\s+/);
	if (scheme?.toLowerCase() !== "bearer" || !token || extra) return null;
	return token;
};

const hashAgentToken = (token: string) =>
	createHash("sha256").update(token).digest("hex");

const getAgentKeyUser = async (token: string): Promise<DbUser | null> => {
	if (/^cap_cli_[A-Za-z0-9_-]{43}$/.test(token)) {
		const [entry] = await db()
			.select({
				tokenId: agentApiKeys.id,
				user: users,
				scopes: agentApiKeys.scopes,
				lastUsedAt: agentApiKeys.lastUsedAt,
			})
			.from(agentApiKeys)
			.innerJoin(users, eq(agentApiKeys.userId, users.id))
			.where(
				and(
					eq(agentApiKeys.tokenHash, hashAgentToken(token)),
					isNull(agentApiKeys.revokedAt),
					gt(agentApiKeys.expiresAt, new Date()),
				),
			)
			.limit(1);
		if (!entry || !hasAgentReadScope(entry.scopes)) return null;

		const now = new Date();
		if (shouldRefreshAgentLastUsedAt(entry.lastUsedAt, now)) {
			await db()
				.update(agentApiKeys)
				.set({ lastUsedAt: now })
				.where(
					and(
						eq(agentApiKeys.id, entry.tokenId),
						or(
							isNull(agentApiKeys.lastUsedAt),
							lte(
								agentApiKeys.lastUsedAt,
								new Date(now.getTime() - agentLastUsedRefreshMs),
							),
						),
					),
				)
				.catch(() => undefined);
		}

		return entry.user;
	}

	if (token.length !== 36) return null;

	const [entry] = await db()
		.select({ user: users, source: authApiKeys.source })
		.from(authApiKeys)
		.innerJoin(users, eq(authApiKeys.userId, users.id))
		.where(eq(authApiKeys.id, token))
		.limit(1);

	return entry && isLegacyAgentKeySource(entry.source) ? entry.user : null;
};

export const getAgentVideoRequestAuthentication = async (
	request: Request,
): Promise<AgentVideoRequestAuthentication> => {
	const token = parseBearerToken(request);
	if (token === undefined) {
		const user = await getCurrentUser();
		return user ? { type: "authenticated", user } : { type: "anonymous" };
	}
	if (token === null) return { type: "invalid" };

	const user = await getAgentKeyUser(token);
	return user ? { type: "authenticated", user } : { type: "invalid" };
};

export const getAgentViewableVideo = async (
	videoId: Video.VideoId,
	authentication: Exclude<AgentVideoRequestAuthentication, { type: "invalid" }>,
) => {
	const program = Effect.gen(function* () {
		const videos = yield* Videos;
		const [video] = yield* videos
			.getByIdForViewing(videoId)
			.pipe(Effect.flatten);
		return video;
	}).pipe(Effect.option);
	const viewable =
		authentication.type === "authenticated"
			? program.pipe(Effect.provide(makeCurrentUserLayer(authentication.user)))
			: program;

	return Option.getOrNull(await runPromise(viewable));
};

export const getAgentTranscriptVtt = async (video: Video.Video) => {
	const result = await Effect.gen(function* () {
		const [bucket] = yield* Storage.getAccessForVideo(video);
		return yield* bucket.getObject(
			`${video.ownerId}/${video.id}/transcription.vtt`,
		);
	}).pipe(Effect.option, runPromise);

	return Option.getOrNull(Option.flatten(result));
};

export const isAgentTranscriptDisabled = async (videoId: Video.VideoId) => {
	const [[settings], sharedSpaces] = await Promise.all([
		db()
			.select({
				videoSettings: videos.settings,
				organizationSettings: organizations.settings,
			})
			.from(videos)
			.leftJoin(organizations, eq(videos.orgId, organizations.id))
			.where(eq(videos.id, videoId))
			.limit(1),
		db()
			.select({
				id: spaces.id,
				name: spaces.name,
				settings: spaces.settings,
			})
			.from(spaceVideos)
			.innerJoin(spaces, eq(spaceVideos.spaceId, spaces.id))
			.where(eq(spaceVideos.videoId, videoId)),
	]);

	return resolveEffectiveVideoRules({
		videoSettings: settings?.videoSettings,
		organizationSettings: settings?.organizationSettings,
		spaces: sharedSpaces,
	}).settings.disableTranscript;
};

const canAgentMediaAccessBeAnonymous = async (videoId: Video.VideoId) => {
	const [[video], sharedSpaces] = await Promise.all([
		db()
			.select({
				public: videos.public,
				password: videos.password,
				allowedEmailDomain: organizations.allowedEmailDomain,
			})
			.from(videos)
			.leftJoin(organizations, eq(videos.orgId, organizations.id))
			.where(eq(videos.id, videoId))
			.limit(1),
		db()
			.select({ password: spaces.password })
			.from(spaceVideos)
			.innerJoin(spaces, eq(spaceVideos.spaceId, spaces.id))
			.where(eq(spaceVideos.videoId, videoId)),
	]);

	return Boolean(
		video?.public &&
			!video.password &&
			!video.allowedEmailDomain?.trim() &&
			sharedSpaces.every((space) => !space.password),
	);
};

export const getAgentVideoMedia = async (
	video: Video.Video,
	origin: string,
	authentication: Exclude<AgentVideoRequestAuthentication, { type: "invalid" }>,
) => {
	const [bucket] = await Storage.getAccessForVideo(video).pipe(runPromise);
	const isObjectAccessible = async (key: string) => {
		try {
			const url = await bucket.getInternalSignedObjectUrl(key).pipe(runPromise);
			return (
				await fetch(url, { method: "GET", headers: { range: "bytes=0-0" } })
			).ok;
		} catch {
			return false;
		}
	};
	const mp4Key = `${video.ownerId}/${video.id}/result.mp4`;
	const hasMp4 = await isObjectAccessible(mp4Key);
	const segments = new Video.SegmentsSource({
		videoId: video.id,
		ownerId: video.ownerId,
	});
	const hasSegments =
		!hasMp4 && (await isObjectAccessible(segments.getManifestKey()));

	const hlsParams = new URLSearchParams({
		videoId: video.id,
		videoType: hasSegments ? "segments-master" : "master",
	});
	const needsAgentMediaToken =
		authentication.type === "authenticated" ||
		!(await canAgentMediaAccessBeAnonymous(video.id));
	if (needsAgentMediaToken) {
		hlsParams.set(
			"agentMediaToken",
			createAgentMediaToken({ videoId: video.id }),
		);
	}

	return {
		mp4Url: hasMp4
			? await bucket.getSignedObjectUrl(mp4Key).pipe(runPromise)
			: null,
		hlsUrl: `${origin}/api/playlist?${hlsParams}`,
	};
};
