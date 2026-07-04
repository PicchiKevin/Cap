import { useCallback, useEffect, useState } from "react";
import type { CommentType } from "../../../Share";

export const DONE_MESSAGE = "This is done";

export const isDoneMessage = (comment: CommentType) =>
	comment.type === "text" &&
	comment.content.trim().toLowerCase() === DONE_MESSAGE.toLowerCase();

export const latestDoneAt = (replies: CommentType[]): Date | null => {
	let latest: Date | null = null;
	for (const reply of replies) {
		if (!isDoneMessage(reply)) continue;
		const createdAt = new Date(reply.createdAt);
		if (!latest || createdAt > latest) latest = createdAt;
	}
	return latest;
};

const storageKey = (videoId: string) => `cap-reopened-threads-${videoId}`;

const readReopenedMap = (videoId: string): Record<string, string> => {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(storageKey(videoId));
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
};

/**
 * Reopen state is intentionally local-only: a thread is "done" when it
 * contains a "This is done" reply, and reopening just records a local
 * timestamp so done-messages older than the reopen are ignored. A newer
 * done-message from any client marks the thread done again.
 */
export const useReopenedThreads = (videoId: string) => {
	const [reopenedAt, setReopenedAt] = useState<Record<string, string>>({});

	useEffect(() => {
		setReopenedAt(readReopenedMap(videoId));
	}, [videoId]);

	const persist = useCallback(
		(next: Record<string, string>) => {
			setReopenedAt(next);
			try {
				window.localStorage.setItem(storageKey(videoId), JSON.stringify(next));
			} catch {
				// localStorage unavailable — state stays in memory for this session
			}
		},
		[videoId],
	);

	const reopen = useCallback(
		(threadId: string) => {
			persist({ ...reopenedAt, [threadId]: new Date().toISOString() });
		},
		[persist, reopenedAt],
	);

	const clearReopen = useCallback(
		(threadId: string) => {
			if (!(threadId in reopenedAt)) return;
			const next = { ...reopenedAt };
			delete next[threadId];
			persist(next);
		},
		[persist, reopenedAt],
	);

	const isThreadDone = useCallback(
		(threadId: string, doneAt: Date | null) => {
			if (!doneAt) return false;
			const reopened = reopenedAt[threadId];
			if (!reopened) return true;
			return doneAt > new Date(reopened);
		},
		[reopenedAt],
	);

	return { isThreadDone, reopen, clearReopen };
};
