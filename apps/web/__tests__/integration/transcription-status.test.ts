import type { Video } from "@cap/web-domain";
import { Exit } from "effect";
import { beforeEach, expect, it, vi } from "vitest";
import { getVideoStatus } from "@/actions/videos/get-status";

const mocks = vi.hoisted(() => ({
	env: {} as { ASSEMBLY_API_KEY?: string; DEEPGRAM_API_KEY?: string },
	transcribe: vi.fn(),
	run: vi.fn(),
	uploads: [] as unknown[],
}));
vi.mock("@cap/env", () => ({ serverEnv: () => mocks.env }));
vi.mock("@cap/web-backend", () => ({
	VideosPolicy: {},
	provideOptionalAuth: (effect: unknown) => effect,
}));
vi.mock("@/lib/server", () => ({ runPromiseExit: mocks.run }));
vi.mock("@/lib/transcribe", () => ({ transcribeVideo: mocks.transcribe }));
vi.mock("@/lib/ai/provider", () => ({ isAiConfigured: () => false }));
vi.mock("@/lib/generate-ai", () => ({ startAiGeneration: vi.fn() }));
vi.mock("@/utils/flags", () => ({ isAiGenerationEnabled: vi.fn() }));
vi.mock("@/lib/desktop-segments-finalization", () => ({
	isRetryableDesktopSegmentsFinalizationError: () => false,
	queueDesktopSegmentsFinalization: vi.fn(),
}));
vi.mock("@cap/database/schema", () => ({
	videos: {},
	videoUploads: {},
	users: {},
}));
vi.mock("@cap/database", () => ({
	db: () => ({
		select: () => ({
			from: () => ({ where: () => ({ limit: async () => mocks.uploads }) }),
		}),
	}),
}));

beforeEach(() => {
	mocks.env = {};
	mocks.uploads = [];
	mocks.transcribe.mockResolvedValue({ success: true });
	mocks.run.mockResolvedValue(
		Exit.succeed([
			{
				id: "video-123",
				ownerId: "user-456",
				name: "Recording",
				metadata: {},
				transcriptionStatus: null,
			},
		]),
	);
});

it.each([
	{ ASSEMBLY_API_KEY: "assembly-test" },
	{ DEEPGRAM_API_KEY: "deepgram-test" },
	{ ASSEMBLY_API_KEY: "assembly-test", DEEPGRAM_API_KEY: "deepgram-test" },
])("starts missing transcription while polling with %j", async (env) => {
	mocks.env = env;
	await expect(
		getVideoStatus("video-123" as Video.VideoId),
	).resolves.toMatchObject({ transcriptionStatus: "PROCESSING" });
	expect(mocks.transcribe).toHaveBeenCalledWith("video-123", "user-456");
});

it("does not start transcription without either key", async () => {
	await expect(
		getVideoStatus("video-123" as Video.VideoId),
	).resolves.toMatchObject({ transcriptionStatus: null });
	expect(mocks.transcribe).not.toHaveBeenCalled();
});

it("waits for active uploads even with Deepgram configured", async () => {
	mocks.env = { DEEPGRAM_API_KEY: "deepgram-test" };
	mocks.uploads = [{ videoId: "video-123", phase: "uploading" }];
	await expect(
		getVideoStatus("video-123" as Video.VideoId),
	).resolves.toMatchObject({ transcriptionStatus: null });
	expect(mocks.transcribe).not.toHaveBeenCalled();
});
