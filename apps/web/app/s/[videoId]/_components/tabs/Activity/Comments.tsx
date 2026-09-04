import type { Comment, User, Video } from "@cap/web-domain";
import {
	faChevronDown,
	faChevronRight,
	faCircleCheck,
	faCommentSlash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useSearchParams } from "next/navigation";
import type React from "react";
import {
	type ComponentProps,
	forwardRef,
	type PropsWithChildren,
	startTransition,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { deleteComment } from "@/actions/videos/delete-comment";
import { newComment } from "@/actions/videos/new-comment";
import { useCurrentUser } from "@/app/Layout/AuthContext";
import type { CommentType } from "../../../Share";
import { ActivityComposer } from "./ActivityComposer";
import CommentThread from "./Comment";
import type CommentInput from "./CommentInput";
import EmptyState from "./EmptyState";
import {
	DONE_MESSAGE,
	latestResolution,
	useReopenedThreads,
} from "./threadState";

type Thread = {
	root: CommentType;
	replies: CommentType[];
	resolution: CommentType | null;
	isDone: boolean;
};

export const Comments = Object.assign(
	forwardRef<
		{ scrollToBottom: () => void },
		{
			setComments: React.Dispatch<React.SetStateAction<CommentType[]>>;
			videoId: Video.VideoId;
			optimisticComments: CommentType[];
			setOptimisticComments: (newComment: CommentType) => void;
			handleCommentSuccess: (comment: CommentType) => void;
			onSeek?: (time: number) => void;
			setShowAuthOverlay: (v: boolean) => void;
			commentsDisabled: boolean;
			ownerName?: string | null;
			canRecordMedia?: boolean;
		}
	>((props, ref) => {
		const {
			optimisticComments,
			setOptimisticComments,
			setComments,
			handleCommentSuccess,
			onSeek,
			commentsDisabled,
		} = props;
		const commentParams = useSearchParams().get("comment");
		const replyParams = useSearchParams().get("reply");
		const user = useCurrentUser();
		const [replyingTo, setReplyingTo] = useState<Comment.CommentId | null>(
			null,
		);
		const [showResolved, setShowResolved] = useState(false);
		const { isThreadDone, reopen, clearReopen } = useReopenedThreads(
			props.videoId,
		);
		const commentsContainerRef = useRef<HTMLDivElement>(null);

		useEffect(() => {
			if (commentParams || replyParams) return;
			if (commentsContainerRef.current) {
				commentsContainerRef.current.scrollTop =
					commentsContainerRef.current.scrollHeight;
			}
		}, [commentParams, replyParams]);

		const scrollToBottom = useCallback(() => {
			commentsContainerRef.current?.scrollTo({
				top: commentsContainerRef.current.scrollHeight,
				behavior: "smooth",
			});
		}, []);

		useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom]);

		const { openThreads, resolvedThreads } = useMemo(() => {
			const roots = optimisticComments.filter(
				(comment) => !comment.parentCommentId || comment.parentCommentId === "",
			);
			const threads: Thread[] = roots.map((root) => {
				const replies = optimisticComments.filter((reply) => {
					if (!reply.parentCommentId || reply.parentCommentId === "")
						return false;
					if (reply.parentCommentId === root.id) return true;
					const parent = optimisticComments.find(
						(comment) => comment.id === reply.parentCommentId,
					);
					return parent?.parentCommentId === root.id;
				});
				const resolution = latestResolution(replies);
				return {
					root,
					replies,
					resolution,
					isDone: isThreadDone(root.id, resolution),
				};
			});
			return {
				openThreads: threads.filter((thread) => !thread.isDone),
				resolvedThreads: threads.filter((thread) => thread.isDone),
			};
		}, [optimisticComments, isThreadDone]);

		const deepLinkId = commentParams ?? replyParams;
		const deepLinkTargetsResolved = Boolean(
			deepLinkId &&
				resolvedThreads.some(
					(thread) =>
						thread.root.id === deepLinkId ||
						thread.replies.some((reply) => reply.id === deepLinkId),
				),
		);
		useEffect(() => {
			if (deepLinkTargetsResolved) setShowResolved(true);
		}, [deepLinkTargetsResolved]);
		useEffect(() => {
			if (!deepLinkId) return;
			const timer = window.setTimeout(() => {
				const target = document.getElementById(`comment-${deepLinkId}`);
				target?.scrollIntoView({ behavior: "smooth", block: "center" });
				(target as HTMLElement | null)?.focus({ preventScroll: true });
			}, 0);
			return () => window.clearTimeout(timer);
		}, [deepLinkId]);

		const currentVideoTime = () => {
			const videoElement = document.querySelector("video") as HTMLVideoElement;
			return videoElement?.currentTime || 0;
		};

		const postComment = async (
			content: string,
			parentCommentId: Comment.CommentId,
			timestamp: number | null,
			event: Comment.Event | null = null,
		) => {
			if (!user) return;
			const clientKey = `temp-${Date.now()}`;
			const optimisticComment: CommentType = {
				id: clientKey as Comment.CommentId,
				clientKey,
				authorId: user.id as User.UserId,
				authorName: user.name,
				authorImage: user.imageUrl,
				content,
				createdAt: new Date(),
				videoId: props.videoId,
				parentCommentId,
				type: event ? "event" : "text",
				timestamp,
				updatedAt: new Date(),
				mediaKey: null,
				mediaDuration: null,
				mediaMeta: null,
				event,
				sending: true,
			};

			startTransition(() => {
				setOptimisticComments(optimisticComment);
			});

			const data = await newComment({
				content,
				videoId: props.videoId,
				authorImage: user.imageUrl,
				parentCommentId,
				type: event ? "event" : "text",
				timestamp,
				event,
			});
			handleCommentSuccess({ ...data, clientKey });
			return data;
		};

		const handleNewComment = async (content: string) => {
			try {
				await postComment(content, "" as Comment.CommentId, currentVideoTime());
			} catch (error) {
				console.error("Error posting comment:", error);
			}
		};

		const handleReply = async (content: string) => {
			if (!replyingTo) return;
			try {
				const data = await postComment(content, replyingTo, currentVideoTime());
				if (data) {
					document
						.getElementById(`comment-${data.id}`)
						?.scrollIntoView({ behavior: "smooth", block: "center" });
				}
				setReplyingTo(null);
			} catch (error) {
				console.error("Error posting reply:", error);
			}
		};

		const handleResolve = async (threadId: Comment.CommentId) => {
			if (!user) {
				props.setShowAuthOverlay(true);
				return;
			}
			try {
				await postComment(DONE_MESSAGE, threadId, null, { type: "resolution" });
				clearReopen(threadId);
			} catch (error) {
				console.error("Error resolving thread:", error);
			}
		};

		const handleDeleteComment = async (
			commentId: Comment.CommentId,
			parentId: Comment.CommentId | null,
		) => {
			try {
				await deleteComment({
					commentId,
					parentId,
					videoId: props.videoId,
				});
				setComments((comments) =>
					comments.filter((comment) => comment.id !== commentId),
				);
			} catch (error) {
				console.error("Failed to delete comment:", error);
			}
		};

		const onReply = (commentId: Comment.CommentId) => {
			if (!user) {
				props.setShowAuthOverlay(true);
				return;
			}
			setReplyingTo(commentId);
		};

		const renderThread = (thread: Thread) => (
			<CommentThread
				key={thread.root.clientKey ?? thread.root.id}
				comment={thread.root}
				replies={thread.replies}
				isDone={thread.isDone}
				onReply={onReply}
				replyingToId={replyingTo}
				handleReply={handleReply}
				onCancelReply={() => setReplyingTo(null)}
				onDelete={handleDeleteComment}
				onResolve={handleResolve}
				onReopen={() => {
					if (thread.resolution) reopen(thread.root.id, thread.resolution.id);
				}}
				onSeek={onSeek}
				forceShowReplies={Boolean(
					deepLinkId && thread.replies.some((reply) => reply.id === deepLinkId),
				)}
			/>
		);

		const hasThreads = openThreads.length > 0 || resolvedThreads.length > 0;

		return (
			<Comments.Shell
				commentInputProps={{
					onSubmit: handleNewComment,
					disabled: commentsDisabled,
				}}
				setShowAuthOverlay={props.setShowAuthOverlay}
				commentsContainerRef={commentsContainerRef}
				videoId={props.videoId}
				ownerName={props.ownerName}
				canRecordMedia={props.canRecordMedia}
				onOptimisticComment={(comment) => {
					startTransition(() => {
						setOptimisticComments(comment);
					});
				}}
				onCommentSuccess={handleCommentSuccess}
			>
				{commentsDisabled ? (
					<div className="h-full space-y-6 p-4">
						<EmptyState
							icon={<FontAwesomeIcon icon={faCommentSlash} />}
							commentsDisabled={commentsDisabled}
						/>
					</div>
				) : !hasThreads ? (
					<EmptyState />
				) : (
					<div className="space-y-2.5 p-3">
						{openThreads.map(renderThread)}
						{openThreads.length === 0 && resolvedThreads.length > 0 && (
							<div className="flex flex-col items-center py-6 text-center">
								<FontAwesomeIcon
									icon={faCircleCheck}
									className="mb-2 size-6 text-green-500"
								/>
								<p className="text-sm font-medium text-gray-12">
									All threads resolved
								</p>
								<p className="text-xs text-gray-9">Nothing left to do here.</p>
							</div>
						)}
						{resolvedThreads.length > 0 && (
							<div className="space-y-2.5">
								<button
									type="button"
									onClick={() => setShowResolved((visible) => !visible)}
									className="flex w-full items-center gap-2 text-xs font-medium text-gray-9 transition-colors hover:text-gray-12"
								>
									<div className="h-px flex-1 bg-gray-4" />
									<span className="flex items-center gap-1.5">
										<FontAwesomeIcon
											className="size-[9px]"
											icon={showResolved ? faChevronDown : faChevronRight}
										/>
										{resolvedThreads.length} resolved{" "}
										{resolvedThreads.length === 1 ? "thread" : "threads"}
									</span>
									<div className="h-px flex-1 bg-gray-4" />
								</button>
								{showResolved && (
									<div className="space-y-2.5">
										{resolvedThreads.map(renderThread)}
									</div>
								)}
							</div>
						)}
					</div>
				)}
			</Comments.Shell>
		);
	}),
	{
		Shell: (
			props: PropsWithChildren<{
				setShowAuthOverlay: (v: boolean) => void;
				commentInputProps?: Omit<
					ComponentProps<typeof CommentInput>,
					"user" | "placholder" | "buttonLabel"
				>;
				commentsContainerRef?: React.RefObject<HTMLDivElement | null>;
				videoId?: Video.VideoId;
				ownerName?: string | null;
				canRecordMedia?: boolean;
				onOptimisticComment?: (comment: CommentType) => void;
				onCommentSuccess?: (comment: CommentType) => void;
			}>,
		) => (
			<>
				<div
					ref={props.commentsContainerRef}
					className="min-h-0 flex-1 overflow-y-auto"
				>
					{props.children}
				</div>
				{!props.commentInputProps?.disabled && props.videoId && (
					<div className="flex-none border-t border-gray-5 bg-gray-2 p-2">
						<ActivityComposer
							videoId={props.videoId}
							ownerName={props.ownerName}
							onSubmit={(content) =>
								props.commentInputProps?.onSubmit?.(content)
							}
							setShowAuthOverlay={props.setShowAuthOverlay}
							canRecordMedia={props.canRecordMedia}
							onOptimisticComment={props.onOptimisticComment}
							onCommentSuccess={props.onCommentSuccess}
						/>
					</div>
				)}
			</>
		),
		Skeleton: (props: { setShowAuthOverlay: (v: boolean) => void }) => (
			<Comments.Shell {...props} commentInputProps={{ disabled: true }} />
		),
	},
);
