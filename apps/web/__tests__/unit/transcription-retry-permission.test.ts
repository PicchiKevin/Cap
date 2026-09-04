import { describe, expect, it } from "vitest";
import { canRetryTranscription } from "@/lib/transcription-retry-permission";

describe("canRetryTranscription", () => {
	it("allows the video owner and organization settings managers", () => {
		expect(
			canRetryTranscription({
				viewerId: "owner-1",
				ownerId: "owner-1",
				canManageOrganizationSettings: false,
			}),
		).toBe(true);
		expect(
			canRetryTranscription({
				viewerId: "admin-1",
				ownerId: "owner-1",
				canManageOrganizationSettings: true,
			}),
		).toBe(true);
	});

	it("does not grant retry to other viewers", () => {
		expect(
			canRetryTranscription({
				viewerId: "member-1",
				ownerId: "owner-1",
				canManageOrganizationSettings: false,
			}),
		).toBe(false);
	});
});
