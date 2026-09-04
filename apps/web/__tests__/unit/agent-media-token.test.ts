import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentVideoRequestAuthentication } from "@/lib/agent-video-api";

const env = { NEXTAUTH_SECRET: "test-agent-media-token-secret" };

const mocks = vi.hoisted(() => ({
	db: vi.fn(),
	getAccessForVideo: vi.fn(),
	runPromise: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@cap/database", () => ({ db: mocks.db }));

vi.mock("@cap/database/auth/session", () => ({
	getCurrentUser: vi.fn(),
}));

vi.mock("@cap/database/schema", () => ({
	agentApiKeys: {},
	authApiKeys: {},
	organizations: { id: "organizations.id", allowedEmailDomain: "email" },
	spaces: { id: "spaces.id", name: "spaces.name", password: "spaces.password" },
	spaceVideos: {
		spaceId: "spaceVideos.spaceId",
		videoId: "spaceVideos.videoId",
	},
	users: {},
	videos: {
		id: "videos.id",
		orgId: "videos.orgId",
		public: "videos.public",
		password: "videos.password",
		settings: "videos.settings",
	},
}));

vi.mock("@cap/web-domain", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cap/web-domain")>();
	return {
		...actual,
		Video: {
			...actual.Video,
			SegmentsSource: class {
				constructor(private readonly video: { ownerId: string; id: string }) {}

				getManifestKey() {
					return `${this.video.ownerId}/${this.video.id}/segments.json`;
				}
			},
		},
	};
});

vi.mock("@cap/web-backend", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cap/web-backend")>();
	return {
		...actual,
		Storage: { getAccessForVideo: mocks.getAccessForVideo },
	};
});

vi.mock("@/lib/agent-auth", () => ({ hasAgentReadScope: vi.fn() }));

vi.mock("@/lib/server", () => ({ runPromise: mocks.runPromise }));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => conditions),
	eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
	gt: vi.fn(),
	isNull: vi.fn(),
	lte: vi.fn(),
	or: vi.fn(),
}));

vi.mock("@cap/env", () => ({
	serverEnv: () => env,
}));

const encode = (value: unknown) =>
	Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const sign = (payload: string) =>
	createHmac("sha256", env.NEXTAUTH_SECRET).update(payload).digest("base64url");

const createToken = (payload: unknown) => {
	const encoded = encode(payload);
	return `${encoded}.${sign(encoded)}`;
};

const pipeValue = <T>(value: T) => ({
	pipe: (runner: (effect: T) => unknown) => runner(value),
});

const createDatabase = (...queryResults: unknown[][]) => {
	const select = vi.fn();
	for (const result of queryResults) {
		select.mockImplementationOnce(() => ({
			from: () => ({
				leftJoin: () => ({
					where: () => ({ limit: () => Promise.resolve(result) }),
				}),
				innerJoin: () => ({ where: () => Promise.resolve(result) }),
			}),
		}));
	}
	return { select };
};

type TestVideo = { id: string; ownerId: string; public: boolean };
type AgentMediaAuthentication = Exclude<
	AgentVideoRequestAuthentication,
	{ type: "invalid" }
>;
type AgentMediaAccess = {
	password: string | null;
	allowedEmailDomain: string | null;
	spaces: Array<{ password: string | null }>;
};

const createVideo = (publiclyAccessible: boolean): TestVideo => ({
	id: "video-1",
	ownerId: "owner-1",
	public: publiclyAccessible,
});

const authenticatedRequest: Extract<
	AgentMediaAuthentication,
	{ type: "authenticated" }
> = {
	type: "authenticated",
	user: {} as Extract<
		AgentMediaAuthentication,
		{ type: "authenticated" }
	>["user"],
};

const createBucket = () => ({
	getInternalSignedObjectUrl: vi.fn((key: string) =>
		pipeValue(`https://storage.example/${key}`),
	),
	getSignedObjectUrl: vi.fn((key: string) =>
		pipeValue(`https://storage.example/${key}`),
	),
});

const getAgentHlsUrl = async ({
	video,
	authentication = { type: "anonymous" } as const,
	access = { password: null, allowedEmailDomain: null, spaces: [] },
}: {
	video: TestVideo;
	authentication?: AgentMediaAuthentication;
	access?: AgentMediaAccess;
}) => {
	const bucket = createBucket();
	mocks.getAccessForVideo.mockReturnValue(pipeValue([bucket]));
	mocks.runPromise.mockImplementation((effect) => Promise.resolve(effect));
	mocks.db.mockReturnValue(
		createDatabase(
			[
				{
					public: video.public,
					password: access.password,
					allowedEmailDomain: access.allowedEmailDomain,
				},
			],
			access.spaces,
		),
	);
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

	const { getAgentVideoMedia } = await import("@/lib/agent-video-api");
	const media = await getAgentVideoMedia(
		video as never,
		"https://cap.example",
		authentication,
	);
	return new URL(media.hlsUrl).searchParams.get("agentMediaToken");
};

describe("Agent media tokens", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("authorizes only a current Agent media token", async () => {
		const { createAgentMediaToken, verifyAgentMediaToken } = await import(
			"@/lib/agent-media-token"
		);
		const token = createAgentMediaToken({ videoId: "video-1" }, 60);

		expect(verifyAgentMediaToken(token)).toMatchObject({
			kind: "agent-media",
			videoId: "video-1",
		});
	});

	it.each([
		["video", { disableTranscript: true }, {}, [], true],
		["organization", {}, { disableTranscript: true }, [], true],
		[
			"space",
			{},
			{},
			[
				{
					id: "space-1",
					name: "Design",
					settings: { disableTranscript: true },
				},
			],
			true,
		],
		["enabled", {}, {}, [], false],
	])(
		"resolves %s transcript settings from the limited query row",
		async (
			_source,
			videoSettings,
			organizationSettings,
			sharedSpaces,
			expected,
		) => {
			mocks.db.mockReturnValue(
				createDatabase([{ videoSettings, organizationSettings }], sharedSpaces),
			);
			const { isAgentTranscriptDisabled } = await import(
				"@/lib/agent-video-api"
			);

			expect(await isAgentTranscriptDisabled("video-1" as never)).toBe(
				expected,
			);
		},
	);

	const hlsAccessCases = [
		{
			description: "private",
			video: createVideo(false),
			authentication: authenticatedRequest,
			access: {},
			expectsToken: true,
		},
		{
			description: "unrestricted public",
			video: createVideo(true),
			authentication: { type: "anonymous" },
			access: {},
			expectsToken: false,
		},
		{
			description: "email-restricted public",
			video: createVideo(true),
			authentication: authenticatedRequest,
			access: { allowedEmailDomain: "cap.example" },
			expectsToken: true,
		},
		{
			description: "direct-password public",
			video: createVideo(true),
			authentication: { type: "anonymous" },
			access: { password: "password-hash" },
			expectsToken: true,
		},
		{
			description: "inherited-password public",
			video: createVideo(true),
			authentication: { type: "anonymous" },
			access: { spaces: [{ password: "space-password-hash" }] },
			expectsToken: true,
		},
	] satisfies ReadonlyArray<{
		description: string;
		video: TestVideo;
		authentication: AgentMediaAuthentication;
		access: Partial<AgentMediaAccess>;
		expectsToken: boolean;
	}>;

	it.each(hlsAccessCases)(
		"issues an HLS token for $description access",
		async ({ video, authentication, access, expectsToken }) => {
			const token = await getAgentHlsUrl({
				video,
				authentication,
				access: {
					password: null,
					allowedEmailDomain: null,
					spaces: [],
					...access,
				},
			});

			expect(Boolean(token)).toBe(expectsToken);
			if (token) {
				const { verifyAgentMediaToken } = await import(
					"@/lib/agent-media-token"
				);
				expect(verifyAgentMediaToken(token)?.videoId).toBe("video-1");
			}
		},
	);

	it("rejects expired, malformed, and cross-purpose tokens", async () => {
		const { verifyAgentMediaToken } = await import("@/lib/agent-media-token");

		expect(
			verifyAgentMediaToken(
				createToken({
					kind: "agent-media",
					videoId: "video-1",
					expiresAt: Date.now() - 1,
				}),
			),
		).toBeNull();
		expect(
			verifyAgentMediaToken(
				createToken({
					kind: "storage-object",
					videoId: "video-1",
					expiresAt: Date.now() + 60_000,
				}),
			),
		).toBeNull();
		expect(verifyAgentMediaToken("invalid")).toBeNull();
	});
});
