import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createEditTranscript,
	editTranscriptWordsToCaptionVtt,
} from "@/lib/edit-transcript";
import { getTranscriptionProvider } from "@/lib/transcription-config";
import { transcribeAudio } from "@/lib/transcription-provider";

const mocks = vi.hoisted(() => ({
	env: {
		ASSEMBLY_API_KEY: undefined as string | undefined,
		DEEPGRAM_API_KEY: "deepgram-test" as string | undefined,
	},
	transcribe: vi.fn(),
	fetch: vi.fn(),
}));
vi.mock("@cap/env", () => ({ serverEnv: () => mocks.env }));
vi.mock("assemblyai", () => ({
	AssemblyAI: class {
		transcripts = { transcribe: mocks.transcribe };
	},
}));
vi.mock("workflow", () => ({ FatalError: class FatalError extends Error {} }));

const response = () => ({
	metadata: { duration: 2.5 },
	results: {
		channels: [
			{
				detected_language: "fr",
				alternatives: [
					{
						transcript: "Bonjour!",
						words: [
							{
								word: "bonjour",
								punctuated_word: "Bonjour!",
								start: 0.1234,
								end: 1.5678,
								confidence: 0.97,
								speaker: 1,
							},
						],
					},
				],
			},
		],
	},
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.env.ASSEMBLY_API_KEY = undefined;
	mocks.env.DEEPGRAM_API_KEY = "deepgram-test";
	vi.stubGlobal("fetch", mocks.fetch);
	mocks.fetch.mockImplementation(async () => Response.json(response()));
});

describe("transcription provider", () => {
	it.each([
		[{}, null],
		[{ ASSEMBLY_API_KEY: "a" }, "assemblyai"],
		[{ DEEPGRAM_API_KEY: "d" }, "deepgram"],
		[{ ASSEMBLY_API_KEY: "a", DEEPGRAM_API_KEY: "d" }, "assemblyai"],
	] as const)("selects configured provider for %j", (env, expected) => {
		expect(getTranscriptionProvider(env)).toBe(expected);
	});

	it("normalizes seconds, punctuation, confidence, speaker and language for both artifacts", async () => {
		const result = await transcribeAudio(Buffer.from("audio"), "auto");
		expect(result).toMatchObject({
			audio_duration: 2.5,
			language_code: "fr",
			speech_model_used: "nova-3",
			words: [
				{
					text: "Bonjour!",
					start: 123,
					end: 1568,
					confidence: 0.97,
					speaker: 1,
				},
			],
		});
		const edit = createEditTranscript(result, 2500);
		expect(editTranscriptWordsToCaptionVtt(edit.words)).toContain(
			"00:00:00.123 --> 00:00:01.568",
		);
		const [url, options] = mocks.fetch.mock.calls[0] ?? [];
		expect(new URL(url).searchParams.get("detect_language")).toBe("true");
		expect(new URL(url).searchParams.has("language")).toBe(false);
		expect(options).toMatchObject({
			method: "POST",
			headers: {
				Authorization: "Token deepgram-test",
				"Content-Type": "application/octet-stream",
			},
		});
		expect(Buffer.from(options.body).toString()).toBe("audio");
		expect(mocks.transcribe).not.toHaveBeenCalled();
	});

	it("passes an explicit language without detection", async () => {
		await transcribeAudio(Buffer.from("audio"), "de");
		const params = new URL(mocks.fetch.mock.calls[0]?.[0]).searchParams;
		expect(params.get("language")).toBe("de");
		expect(params.has("detect_language")).toBe(false);
	});

	it("classifies an empty transcript as no spoken audio", async () => {
		const data = response();
		data.results.channels = [
			{
				detected_language: "fr",
				alternatives: [{ transcript: "", words: [] }],
			},
		];
		mocks.fetch.mockResolvedValue(Response.json(data));
		await expect(transcribeAudio(Buffer.from("audio"), "auto")).rejects.toThrow(
			"no spoken audio",
		);
	});

	it("rejects speech without usable word timestamps", async () => {
		const data = response();
		data.results.channels = [
			{
				detected_language: "fr",
				alternatives: [{ transcript: "Bonjour!", words: [] }],
			},
		];
		mocks.fetch.mockResolvedValue(Response.json(data));
		await expect(transcribeAudio(Buffer.from("audio"), "auto")).rejects.toThrow(
			"missing word timestamps",
		);
	});

	it("rejects reversed word timestamps", async () => {
		const data = response();
		Object.assign(data.results.channels[0]?.alternatives[0]?.words[0] ?? {}, {
			start: 2,
			end: 1,
		});
		mocks.fetch.mockResolvedValue(Response.json(data));
		await expect(transcribeAudio(Buffer.from("audio"), "auto")).rejects.toThrow(
			"Invalid Deepgram transcription response",
		);
	});

	it("uses raw words and the requested language when optional fields are absent", async () => {
		mocks.fetch.mockResolvedValue(
			Response.json({
				metadata: { duration: 2 },
				results: {
					channels: [
						{
							alternatives: [
								{
									transcript: "Hallo",
									words: [{ word: "Hallo", start: 0, end: 1 }],
								},
							],
						},
					],
				},
			}),
		);
		await expect(
			transcribeAudio(Buffer.from("audio"), "de"),
		).resolves.toMatchObject({
			language_code: "de",
			words: [{ text: "Hallo", start: 0, end: 1000 }],
		});
	});

	it.each([401, 403, 429, 500])("sanitizes HTTP %i errors", async (status) => {
		mocks.fetch.mockResolvedValue(
			new Response("credential and signed-url", {
				status,
				statusText: "sensitive detail",
			}),
		);
		await expect(transcribeAudio(Buffer.from("audio"), "auto")).rejects.toThrow(
			`Deepgram transcription failed (HTTP ${status})`,
		);
		expect(mocks.transcribe).not.toHaveBeenCalled();
	});

	it("sanitizes transport errors", async () => {
		mocks.fetch.mockRejectedValue(new Error("credential and signed-url"));
		await expect(transcribeAudio(Buffer.from("audio"), "auto")).rejects.toThrow(
			"Deepgram transcription request failed or timed out",
		);
	});

	it.each([
		{},
		{ results: { channels: [] } },
		{ metadata: { duration: -1 }, results: {} },
	])("rejects malformed responses %j", async (data) => {
		mocks.fetch.mockResolvedValue(Response.json(data));
		await expect(transcribeAudio(Buffer.from("audio"), "auto")).rejects.toThrow(
			"Invalid Deepgram transcription response",
		);
	});

	it("rejects invalid JSON without leaking its contents", async () => {
		mocks.fetch.mockResolvedValue(new Response("sensitive detail"));
		await expect(transcribeAudio(Buffer.from("audio"), "auto")).rejects.toThrow(
			"Invalid Deepgram transcription response",
		);
	});

	it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "0.2"])(
		"rejects invalid word timestamps %s",
		async (start) => {
			const data = response();
			Object.assign(data.results.channels[0]?.alternatives[0]?.words[0] ?? {}, {
				start,
			});
			mocks.fetch.mockResolvedValue(Response.json(data));
			await expect(
				transcribeAudio(Buffer.from("audio"), "auto"),
			).rejects.toThrow("Invalid Deepgram transcription response");
		},
	);

	it("prefers AssemblyAI and never switches on a runtime failure", async () => {
		mocks.env.ASSEMBLY_API_KEY = "assembly-test";
		mocks.transcribe.mockRejectedValue(new Error("provider unavailable"));
		await expect(transcribeAudio(Buffer.from("audio"), "auto")).rejects.toThrow(
			"provider unavailable",
		);
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("rejects a missing provider before a paid request", async () => {
		mocks.env.DEEPGRAM_API_KEY = undefined;
		await expect(transcribeAudio(Buffer.from("audio"), "auto")).rejects.toThrow(
			"Missing ASSEMBLY_API_KEY or DEEPGRAM_API_KEY",
		);
		expect(mocks.fetch).not.toHaveBeenCalled();
	});
});
