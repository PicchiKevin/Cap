export interface TranscriptCue {
	start: string;
	end: string;
	text: string;
}

export function parseVttCues(vtt: string): TranscriptCue[] {
	const cues: TranscriptCue[] = [];
	const blocks = vtt.replace(/\r/g, "").split("\n\n");

	for (const block of blocks) {
		const lines = block.split("\n").filter(Boolean);
		const timingIndex = lines.findIndex((line) => line.includes("-->"));
		if (timingIndex === -1) continue;

		const timing = lines[timingIndex];
		const text = lines
			.slice(timingIndex + 1)
			.join(" ")
			.trim();
		if (!timing || !text) continue;

		const [start, end] = timing.split("-->").map((part) => part.trim());
		if (!start || !end) continue;

		cues.push({ start, end, text });
	}

	return cues;
}

export function vttToPlainText(vtt: string): string {
	return parseVttCues(vtt)
		.map((cue) => cue.text)
		.join("\n");
}
