import { serverEnv } from "@cap/env";

type TranscriptionEnvironment = {
	ASSEMBLY_API_KEY?: string;
	DEEPGRAM_API_KEY?: string;
};

export function getTranscriptionProvider(
	env: TranscriptionEnvironment = serverEnv(),
) {
	if (env.ASSEMBLY_API_KEY) return "assemblyai";
	if (env.DEEPGRAM_API_KEY) return "deepgram";
	return null;
}
