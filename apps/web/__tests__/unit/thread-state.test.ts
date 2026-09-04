import { describe, expect, it } from "vitest";
import {
	isResolution,
	isResolutionEvent,
	latestResolution,
} from "../../app/s/[videoId]/_components/tabs/Activity/threadState";
import type { CommentType } from "../../app/s/[videoId]/Share";

const comment = (overrides: Partial<CommentType>): CommentType =>
	({
		id: "comment" as CommentType["id"],
		authorId: "user" as CommentType["authorId"],
		content: "Reply",
		videoId: "video" as CommentType["videoId"],
		type: "text",
		timestamp: null,
		parentCommentId: "root" as CommentType["parentCommentId"],
		mediaKey: null,
		mediaDuration: null,
		mediaMeta: null,
		event: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	}) as CommentType;

describe("resolution events", () => {
	it("uses explicit resolution metadata for new events", () => {
		const resolution = comment({
			id: "resolution" as CommentType["id"],
			type: "event",
			event: { type: "resolution" },
		});
		expect(isResolutionEvent(resolution)).toBe(true);
		expect(isResolution(resolution)).toBe(true);
	});

	it("recognizes only pre-cutover reply markers", () => {
		const historical = comment({
			content: " This is done ",
			createdAt: new Date("2026-09-04T10:23:59.000Z"),
		});
		expect(isResolution(historical)).toBe(true);
		expect(isResolution(comment({ content: "This is done" }))).toBe(false);
		expect(
			isResolution(
				comment({
					content: "This is done",
					parentCommentId: "" as CommentType["parentCommentId"],
					createdAt: new Date("2026-09-04T10:00:00.000Z"),
				}),
			),
		).toBe(false);
	});

	it("uses the latest observed resolution ID rather than browser time", () => {
		const first = comment({ id: "first" as CommentType["id"] });
		const latest = comment({
			id: "latest" as CommentType["id"],
			type: "event",
			event: { type: "resolution" },
		});
		expect(latestResolution([first, latest])?.id).toBe(latest.id);
	});
});
