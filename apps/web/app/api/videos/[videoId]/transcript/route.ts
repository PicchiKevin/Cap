import type { Video } from "@cap/web-domain";
import {
	getRequestUser,
	getTranscriptVtt,
	getViewableVideo,
} from "@/lib/agent-api";
import { parseVttCues, vttToPlainText } from "@/lib/vtt";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[videoId]/transcript?format=vtt|text|json
 *
 * Machine-friendly transcript access. Auth via session cookie or
 * `Authorization: Bearer <api-key>`; public videos need no auth.
 */
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

		const user = await getRequestUser(request);
		const video = await getViewableVideo(videoId, user);

		if (!video) {
			return Response.json({ error: "Video not found" }, { status: 404 });
		}

		if (video.transcriptionStatus !== "COMPLETE") {
			return Response.json(
				{
					error: "Transcript not ready",
					transcriptionStatus: video.transcriptionStatus,
				},
				{ status: 409 },
			);
		}

		const vtt = await getTranscriptVtt(video);
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
