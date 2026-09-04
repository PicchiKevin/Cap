import { useCallback, useEffect, useState } from "react";
import type { CommentType } from "../../../Share";

export {
	DONE_MESSAGE,
	isLegacyResolution,
	isResolution,
	isResolutionEvent,
	latestResolution,
} from "./resolution";

const storageKey = (videoId: string) => `cap-reopened-threads-${videoId}`;

const readReopenedMap = (videoId: string): Record<string, string> => {
	if (typeof window === "undefined") return {};
	try {
		const parsed = JSON.parse(
			window.localStorage.getItem(storageKey(videoId)) ?? "{}",
		);
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
};

export const useReopenedThreads = (videoId: string) => {
	const [reopenedAfter, setReopenedAfter] = useState<Record<string, string>>(
		{},
	);
	useEffect(() => setReopenedAfter(readReopenedMap(videoId)), [videoId]);
	const persist = useCallback(
		(next: Record<string, string>) => {
			setReopenedAfter(next);
			try {
				window.localStorage.setItem(storageKey(videoId), JSON.stringify(next));
			} catch {}
		},
		[videoId],
	);
	const reopen = useCallback(
		(threadId: string, boundaryId: string) => {
			persist({ ...reopenedAfter, [threadId]: boundaryId });
		},
		[persist, reopenedAfter],
	);
	const clearReopen = useCallback(
		(threadId: string) => {
			if (!(threadId in reopenedAfter)) return;
			const next = { ...reopenedAfter };
			delete next[threadId];
			persist(next);
		},
		[persist, reopenedAfter],
	);
	const isThreadDone = useCallback(
		(threadId: string, resolution: CommentType | null) => {
			if (!resolution) return false;
			const boundary = reopenedAfter[threadId];
			if (!boundary) return true;
			if (boundary === resolution.id) return false;
			const legacyBoundary = new Date(boundary);
			return (
				Number.isNaN(legacyBoundary.getTime()) ||
				legacyBoundary < new Date(resolution.createdAt)
			);
		},
		[reopenedAfter],
	);
	return { isThreadDone, reopen, clearReopen };
};
