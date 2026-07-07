import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@cap/database";
import {
	organizations,
	users,
	videos,
	videoUploads,
} from "@cap/database/schema";
import type { VideoMetadata } from "@cap/database/types";
import { serverEnv } from "@cap/env";
import { userIsPro } from "@cap/utils";
import { Storage } from "@cap/web-backend";
import {
	AI_GENERATION_LANGUAGE_AUTO,
	type AiGenerationLanguage,
	type AiGenerationLanguageCode,
	parseAiGenerationLanguage,
	Video,
} from "@cap/web-domain";
import { createClient } from "@deepgram/sdk";
import { eq } from "drizzle-orm";
import type { Effect } from "effect";
import { FatalError } from "workflow";
import {
	ENHANCED_AUDIO_CONTENT_TYPE,
	ENHANCED_AUDIO_EXTENSION,
	enhanceAudioFromUrl,
} from "@/lib/audio-enhance";
import { checkHasAudioTrack, extractAudioFromUrl } from "@/lib/audio-extract";
import { startAiGeneration } from "@/lib/generate-ai";
import {
	checkHasAudioTrackViaMediaServer,
	extractAudioViaMediaServer,
	isMediaServerConfigured,
	probeVideoViaMediaServer,
} from "@/lib/media-client";
import { runPromise } from "@/lib/server";
import { type DeepgramResult, formatToWebVTT } from "@/lib/transcribe-utils";
import { decodeStorageVideo } from "@/lib/video-storage";

interface TranscribeWorkflowPayload {
	videoId: string;
	userId: string;
	aiGenerationEnabled: boolean;
}

interface VideoData {
	video: typeof videos.$inferSelect;
	transcriptionDisabled: boolean;
	isOwnerPro: boolean;
	aiGenerationLanguage: AiGenerationLanguage;
}

export async function transcribeVideoWorkflow(
	payload: TranscribeWorkflowPayload,
) {
	"use workflow";

	const { videoId, userId, aiGenerationEnabled } = payload;

	const videoData = await validateVideo(videoId);

	if (videoData.transcriptionDisabled) {
		await markSkipped(videoId);
		return { success: true, message: "Transcription disabled - skipped" };
	}

	try {
		const audioUrl = await extractAudio(videoId, userId, videoData.video);

		if (!audioUrl) {
			await markNoAudio(videoId);
			return {
				success: true,
				message: "Video has no audio track - skipped transcription",
			};
		}

		const [transcription] = await Promise.all([
			transcribeWithDeepgram(audioUrl, videoData.aiGenerationLanguage),
		]);

		await saveTranscription(videoId, userId, videoData.video, transcription);
	} catch (error) {
		await markError(videoId);
		await cleanupTempAudio(videoId, userId, videoData.video);
		throw error;
	}

	await cleanupTempAudio(videoId, userId, videoData.video);

	if (aiGenerationEnabled) {
		await queueAiGeneration(videoId, userId);
	}

	return { success: true, message: "Transcription completed successfully" };
}

async function validateVideo(videoId: string): Promise<VideoData> {
	"use step";

	if (!serverEnv().DEEPGRAM_API_KEY) {
		throw new FatalError("Missing DEEPGRAM_API_KEY");
	}

	const query = await db()
		.select({
			video: videos,
			settings: videos.settings,
			orgSettings: organizations.settings,
			owner: users,
		})
		.from(videos)
		.leftJoin(organizations, eq(videos.orgId, organizations.id))
		.innerJoin(users, eq(videos.ownerId, users.id))
		.where(eq(videos.id, videoId as Video.VideoId));

	if (query.length === 0) {
		throw new FatalError("Video does not exist");
	}

	const result = query[0];
	if (!result?.video) {
		throw new FatalError("Video information is missing");
	}

	const transcriptionDisabled =
		result.video.settings?.disableTranscript ??
		result.orgSettings?.disableTranscript ??
		false;

	const isOwnerPro = userIsPro(result.owner);

	console.log(
		`[transcribe] Owner check: stripeSubscriptionStatus=${result.owner.stripeSubscriptionStatus}, thirdPartyStripeSubscriptionId=${result.owner.thirdPartyStripeSubscriptionId}, isOwnerPro=${isOwnerPro}`,
	);

	await db()
		.update(videos)
		.set({ transcriptionStatus: "PROCESSING" })
		.where(eq(videos.id, videoId as Video.VideoId));

	return {
		video: result.video,
		transcriptionDisabled,
		isOwnerPro,
		aiGenerationLanguage: parseAiGenerationLanguage(
			result.orgSettings?.aiGenerationLanguage,
		),
	};
}

async function markSkipped(videoId: string): Promise<void> {
	"use step";

	await db()
		.update(videos)
		.set({ transcriptionStatus: "SKIPPED" })
		.where(eq(videos.id, videoId as Video.VideoId));
}

async function markNoAudio(videoId: string): Promise<void> {
	"use step";

	await db()
		.update(videos)
		.set({ transcriptionStatus: "NO_AUDIO" })
		.where(eq(videos.id, videoId as Video.VideoId));
}

async function markError(videoId: string): Promise<void> {
	"use step";

	await db()
		.update(videos)
		.set({ transcriptionStatus: "ERROR" })
		.where(eq(videos.id, videoId as Video.VideoId));
}

async function extractAudio(
	videoId: string,
	userId: string,
	video: typeof videos.$inferSelect,
): Promise<string | null> {
	"use step";

	const [bucket] = await Storage.getAccessForVideo(
		decodeStorageVideo(video),
	).pipe(runPromise);

	let videoUrl: string;
	try {
		videoUrl = await resolveVideoSourceUrl(videoId, userId, video);
	} catch (sourceError) {
		const segmentsResult = await extractAudioFromSegments(video, bucket);

		if (segmentsResult === "no-segments") {
			throw sourceError;
		}

		if (segmentsResult === "no-audio") {
			console.log(
				`[transcribe] Segmented recording ${videoId} has no audio track`,
			);
			return null;
		}

		return await uploadTempAudio(bucket, userId, videoId, segmentsResult);
	}

	const useMediaServer = isMediaServerConfigured();
	console.log(
		`[transcribe] Audio detection: useMediaServer=${useMediaServer}, videoId=${videoId}`,
	);

	let hasAudio: boolean;
	let audioBuffer: Buffer;

	if (useMediaServer) {
		try {
			const probe = await probeVideoViaMediaServer(videoUrl);
			console.log(
				`[transcribe] Probe result for ${videoId}: audioCodec=${probe.audioCodec}, videoCodec=${probe.videoCodec}, duration=${probe.duration}, audioChannels=${probe.audioChannels}, sampleRate=${probe.sampleRate}`,
			);
			hasAudio = probe.audioCodec !== null;
		} catch (probeError) {
			console.error(
				`[transcribe] Probe failed for ${videoId}, falling back to audio check:`,
				probeError,
			);
			hasAudio = await checkHasAudioTrackViaMediaServer(videoUrl);
			console.log(
				`[transcribe] Fallback audio check result for ${videoId}: hasAudio=${hasAudio}`,
			);
		}

		if (!hasAudio) {
			console.log(
				`[transcribe] No audio track detected for ${videoId} via media server`,
			);
			return null;
		}

		audioBuffer = await extractAudioViaMediaServer(videoUrl);
	} else {
		hasAudio = await checkHasAudioTrack(videoUrl);
		console.log(
			`[transcribe] Local ffmpeg audio check for ${videoId}: hasAudio=${hasAudio}`,
		);
		if (!hasAudio) {
			return null;
		}

		const result = await extractAudioFromUrl(videoUrl);

		try {
			audioBuffer = await fs.readFile(result.filePath);
		} finally {
			await result.cleanup();
		}
	}

	return await uploadTempAudio(bucket, userId, videoId, audioBuffer);
}

type VideoBucketAccess = Effect.Effect.Success<
	ReturnType<typeof Storage.getAccessForVideo>
>[0];

async function uploadTempAudio(
	bucket: VideoBucketAccess,
	userId: string,
	videoId: string,
	audioBuffer: Buffer,
): Promise<string> {
	console.log(
		`[transcribe] Extracted audio for ${videoId}: ${audioBuffer.length} bytes`,
	);

	const audioKey = `${userId}/${videoId}/audio-temp.mp3`;

	await bucket
		.putObject(audioKey, audioBuffer, {
			contentType: "audio/mpeg",
		})
		.pipe(runPromise);

	return await bucket.getInternalSignedObjectUrl(audioKey).pipe(runPromise);
}

async function extractAudioFromSegments(
	video: typeof videos.$inferSelect,
	bucket: VideoBucketAccess,
): Promise<Buffer | "no-segments" | "no-audio"> {
	const segSource = new Video.SegmentsSource({
		videoId: video.id,
		ownerId: video.ownerId,
	});

	const fetchObject = async (key: string): Promise<Buffer | null> => {
		const url = await bucket.getInternalSignedObjectUrl(key).pipe(runPromise);
		const response = await fetch(url);
		if (!response.ok) return null;
		return Buffer.from(await response.arrayBuffer());
	};

	const manifestBuffer = await fetchObject(segSource.getManifestKey());
	if (!manifestBuffer) {
		return "no-segments";
	}

	let manifest: Video.SegmentManifestType;
	try {
		manifest = JSON.parse(manifestBuffer.toString("utf-8"));
	} catch {
		console.error(
			`[transcribe] Failed to parse segments manifest for ${video.id}`,
		);
		return "no-segments";
	}

	if (!manifest.audio_init_uploaded || manifest.audio_segments.length === 0) {
		return "no-audio";
	}

	console.log(
		`[transcribe] Extracting audio from ${manifest.audio_segments.length} segments for ${video.id}`,
	);

	const audioInit = await fetchObject(segSource.getAudioInitKey());
	if (!audioInit) {
		throw new Error("Audio init segment not accessible");
	}

	const parts: Buffer[] = [audioInit];
	for (const entry of manifest.audio_segments) {
		const { index } = Video.normalizeSegmentEntry(entry);
		const segment = await fetchObject(segSource.getAudioSegmentKey(index));
		if (!segment) {
			throw new Error(`Audio segment ${index} not accessible`);
		}
		parts.push(segment);
	}

	const fmp4Path = join(tmpdir(), `segments-audio-${randomUUID()}.mp4`);
	await fs.writeFile(fmp4Path, Buffer.concat(parts));

	try {
		const result = await extractAudioFromUrl(fmp4Path);
		try {
			return await fs.readFile(result.filePath);
		} finally {
			await result.cleanup();
		}
	} finally {
		await fs.unlink(fmp4Path).catch(() => {});
	}
}

async function resolveVideoSourceUrl(
	videoId: string,
	userId: string,
	video: typeof videos.$inferSelect,
): Promise<string> {
	const [resolvedBucket] = await Storage.getAccessForVideo(
		decodeStorageVideo(video),
	).pipe(runPromise);

	const upload = await db()
		.select({ rawFileKey: videoUploads.rawFileKey })
		.from(videoUploads)
		.where(eq(videoUploads.videoId, videoId as Video.VideoId))
		.limit(1);

	const candidateKeys = [
		`${video.ownerId}/${videoId}/result.mp4`,
		`${userId}/${videoId}/result.mp4`,
		upload[0]?.rawFileKey,
	].filter(
		(value, index, values): value is string =>
			Boolean(value) && values.indexOf(value) === index,
	);

	for (const key of candidateKeys) {
		const url = await resolvedBucket
			.getInternalSignedObjectUrl(key)
			.pipe(runPromise);
		const response = await fetch(url, {
			method: "GET",
			headers: { range: "bytes=0-0" },
		});

		if (response.ok) {
			console.log(`[transcribe] Using video source ${key}`);
			return url;
		}
	}

	throw new Error("Video file not accessible");
}

export function getDeepgramTranscriptionOptions(
	language: AiGenerationLanguage,
) {
	const baseOptions = {
		model: "nova-3",
		smart_format: true,
		utterances: true,
		mime_type: "audio/mpeg",
	} as const;

	if (language === AI_GENERATION_LANGUAGE_AUTO) {
		return {
			...baseOptions,
			detect_language: [...DEEPGRAM_DETECTABLE_LANGUAGES],
		};
	}

	return {
		...baseOptions,
		language,
	};
}

async function transcribeWithDeepgram(
	audioUrl: string,
	language: AiGenerationLanguage,
): Promise<string> {
	"use step";

	const audioResponse = await fetch(audioUrl);
	if (!audioResponse.ok) {
		throw new Error(
			`Audio URL not accessible: ${audioResponse.status} ${audioResponse.statusText}`,
		);
	}

	const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

	const deepgram = createClient(serverEnv().DEEPGRAM_API_KEY as string);

	const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
		audioBuffer,
		getDeepgramTranscriptionOptions(language),
	);

	if (error) {
		throw new Error(
			`Deepgram transcription failed (language=${language}): ${error.message}`,
		);
	}

	return formatToWebVTT(result as unknown as DeepgramResult);
}

const DEEPGRAM_DETECTABLE_LANGUAGES = [
	"en",
	"es",
	"fr",
	"de",
	"pt",
	"it",
	"nl",
	"pl",
	"ro",
	"sk",
	"ru",
	"tr",
	"ja",
	"ko",
	"zh",
	"hi",
] as const satisfies readonly AiGenerationLanguageCode[];

async function saveTranscription(
	videoId: string,
	userId: string,
	video: typeof videos.$inferSelect,
	transcription: string,
): Promise<void> {
	"use step";

	const [bucket] = await Storage.getAccessForVideo(
		decodeStorageVideo(video),
	).pipe(runPromise);

	await bucket
		.putObject(`${userId}/${videoId}/transcription.vtt`, transcription, {
			contentType: "text/vtt",
		})
		.pipe(runPromise);

	await db()
		.update(videos)
		.set({ transcriptionStatus: "COMPLETE" })
		.where(eq(videos.id, videoId as Video.VideoId));
}

async function cleanupTempAudio(
	videoId: string,
	userId: string,
	video: typeof videos.$inferSelect,
): Promise<void> {
	"use step";

	const audioKey = `${userId}/${videoId}/audio-temp.mp3`;

	try {
		const [bucket] = await Storage.getAccessForVideo(
			decodeStorageVideo(video),
		).pipe(runPromise);

		await bucket.deleteObject(audioKey).pipe(runPromise);
	} catch (error) {
		console.error(
			`[transcribe] Failed to cleanup temp audio file: ${audioKey}`,
			error,
		);
	}
}

async function queueAiGeneration(
	videoId: string,
	userId: string,
): Promise<void> {
	"use step";

	await startAiGeneration(videoId as Video.VideoId, userId);
}

async function _markEnhancedAudioProcessing(videoId: string): Promise<void> {
	"use step";

	const [video] = await db()
		.select({ metadata: videos.metadata })
		.from(videos)
		.where(eq(videos.id, videoId as Video.VideoId));

	const currentMetadata = (video?.metadata as VideoMetadata) || {};

	await db()
		.update(videos)
		.set({
			metadata: {
				...currentMetadata,
				enhancedAudioStatus: "PROCESSING",
			},
		})
		.where(eq(videos.id, videoId as Video.VideoId));
}

async function _enhanceAndSaveAudio(
	videoId: string,
	userId: string,
	audioUrl: string,
	video: typeof videos.$inferSelect,
): Promise<void> {
	"use step";

	console.log(`[transcribe] Starting audio enhancement for video ${videoId}`);

	try {
		const enhancedBuffer = await enhanceAudioFromUrl(audioUrl);
		console.log(
			`[transcribe] Audio enhanced, saving to S3 (${enhancedBuffer.length} bytes)`,
		);

		const [bucket] = await Storage.getAccessForVideo(
			decodeStorageVideo(video),
		).pipe(runPromise);

		const enhancedAudioKey = `${userId}/${videoId}/enhanced-audio.${ENHANCED_AUDIO_EXTENSION}`;

		await bucket
			.putObject(enhancedAudioKey, enhancedBuffer, {
				contentType: ENHANCED_AUDIO_CONTENT_TYPE,
			})
			.pipe(runPromise);

		const [videoRecord] = await db()
			.select({ metadata: videos.metadata })
			.from(videos)
			.where(eq(videos.id, videoId as Video.VideoId));

		const currentMetadata = (videoRecord?.metadata as VideoMetadata) || {};

		await db()
			.update(videos)
			.set({
				metadata: {
					...currentMetadata,
					enhancedAudioStatus: "COMPLETE",
				},
			})
			.where(eq(videos.id, videoId as Video.VideoId));
	} catch (error) {
		console.error(
			`[transcribe] Audio enhancement failed for video ${videoId}:`,
			error,
		);

		const [video] = await db()
			.select({ metadata: videos.metadata })
			.from(videos)
			.where(eq(videos.id, videoId as Video.VideoId));

		const currentMetadata = (video?.metadata as VideoMetadata) || {};

		await db()
			.update(videos)
			.set({
				metadata: {
					...currentMetadata,
					enhancedAudioStatus: "ERROR",
				},
			})
			.where(eq(videos.id, videoId as Video.VideoId));
	}
}
