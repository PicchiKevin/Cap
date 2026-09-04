import { describe, expect, it } from "vitest";
import {
	collectSlackThreadParticipantIds,
	deliverSlackCommentNotifications,
	resolveSlackThreadRoot,
} from "@/lib/slack/comment-notifications";

describe("Slack comment notifications", () => {
	it("normalizes nested replies to the root thread and includes every participant", () => {
		const comments = [
			{ id: "root", parentCommentId: null, authorId: "owner" },
			{ id: "reply", parentCommentId: "root", authorId: "reviewer" },
			{ id: "nested", parentCommentId: "reply", authorId: "teammate" },
		];
		const rootId = resolveSlackThreadRoot(
			"nested",
			new Map(comments.map((comment) => [comment.id, comment])),
		);

		expect(rootId).toBe("root");
		expect(
			collectSlackThreadParticipantIds({
				threadRootId: rootId ?? "",
				threadComments: comments,
			}),
		).toEqual(new Set(["owner", "reviewer", "teammate"]));
	});

	it("continues fan-out after an individual delivery fails", async () => {
		const delivered: string[] = [];
		const failures = await deliverSlackCommentNotifications({
			deliveries: [
				{
					teamId: "T1",
					email: "first@example.com",
					text: "First",
					blocks: [],
					clientMessageId: "11111111-1111-4111-8111-111111111111",
				},
				{
					teamId: "T2",
					email: "second@example.com",
					text: "Second",
					blocks: [],
					clientMessageId: "22222222-2222-4222-8222-222222222222",
				},
			],
			deliver: async (delivery) => {
				if (delivery.email === "first@example.com")
					throw new Error("missing_scope");
				delivered.push(delivery.email);
			},
		});

		expect(failures).toHaveLength(1);
		expect(delivered).toEqual(["second@example.com"]);
	});
});
