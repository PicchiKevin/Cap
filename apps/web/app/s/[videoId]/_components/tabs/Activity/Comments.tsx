import { Button } from "@cap/ui";
import { Comment, User, type Video } from "@cap/web-domain";
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
import CommentThread from "./Comment";
import CommentInput from "./CommentInput";
import EmptyState from "./EmptyState";
import { DONE_MESSAGE, latestDoneAt, useReopenedThreads } from "./threadState";

type Thread = {
	root: CommentType;
	replies: CommentType[];
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
			if (commentsContainerRef.current) {
				commentsContainerRef.current.scrollTo({
					top: commentsContainerRef.current.scrollHeight,
					behavior: "smooth",
				});
			}
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
					// replies-to-replies are flattened into their top-level thread
					const parent = optimisticComments.find(
						(c) => c.id === reply.parentCommentId,
					);
					return parent?.parentCommentId === root.id;
				});
				const doneAt = latestDoneAt(replies);
				return {
					root,
					replies,
					isDone: isThreadDone(root.id, doneAt),
				};
			});

			return {
				openThreads: threads.filter((t) => !t.isDone),
				resolvedThreads: threads.filter((t) => t.isDone),
			};
		}, [optimisticComments, isThreadDone]);

		const postComment = async (
			content: string,
			parentCommentId: Comment.CommentId,
			timestamp: number | null,
		) => {
			if (!user) return;

			const optimisticComment: CommentType = {
				id: Comment.CommentId.make(`temp-${Date.now()}`),
				authorId: User.UserId.make(user.id),
				authorName: user?.name,
				authorImage: user.imageUrl,
				content,
				createdAt: new Date(),
				videoId: props.videoId,
				parentCommentId,
				type: "text",
				timestamp,
				updatedAt: new Date(),
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
				type: "text",
				timestamp,
			});
			handleCommentSuccess(data);
			return data;
		};

		const currentVideoTime = () => {
			const videoElement = document.querySelector("video") as HTMLVideoElement;
			return videoElement?.currentTime || 0;
		};

		const handleNewComment = async (content: string) => {
			try {
				await postComment(
					content,
					Comment.CommentId.make(""),
					currentVideoTime(),
				);
			} catch (error) {
				console.error("Error posting comment:", error);
			}
		};

		const handleReply = async (content: string) => {
			if (!replyingTo) return;

			const parentComment = optimisticComments.find((c) => c.id === replyingTo);
			const actualParentId = parentComment?.parentCommentId
				? parentComment.parentCommentId
				: replyingTo;

			try {
				const data = await postComment(
					content,
					actualParentId,
					currentVideoTime(),
				);
				if (data) {
					const newReplyElement = document.getElementById(`comment-${data.id}`);
					newReplyElement?.scrollIntoView({
						behavior: "smooth",
						block: "center",
					});
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
			// a fresh done-message must win over any earlier local reopen
			clearReopen(threadId);
			try {
				await postComment(DONE_MESSAGE, threadId, null);
			} catch (error) {
				console.error("Error resolving thread:", error);
			}
		};

		const handleReopen = (threadId: Comment.CommentId) => {
			reopen(threadId);
		};

		const handleCancelReply = () => {
			setReplyingTo(null);
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
				setComments((prev) => prev.filter((c) => c.id !== commentId));
			} catch (error) {
				console.error("Failed to delete comment:", error);
			}
		};

		const onReply = (id: Comment.CommentId) => {
			if (!user) {
				props.setShowAuthOverlay(true);
			} else {
				setReplyingTo(id);
			}
		};

		const renderThread = (thread: Thread) => (
			<CommentThread
				key={thread.root.id}
				comment={thread.root}
				replies={thread.replies}
				isDone={thread.isDone}
				onReply={onReply}
				replyingToId={replyingTo}
				handleReply={handleReply}
				onCancelReply={handleCancelReply}
				onDelete={handleDeleteComment}
				onResolve={handleResolve}
				onReopen={handleReopen}
				onSeek={onSeek}
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
			>
				{commentsDisabled ? (
					<div className="p-4 space-y-6 h-full">
						<EmptyState
							icon={<FontAwesomeIcon icon={faCommentSlash} />}
							commentsDisabled={commentsDisabled}
						/>
					</div>
				) : !hasThreads ? (
					<EmptyState />
				) : (
					<div className="p-3 space-y-2.5">
						{openThreads.map(renderThread)}

						{openThreads.length === 0 && resolvedThreads.length > 0 && (
							<div className="flex flex-col items-center py-6 text-center">
								<FontAwesomeIcon
									icon={faCircleCheck}
									className="mb-2 text-green-500 size-6"
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
									onClick={() => setShowResolved((v) => !v)}
									className="flex gap-2 items-center w-full text-xs font-medium text-gray-9 hover:text-gray-12 transition-colors"
								>
									<div className="flex-1 h-px bg-gray-4" />
									<span className="flex gap-1.5 items-center">
										<FontAwesomeIcon
											className="size-[9px]"
											icon={showResolved ? faChevronDown : faChevronRight}
										/>
										{resolvedThreads.length} resolved{" "}
										{resolvedThreads.length === 1 ? "thread" : "threads"}
									</span>
									<div className="flex-1 h-px bg-gray-4" />
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
			}>,
		) => {
			const user = useCurrentUser();

			return (
				<>
					<div
						ref={props.commentsContainerRef}
						className="overflow-y-auto flex-1 min-h-0"
					>
						{props.children}
					</div>

					{!props.commentInputProps?.disabled && (
						<div className="flex-none p-2 border-t border-gray-5 bg-gray-2">
							{user ? (
								<CommentInput
									{...props.commentInputProps}
									placeholder="Leave a comment"
									buttonLabel="Comment"
								/>
							) : (
								<Button
									className="min-w-full"
									variant="primary"
									onClick={() => props.setShowAuthOverlay(true)}
								>
									Sign in to leave a comment
								</Button>
							)}
						</div>
					)}
				</>
			);
		},
		Skeleton: (props: { setShowAuthOverlay: (v: boolean) => void }) => (
			<Comments.Shell {...props} commentInputProps={{ disabled: true }} />
		),
	},
);
