import type { CommentType } from "../../../Share";

export const DONE_MESSAGE = "This is done";
export const LEGACY_RESOLUTION_CUTOVER = new Date("2026-09-04T10:24:00.000Z");

export const isResolutionEvent = (comment: CommentType) =>
	comment.type === "event" && comment.event?.type === "resolution";

export const isLegacyResolution = (comment: CommentType) =>
	comment.type === "text" &&
	Boolean(comment.parentCommentId) &&
	new Date(comment.createdAt) < LEGACY_RESOLUTION_CUTOVER &&
	comment.content.trim().toLowerCase() === DONE_MESSAGE.toLowerCase();

export const isResolution = (comment: CommentType) =>
	isResolutionEvent(comment) || isLegacyResolution(comment);

export const latestResolution = (replies: CommentType[]) => {
	for (let index = replies.length - 1; index >= 0; index -= 1) {
		const reply = replies[index];
		if (reply && isResolution(reply)) return reply;
	}
	return null;
};
