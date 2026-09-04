import { describe, expect, it, vi } from "vitest";
import {
	buildSlackInstallUrl,
	exchangeSlackOAuthCode,
	lookupSlackUserByEmail,
	SLACK_BOT_SCOPES,
	type SlackUnfurlError,
	sendSlackDirectMessage,
	sendSlackMessage,
	sendSlackUnfurl,
} from "@/lib/slack/client";

const config = {
	clientId: "client-id",
	clientSecret: "client-secret",
	signingSecret: "signing-secret",
	redirectUrl: "https://cap.so/api/integrations/slack/callback",
};

const slackResponse = (scope = SLACK_BOT_SCOPES.join(",")) =>
	new Response(
		JSON.stringify({
			ok: true,
			access_token: "xoxb-token",
			scope,
			bot_user_id: "B123",
			team: {
				id: "T123",
				name: "Cap",
			},
			enterprise: null,
		}),
		{
			status: 200,
			headers: { "Content-Type": "application/json" },
		},
	);

describe("Slack API client", () => {
	it("builds an install URL with all required bot scopes", () => {
		const url = new URL(
			buildSlackInstallUrl({ config, state: "signed-state" }),
		);

		expect(url.origin).toBe("https://slack.com");
		expect(url.pathname).toBe("/oauth/v2/authorize");
		expect(url.searchParams.get("client_id")).toBe("client-id");
		expect(url.searchParams.get("scope")).toBe(SLACK_BOT_SCOPES.join(","));
		expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUrl);
		expect(url.searchParams.get("state")).toBe("signed-state");
	});

	it("accepts a complete OAuth response and preserves the workspace identity", async () => {
		const fetchImpl = vi.fn(async () => slackResponse());
		const result = await exchangeSlackOAuthCode({
			code: "oauth-code",
			config,
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		expect(result).toEqual({
			accessToken: "xoxb-token",
			scope: SLACK_BOT_SCOPES.join(","),
			botUserId: "B123",
			teamId: "T123",
			teamName: "Cap",
			enterpriseId: null,
		});
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("rejects OAuth responses that omit a required bot scope", async () => {
		const fetchImpl = vi.fn(async () =>
			slackResponse("links:read,links:write"),
		);

		await expect(
			exchangeSlackOAuthCode({
				code: "oauth-code",
				config,
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toThrow("missing required bot scopes");
	});

	it("looks up Slack users with the email as a query parameter", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: true, user: { id: "U123" } }), {
					headers: { "Content-Type": "application/json" },
				}),
		);

		const result = await lookupSlackUserByEmail({
			token: "xoxb-token",
			email: "person+test@example.com",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		expect(result).toMatchObject({ ok: true, user: { id: "U123" } });
		const [url, request] = fetchImpl.mock.calls[0] as unknown as [
			URL,
			RequestInit,
		];
		expect(url.pathname).toBe("/api/users.lookupByEmail");
		expect(url.searchParams.get("email")).toBe("person+test@example.com");
		expect(request.headers).toEqual({ Authorization: "Bearer xoxb-token" });
		expect(request.body).toBeUndefined();
	});

	it("looks up, opens, and posts to a direct-message channel", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true, user: { id: "U123" } }), {
					headers: { "Content-Type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true, channel: { id: "D123" } }), {
					headers: { "Content-Type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true }), {
					headers: { "Content-Type": "application/json" },
				}),
			);

		await expect(
			sendSlackDirectMessage({
				teamId: "T-direct-message-test",
				token: "xoxb-token",
				email: "person@example.com",
				text: "A comment needs your attention",
				blocks: [{ type: "section" }],
				clientMessageId: "11111111-1111-4111-8111-111111111111",
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).resolves.toBe(true);

		expect(fetchImpl).toHaveBeenCalledTimes(3);
		const [lookupUrl] = fetchImpl.mock.calls[0] as [URL];
		expect(lookupUrl.pathname).toBe("/api/users.lookupByEmail");
		const openRequest = fetchImpl.mock.calls[1]?.[1] as RequestInit;
		expect(JSON.parse(String(openRequest.body))).toEqual({ users: "U123" });
		const postRequest = fetchImpl.mock.calls[2]?.[1] as RequestInit;
		expect(JSON.parse(String(postRequest.body))).toMatchObject({
			channel: "D123",
			client_msg_id: "11111111-1111-4111-8111-111111111111",
		});

		fetchImpl
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true, user: { id: "U123" } }), {
					headers: { "Content-Type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true }), {
					headers: { "Content-Type": "application/json" },
				}),
			);
		await sendSlackDirectMessage({
			teamId: "T-direct-message-test",
			token: "xoxb-token",
			email: "person@example.com",
			text: "Another comment needs your attention",
			blocks: [],
			clientMessageId: "22222222-2222-4222-8222-222222222222",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(5);
		expect(fetchImpl.mock.calls[4]?.[0]).toBe(
			"https://slack.com/api/chat.postMessage",
		);
	});

	it("classifies Slack rate limits as retryable and preserves Retry-After", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
					status: 429,
					headers: {
						"Content-Type": "application/json",
						"Retry-After": "3",
					},
				}),
		);

		await expect(
			sendSlackMessage({
				token: "xoxb-token",
				channel: "D123",
				text: "A comment needs your attention",
				blocks: [],
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({ retryable: true, retryAfterMs: 3000 });
	});

	it("classifies lookup service failures as retryable", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: false, error: "internal_error" }), {
					status: 503,
					headers: { "Content-Type": "application/json" },
				}),
		);

		await expect(
			sendSlackDirectMessage({
				teamId: "T-lookup-service-error-test",
				token: "xoxb-token",
				email: "person@example.com",
				text: "A comment needs your attention",
				blocks: [],
				clientMessageId: "33333333-3333-4333-8333-333333333333",
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({ retryable: true });
	});

	it("skips recipients that Slack cannot find", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: false, error: "users_not_found" }), {
					headers: { "Content-Type": "application/json" },
				}),
		);

		await expect(
			sendSlackDirectMessage({
				teamId: "T-lookup-missing-user-test",
				token: "xoxb-token",
				email: "person@example.com",
				text: "A comment needs your attention",
				blocks: [],
				clientMessageId: "44444444-4444-4444-8444-444444444444",
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).resolves.toBe(false);
	});

	it("retries transient unfurl failures with the stable event locator", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
					status: 429,
					headers: {
						"Content-Type": "application/json",
						"Retry-After": "1",
					},
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		const sleepImpl = vi.fn(async () => undefined);

		await sendSlackUnfurl({
			token: "xoxb-token",
			event: {
				channel: "C123",
				messageTs: "123.456",
				unfurlId: "U123",
				source: "conversations_history",
			},
			unfurls: {
				"https://cap.so/s/abc123": {
					blocks: [{ type: "video" }],
				},
			},
			fetchImpl: fetchImpl as unknown as typeof fetch,
			sleepImpl,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(sleepImpl).toHaveBeenCalledWith(1000);
		const request = fetchImpl.mock.calls[1]?.[1] as RequestInit;
		expect(JSON.parse(String(request.body))).toMatchObject({
			unfurl_id: "U123",
			source: "conversations_history",
		});
	});

	it("marks exhausted transient failures for durable recovery", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: false, error: "server_error" }), {
					status: 503,
					headers: { "Content-Type": "application/json" },
				}),
		);

		await expect(
			sendSlackUnfurl({
				token: "xoxb-token",
				event: {
					channel: "C123",
					messageTs: "123.456",
				},
				unfurls: {
					"https://cap.so/s/abc123": {
						blocks: [{ type: "video" }],
					},
				},
				fetchImpl: fetchImpl as unknown as typeof fetch,
				sleepImpl: vi.fn(async () => undefined),
			}),
		).rejects.toMatchObject({
			name: "SlackUnfurlError",
			retryable: true,
		} satisfies Partial<SlackUnfurlError>);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it("marks permanent Slack failures as non-retryable", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		);

		await expect(
			sendSlackUnfurl({
				token: "xoxb-token",
				event: {
					channel: "C123",
					messageTs: "123.456",
				},
				unfurls: {
					"https://cap.so/s/abc123": {
						blocks: [{ type: "video" }],
					},
				},
				fetchImpl: fetchImpl as unknown as typeof fetch,
				sleepImpl: vi.fn(async () => undefined),
			}),
		).rejects.toMatchObject({
			name: "SlackUnfurlError",
			retryable: false,
		} satisfies Partial<SlackUnfurlError>);
		expect(fetchImpl).toHaveBeenCalledOnce();
	});
});
