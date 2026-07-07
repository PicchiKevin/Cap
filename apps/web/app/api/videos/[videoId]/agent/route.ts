import { Storage } from "@cap/web-backend";
import { Video } from "@cap/web-domain";
import {
	getRequestUser,
	getTranscriptVtt,
	getViewableVideo,
} from "@/lib/agent-api";
import { runPromise } from "@/lib/server";
import { decodeStorageVideo } from "@/lib/video-storage";
import { vttToPlainText } from "@/lib/vtt";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[videoId]/agent
 *
 * One-call, agent-friendly bundle for a video: metadata, transcript
 * (plain text), and directly fetchable media URLs. Auth via session
 * cookie or `Authorization: Bearer <api-key>`; public videos need no auth.
 */
export async function GET(
	request: Request,
	props: { params: Promise<{ videoId: string }> },
) {
	try {
		const { videoId } = (await props.params) as { videoId: Video.VideoId };
		const origin = new URL(request.url).origin;

		const user = await getRequestUser(request);
		const video = await getViewableVideo(videoId, user);

		if (!video) {
			return Response.json({ error: "Video not found" }, { status: 404 });
		}

		const [bucket] = await Storage.getAccessForVideo(
			decodeStorageVideo(video),
		).pipe(runPromise);

		const isObjectAccessible = async (key: string): Promise<boolean> => {
			try {
				const url = await bucket
					.getInternalSignedObjectUrl(key)
					.pipe(runPromise);
				const response = await fetch(url, {
					method: "GET",
					headers: { range: "bytes=0-0" },
				});
				return response.ok;
			} catch {
				return false;
			}
		};

		const mp4Key = `${video.ownerId}/${video.id}/result.mp4`;
		const hasMp4 = await isObjectAccessible(mp4Key);

		const segSource = new Video.SegmentsSource({
			videoId: video.id,
			ownerId: video.ownerId,
		});
		const hasSegments = hasMp4
			? false
			: await isObjectAccessible(segSource.getManifestKey());

		const mp4Url = hasMp4
			? await bucket.getSignedObjectUrl(mp4Key).pipe(runPromise)
			: null;
		const hlsUrl = hasSegments
			? `${origin}/api/playlist?videoId=${video.id}&videoType=segments-master`
			: `${origin}/api/playlist?videoId=${video.id}&videoType=master`;

		const transcriptVtt =
			video.transcriptionStatus === "COMPLETE"
				? await getTranscriptVtt(video)
				: null;

		return Response.json({
			id: video.id,
			name: video.name,
			ownerId: video.ownerId,
			orgId: video.orgId,
			createdAt: video.createdAt,
			duration: video.duration,
			width: video.width,
			height: video.height,
			public: video.public,
			shareUrl: `${origin}/s/${video.id}`,
			transcription: {
				status: video.transcriptionStatus,
				text: transcriptVtt ? vttToPlainText(transcriptVtt) : null,
				urls: {
					vtt: `${origin}/api/videos/${video.id}/transcript?format=vtt`,
					text: `${origin}/api/videos/${video.id}/transcript?format=text`,
					json: `${origin}/api/videos/${video.id}/transcript?format=json`,
				},
			},
			media: {
				// Time-limited signed URL for direct download, when a muxed MP4 exists
				mp4Url,
				// HLS playlist (ffmpeg-compatible); requires the same auth as this call
				hlsUrl,
			},
		});
	} catch (error) {
		console.error("[agent] Error serving agent bundle:", error);
		return Response.json({ error: "Internal server error" }, { status: 500 });
	}
}
