import { describe, expect, it } from "vitest";
import {
	SLACK_BOT_SCOPES,
	SLACK_NOTIFICATION_SCOPES,
	SLACK_UNFURL_SCOPES,
} from "@/lib/slack/client";
import {
	hasSlackNotificationScopes,
	hasSlackUnfurlScopes,
} from "@/lib/slack/installations";

describe("Slack installation scopes", () => {
	it("keeps unfurls available while notification scopes require reauthorization", () => {
		expect(hasSlackUnfurlScopes(SLACK_UNFURL_SCOPES)).toBe(true);
		expect(hasSlackNotificationScopes(SLACK_UNFURL_SCOPES)).toBe(false);
		expect(hasSlackNotificationScopes(SLACK_NOTIFICATION_SCOPES)).toBe(true);
		expect(hasSlackUnfurlScopes(SLACK_BOT_SCOPES)).toBe(true);
	});
});
