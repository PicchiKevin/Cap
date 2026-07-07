import { db } from "@cap/database";
import { getCurrentUser } from "@cap/database/auth/session";
import { authApiKeys, users, videos } from "@cap/database/schema";
import {
	makeCurrentUserLayer,
	provideOptionalAuth,
	Storage,
	VideosPolicy,
} from "@cap/web-backend";
import { Policy, type Video } from "@cap/web-domain";
import { eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import * as EffectRuntime from "@/lib/server";
import { decodeStorageVideo } from "@/lib/video-storage";

type DbUser = typeof users.$inferSelect;
type DbVideo = typeof videos.$inferSelect;

/**
 * Resolves the requesting user from either the session cookie or an
 * `Authorization: Bearer <api-key>` header (keys from the authApiKeys table),
 * so both browsers and headless agents can call these endpoints.
 */
export async function getRequestUser(request: Request): Promise<DbUser | null> {
	const authHeader = request.headers.get("authorization");
	const token = authHeader?.split(" ")[1];

	if (token && token.length === 36) {
		const [entry] = await db()
			.select({ user: users })
			.from(authApiKeys)
			.innerJoin(users, eq(authApiKeys.userId, users.id))
			.where(eq(authApiKeys.id, token))
			.limit(1);

		return entry?.user ?? null;
	}

	return (await getCurrentUser()) ?? null;
}

/**
 * Loads a video, enforcing the same view policy as the share page:
 * public videos are visible to anyone, private ones to authorized users.
 */
export async function getViewableVideo(
	videoId: Video.VideoId,
	user: DbUser | null,
): Promise<DbVideo | null> {
	const program = Effect.gen(function* () {
		const videosPolicy = yield* VideosPolicy;

		return yield* Effect.promise(() =>
			db().select().from(videos).where(eq(videos.id, videoId)).limit(1),
		).pipe(Policy.withPublicPolicy(videosPolicy.canView(videoId)));
	});

	const exit = await program.pipe(
		user ? Effect.provide(makeCurrentUserLayer(user)) : provideOptionalAuth,
		EffectRuntime.runPromiseExit,
	);

	if (Exit.isFailure(exit)) return null;
	return exit.value[0] ?? null;
}

export async function getTranscriptVtt(video: DbVideo): Promise<string | null> {
	const exit = await Effect.gen(function* () {
		const [bucket] = yield* Storage.getAccessForVideo(
			decodeStorageVideo(video),
		);

		return yield* bucket.getObject(
			`${video.ownerId}/${video.id}/transcription.vtt`,
		);
	}).pipe(EffectRuntime.runPromiseExit);

	if (Exit.isFailure(exit)) return null;
	return exit.value._tag === "Some" ? exit.value.value : null;
}
