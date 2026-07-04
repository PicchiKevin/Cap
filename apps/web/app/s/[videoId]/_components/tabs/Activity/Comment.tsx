import { Button } from "@cap/ui";
import type { Comment } from "@cap/web-domain";
import {
	faCheck,
	faChevronDown,
	faChevronRight,
	faReply,
	faRotateLeft,
	faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import { useCurrentUser } from "@/app/Layout/AuthContext";
import { LinkifiedText } from "@/components/LinkifiedText";
import { SignedImageUrl } from "@/components/SignedImageUrl";
import { Tooltip } from "@/components/Tooltip";
import type { CommentType } from "../../../Share";
import CommentInput from "./CommentInput";
import { isDoneMessage } from "./threadState";
import { formatTimeAgo, formatTimestamp } from "./utils";

const formatVideoTimestamp = (timestamp: number) =>
	new Date(timestamp * 1000).toISOString().substr(11, 8);

const CommentBubble: React.FC<{
	comment: CommentType;
	isRoot?: boolean;
	isDone?: boolean;
	onReply?: () => void;
	onDelete?: () => void;
	onResolve?: () => void;
	onReopen?: () => void;
	onSeek?: (time: number) => void;
}> = ({
	comment,
	isRoot,
	isDone,
	onReply,
	onDelete,
	onResolve,
	onReopen,
	onSeek,
}) => {
	const user = useCurrentUser();
	const isOwnComment = user?.id === comment.authorId;
	const commentParams = useSearchParams().get("comment");
	const replyParams = useSearchParams().get("reply");
	const isHighlighted = (commentParams || replyParams) === comment.id;
	const commentDate = new Date(comment.createdAt);
	const hasActions = Boolean(onReply || onDelete || onResolve || onReopen);

	return (
		<div className="flex items-start space-x-2.5">
			{comment.authorName && (
				<SignedImageUrl
					image={comment.authorImage}
					name={comment.authorName}
					className="size-6"
					letterClass="text-sm"
				/>
			)}
			<motion.div
				viewport={{ once: true }}
				whileInView={{
					scale: isHighlighted ? [1, 1.08, 1] : 1,
					borderColor: isHighlighted ? ["#EEEEEE", "#1696e0"] : "#EEEEEE",
					backgroundColor: isHighlighted ? ["#F9F9F9", "#EDF6FF"] : " #F9F9F9",
				}}
				transition={{ duration: 0.75, ease: "easeInOut", delay: 0.15 }}
				className={clsx(
					"flex-1 p-3 rounded-xl border border-gray-3 bg-gray-2 min-w-0",
					isDone && "opacity-75",
				)}
			>
				<div className="flex gap-3 justify-between items-center">
					<div className="flex gap-2 items-center min-w-0">
						<p className="text-sm font-medium truncate text-gray-12">
							{comment.authorName || "Anonymous"}
						</p>
						{isRoot && isDone && (
							<span className="flex gap-1 items-center px-1.5 py-0.5 text-[11px] font-medium text-green-700 bg-green-100 rounded-full">
								<FontAwesomeIcon className="size-[9px]" icon={faCheck} />
								Done
							</span>
						)}
					</div>
					<div className="flex gap-2 items-center text-nowrap min-w-fit">
						<Tooltip content={formatTimestamp(commentDate)}>
							<p className="text-xs text-gray-8">
								{formatTimeAgo(commentDate)}
							</p>
						</Tooltip>
						{comment.timestamp !== null && (
							<button
								type="button"
								onClick={() => onSeek?.(Number(comment.timestamp))}
								className="text-xs text-blue-500 cursor-pointer hover:text-blue-700"
							>
								{formatVideoTimestamp(comment.timestamp)}
							</button>
						)}
					</div>
				</div>
				<p className="mt-2 text-sm text-gray-11">
					<LinkifiedText text={comment.content} />
				</p>
				{hasActions && (
					<div className="flex items-center pt-2 mt-2.5 space-x-2 border-t border-gray-3">
						{onReply && (
							<Tooltip content="Reply">
								<Button
									onClick={onReply}
									size="icon"
									variant="outline"
									icon={
										<FontAwesomeIcon className="size-[10px]" icon={faReply} />
									}
									className="text-[13px] p-0 size-6"
								/>
							</Tooltip>
						)}
						{onResolve && (
							<Tooltip content={`Mark as done — posts "This is done"`}>
								<Button
									onClick={onResolve}
									size="icon"
									variant="outline"
									icon={
										<FontAwesomeIcon className="size-[10px]" icon={faCheck} />
									}
									className="text-[13px] p-0 size-6 hover:text-green-600 hover:border-green-300"
								/>
							</Tooltip>
						)}
						{onReopen && (
							<Tooltip content="Reopen thread">
								<Button
									onClick={onReopen}
									size="icon"
									variant="outline"
									icon={
										<FontAwesomeIcon
											className="size-[10px]"
											icon={faRotateLeft}
										/>
									}
									className="text-[13px] p-0 size-6"
								/>
							</Tooltip>
						)}
						{isOwnComment && onDelete && (
							<Tooltip content="Delete comment">
								<Button
									onClick={onDelete}
									size="icon"
									variant="outline"
									icon={
										<FontAwesomeIcon className="size-[10px]" icon={faTrash} />
									}
									className="text-[13px] p-0 size-6"
								/>
							</Tooltip>
						)}
					</div>
				)}
			</motion.div>
		</div>
	);
};

const ResolutionLine: React.FC<{ comment: CommentType }> = ({ comment }) => (
	<div className="flex gap-2 items-center py-1 text-xs text-gray-9">
		<span className="flex justify-center items-center rounded-full bg-green-100 text-green-700 size-4">
			<FontAwesomeIcon className="size-[8px]" icon={faCheck} />
		</span>
		<span>
			<span className="font-medium text-gray-11">
				{comment.authorName || "Anonymous"}
			</span>{" "}
			marked this as done
		</span>
		<Tooltip content={formatTimestamp(new Date(comment.createdAt))}>
			<span>· {formatTimeAgo(new Date(comment.createdAt))}</span>
		</Tooltip>
	</div>
);

const CommentThread: React.FC<{
	comment: CommentType;
	replies: CommentType[];
	isDone: boolean;
	onReply: (commentId: Comment.CommentId) => void;
	replyingToId: Comment.CommentId | null;
	handleReply: (content: string) => void;
	onCancelReply: () => void;
	onDelete: (
		commentId: Comment.CommentId,
		parentId: Comment.CommentId | null,
	) => void;
	onResolve: (threadId: Comment.CommentId) => void;
	onReopen: (threadId: Comment.CommentId) => void;
	onSeek?: (time: number) => void;
}> = ({
	comment,
	replies,
	isDone,
	onReply,
	replyingToId,
	handleReply,
	onCancelReply,
	onDelete,
	onResolve,
	onReopen,
	onSeek,
}) => {
	const user = useCurrentUser();
	const isReplying = replyingToId === comment.id;
	const [showReplies, setShowReplies] = useState(!isDone);

	useEffect(() => {
		if (isDone) setShowReplies(false);
	}, [isDone]);

	const handleDelete = (target: CommentType) => {
		if (window.confirm("Are you sure you want to delete this comment?")) {
			onDelete(target.id, target.parentCommentId);
		}
	};

	const visibleReplyCount = replies.length;

	return (
		<div
			id={`comment-${comment.id}`}
			className={clsx(
				"space-y-2",
				comment.sending ? "opacity-20" : "opacity-100",
			)}
		>
			<CommentBubble
				comment={comment}
				isRoot
				isDone={isDone}
				onSeek={onSeek}
				onReply={
					user && !isReplying && !isDone ? () => onReply(comment.id) : undefined
				}
				onResolve={user && !isDone ? () => onResolve(comment.id) : undefined}
				onReopen={isDone ? () => onReopen(comment.id) : undefined}
				onDelete={() => handleDelete(comment)}
			/>

			{visibleReplyCount > 0 && (
				<button
					type="button"
					onClick={() => setShowReplies((v) => !v)}
					className="flex gap-1.5 items-center ml-9 text-xs font-medium text-gray-9 hover:text-gray-12 transition-colors"
				>
					<FontAwesomeIcon
						className="size-[9px]"
						icon={showReplies ? faChevronDown : faChevronRight}
					/>
					{showReplies
						? "Hide replies"
						: `Show ${visibleReplyCount} ${visibleReplyCount === 1 ? "reply" : "replies"}`}
				</button>
			)}

			<AnimatePresence initial={false}>
				{showReplies && visibleReplyCount > 0 && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: "easeInOut" }}
						className="overflow-hidden"
					>
						<div className="ml-8 pl-4 space-y-3 border-l-2 border-gray-100">
							{replies.map((reply) =>
								isDoneMessage(reply) ? (
									<div
										key={reply.id}
										id={`comment-${reply.id}`}
										className={clsx(reply.sending && "opacity-20")}
									>
										<ResolutionLine comment={reply} />
									</div>
								) : (
									<div
										key={reply.id}
										id={`comment-${reply.id}`}
										className={clsx(reply.sending && "opacity-20")}
									>
										<CommentBubble
											comment={reply}
											onSeek={onSeek}
											onReply={
												user && replyingToId !== reply.id && !isDone
													? () => onReply(reply.id)
													: undefined
											}
											onDelete={() => handleDelete(reply)}
										/>
									</div>
								),
							)}
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			{isReplying && (
				<div className="ml-9">
					<CommentInput
						onSubmit={handleReply}
						onCancel={onCancelReply}
						placeholder="Write a reply..."
						showCancelButton={true}
						autoFocus={true}
					/>
				</div>
			)}
		</div>
	);
};

export default CommentThread;
