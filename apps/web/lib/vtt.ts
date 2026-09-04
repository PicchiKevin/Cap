import { parseAgentVtt } from "@/lib/agent-api";

export interface TranscriptCue {
	start: string;
	end: string;
	text: string;
}

const formatVttTimestamp = (milliseconds: number) => {
	const hours = Math.floor(milliseconds / 3_600_000);
	const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
	const seconds = Math.floor((milliseconds % 60_000) / 1_000);
	const remainder = milliseconds % 1_000;
	return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${remainder.toString().padStart(3, "0")}`;
};

export function parseVttCues(vtt: string): TranscriptCue[] {
	return parseAgentVtt(vtt).map((cue) => ({
		start: formatVttTimestamp(cue.startMs),
		end: formatVttTimestamp(cue.endMs),
		text: cue.text.replace(/\s+/g, " "),
	}));
}

export function vttToPlainText(vtt: string): string {
	return parseVttCues(vtt)
		.map((cue) => cue.text)
		.join("\n");
}
