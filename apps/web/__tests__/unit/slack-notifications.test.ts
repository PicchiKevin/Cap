import { Comment } from "@cap/web-domain";
import { describe, expect, it, vi } from "vitest";
import { reconcileSlackCommentNotificationAdmissions } from "@/lib/slack-notifications";

describe("Slack notification admission", () => {
	it("reconciles later outbox entries after an admission failure", async () => {
		const first = Comment.CommentId.make("first");
		const second = Comment.CommentId.make("second");
		const admit = vi.fn(async (commentId: Comment.CommentId) => {
			if (commentId === first) throw new Error("workflow unavailable");
			return true;
		});

		await expect(
			reconcileSlackCommentNotificationAdmissions({
				commentIds: [first, second],
				admit,
			}),
		).resolves.toBe(1);
		expect(admit).toHaveBeenCalledWith(first);
		expect(admit).toHaveBeenCalledWith(second);
	});
});
