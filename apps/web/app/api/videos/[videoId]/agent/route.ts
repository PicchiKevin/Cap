import { serverEnv } from "@cap/env";
import type { Video } from "@cap/web-domain";
import { Option } from "effect";
import {
	getAgentTranscriptVtt,
	getAgentVideoMedia,
	getAgentVideoRequestAuthentication,
	getAgentViewableVideo,
	isAgentTranscriptDisabled,
} from "@/lib/agent-video-api";
import { vttToPlainText } from "@/lib/vtt";

export const dynamic = "force-dynamic";

export async function GET(
	request: Request,
	props: { params: Promise<{ videoId: string }> },
) {
	try {
		const { videoId } = (await props.params) as { videoId: Video.VideoId };
		const authentication = await getAgentVideoRequestAuthentication(request);
		if (authentication.type === "invalid") {
			return Response.json({ error: "Invalid credential" }, { status: 401 });
		}

		const video = await getAgentViewableVideo(videoId, authentication);
		if (!video) {
			return Response.json({ error: "Video not found" }, { status: 404 });
		}

		const origin = serverEnv().WEB_URL.replace(/\/$/, "");
		const [media, transcriptDisabled] = await Promise.all([
			getAgentVideoMedia(video, origin, authentication),
			isAgentTranscriptDisabled(video.id),
		]);
		const transcriptionStatus = Option.getOrNull(video.transcriptionStatus);
		const transcriptVtt =
			!transcriptDisabled && transcriptionStatus === "COMPLETE"
				? await getAgentTranscriptVtt(video)
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
				status: transcriptionStatus,
				text: transcriptVtt ? vttToPlainText(transcriptVtt) : null,
				urls: transcriptDisabled
					? null
					: {
							vtt: `${origin}/api/videos/${video.id}/transcript?format=vtt`,
							text: `${origin}/api/videos/${video.id}/transcript?format=text`,
							json: `${origin}/api/videos/${video.id}/transcript?format=json`,
						},
			},
			media,
		});
	} catch (error) {
		console.error("[agent] Error serving agent bundle:", error);
		return Response.json({ error: "Internal server error" }, { status: 500 });
	}
}
