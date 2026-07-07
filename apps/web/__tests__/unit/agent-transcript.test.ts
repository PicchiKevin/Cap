import { describe, expect, it } from "vitest";
import { parseVttCues, vttToPlainText } from "@/lib/vtt";

const SAMPLE_VTT = `WEBVTT

1
00:00:00.000 --> 00:00:02.500
Hello and welcome.

2
00:00:02.500 --> 00:00:05.000
This is a test
across two lines.
`;

describe("parseVttCues", () => {
	it("parses cues with timings and joins multi-line text", () => {
		expect(parseVttCues(SAMPLE_VTT)).toEqual([
			{
				start: "00:00:00.000",
				end: "00:00:02.500",
				text: "Hello and welcome.",
			},
			{
				start: "00:00:02.500",
				end: "00:00:05.000",
				text: "This is a test across two lines.",
			},
		]);
	});

	it("ignores headers and malformed blocks", () => {
		expect(parseVttCues("WEBVTT\n\nnot a cue")).toEqual([]);
	});
});

describe("vttToPlainText", () => {
	it("returns one line per cue", () => {
		expect(vttToPlainText(SAMPLE_VTT)).toBe(
			"Hello and welcome.\nThis is a test across two lines.",
		);
	});
});
