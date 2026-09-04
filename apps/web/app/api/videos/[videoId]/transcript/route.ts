import type { Video } from "@cap/web-domain";
import { Option } from "effect";
import {
	getAgentTranscriptVtt,
	getAgentVideoRequestAuthentication,
	getAgentViewableVideo,
	isAgentTranscriptDisabled,
} from "@/lib/agent-video-api";
import { parseVttCues, vttToPlainText } from "@/lib/vtt";

export const dynamic = "force-dynamic";

export async function GET(
	request: Request,
	props: { params: Promise<{ videoId: string }> },
) {
	try {
		const { videoId } = (await props.params) as { videoId: Video.VideoId };
		const format = new URL(request.url).searchParams.get("format") ?? "vtt";
		if (!["vtt", "text", "json"].includes(format)) {
			return Response.json(
				{ error: "Invalid format. Use vtt, text, or json" },
				{ status: 400 },
			);
		}

		const authentication = await getAgentVideoRequestAuthentication(request);
		if (authentication.type === "invalid") {
			return Response.json({ error: "Invalid credential" }, { status: 401 });
		}

		const video = await getAgentViewableVideo(videoId, authentication);
		if (!video) {
			return Response.json({ error: "Video not found" }, { status: 404 });
		}
		if (await isAgentTranscriptDisabled(video.id)) {
			return Response.json(
				{ error: "Transcript unavailable" },
				{ status: 404 },
			);
		}
		const transcriptionStatus = Option.getOrNull(video.transcriptionStatus);
		if (transcriptionStatus !== "COMPLETE") {
			return Response.json(
				{
					error: "Transcript not ready",
					transcriptionStatus,
				},
				{ status: 409 },
			);
		}

		const vtt = await getAgentTranscriptVtt(video);
		if (!vtt) {
			return Response.json(
				{ error: "Transcript file not found" },
				{ status: 404 },
			);
		}
		if (format === "text") {
			return new Response(vttToPlainText(vtt), {
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}
		if (format === "json") {
			return Response.json({
				videoId: video.id,
				name: video.name,
				cues: parseVttCues(vtt),
			});
		}

		return new Response(vtt, {
			headers: { "content-type": "text/vtt; charset=utf-8" },
		});
	} catch (error) {
		console.error("[transcript] Error serving transcript:", error);
		return Response.json({ error: "Internal server error" }, { status: 500 });
	}
}
