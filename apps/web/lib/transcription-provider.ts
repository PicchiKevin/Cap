import { serverEnv } from "@cap/env";
import type { AiGenerationLanguage } from "@cap/web-domain";
import { AssemblyAI } from "assemblyai";
import { FatalError } from "workflow";
import { z } from "zod";
import { getAssemblyAITranscriptionOptions } from "@/lib/assemblyai";
import type { AssemblyAIEditResult } from "@/lib/edit-transcript";
import { getTranscriptionProvider } from "@/lib/transcription-config";

export type TranscriptionResult = AssemblyAIEditResult & {
	audio_duration?: number | null;
};

const timestamp = z.number().finite().nonnegative();
const deepgramResponse = z.object({
	metadata: z.object({ duration: timestamp }),
	results: z.object({
		channels: z
			.array(
				z.object({
					detected_language: z.string().optional(),
					alternatives: z
						.array(
							z.object({
								transcript: z.string(),
								words: z.array(
									z
										.object({
											word: z.string().min(1),
											punctuated_word: z.string().min(1).optional(),
											start: timestamp,
											end: timestamp,
											confidence: z.number().finite().min(0).max(1).optional(),
											speaker: z.number().int().nonnegative().optional(),
										})
										.refine((word) => word.end >= word.start),
								),
							}),
						)
						.min(1),
				}),
			)
			.length(1),
	}),
});

async function transcribeWithDeepgram(
	audio: Buffer,
	apiKey: string,
	language: AiGenerationLanguage,
): Promise<TranscriptionResult> {
	const params = new URLSearchParams({
		model: "nova-3",
		smart_format: "true",
		punctuate: "true",
		filler_words: "true",
	});
	if (language === "auto") params.set("detect_language", "true");
	else params.set("language", language);

	let response: Response;
	try {
		response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
			method: "POST",
			headers: {
				Authorization: `Token ${apiKey}`,
				"Content-Type": "application/octet-stream",
			},
			body: new Uint8Array(audio),
			signal: AbortSignal.timeout(300_000),
		});
	} catch {
		throw new Error("Deepgram transcription request failed or timed out");
	}
	if (!response.ok) {
		throw new Error(`Deepgram transcription failed (HTTP ${response.status})`);
	}
	let json: unknown;
	try {
		json = await response.json();
	} catch {
		throw new Error("Invalid Deepgram transcription response");
	}
	const parsed = deepgramResponse.safeParse(json);
	if (!parsed.success)
		throw new Error("Invalid Deepgram transcription response");
	const channel = parsed.data.results.channels[0];
	const alternative = channel?.alternatives[0];
	if (!alternative) throw new Error("Invalid Deepgram transcription response");
	if (alternative.words.length === 0) {
		if (alternative.transcript.trim()) {
			throw new Error(
				"Deepgram transcription response is missing word timestamps",
			);
		}
		throw new FatalError("Deepgram transcription failed: no spoken audio");
	}
	return {
		audio_duration: parsed.data.metadata.duration,
		language_code:
			channel?.detected_language ??
			(language === "auto" ? undefined : language),
		speech_model_used: "nova-3",
		words: alternative.words.map((word) => ({
			text: word.punctuated_word ?? word.word,
			start: Math.round(word.start * 1000),
			end: Math.round(word.end * 1000),
			confidence: word.confidence,
			speaker: word.speaker,
		})),
	};
}

export async function transcribeAudio(
	audio: Buffer,
	language: AiGenerationLanguage,
): Promise<TranscriptionResult> {
	const env = serverEnv();
	const provider = getTranscriptionProvider(env);
	if (provider === "deepgram" && env.DEEPGRAM_API_KEY) {
		return transcribeWithDeepgram(audio, env.DEEPGRAM_API_KEY, language);
	}
	if (provider !== "assemblyai" || !env.ASSEMBLY_API_KEY) {
		throw new FatalError("Missing ASSEMBLY_API_KEY or DEEPGRAM_API_KEY");
	}
	const client = new AssemblyAI({ apiKey: env.ASSEMBLY_API_KEY });
	const transcript = await client.transcripts.transcribe({
		audio,
		...getAssemblyAITranscriptionOptions(language),
	});
	if (transcript.status === "error") {
		const message = `AssemblyAI transcription failed (id=${transcript.id}, language=${language}): ${transcript.error ?? "Unknown error"}`;
		if (transcript.error?.toLowerCase().includes("no spoken audio")) {
			throw new FatalError(message);
		}
		throw new Error(message);
	}
	return transcript;
}
