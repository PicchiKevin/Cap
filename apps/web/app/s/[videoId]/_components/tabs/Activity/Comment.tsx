import type { Comment } from "@cap/web-domain";
import {
	faCheck,
	faChevronDown,
	faChevronRight,
	faReply,
	faRotateLeft,
	faTrash,
	faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import clsx from "clsx";
import { motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import { useCurrentUser } from "@/app/Layout/AuthContext";
import { LinkifiedText } from "@/components/LinkifiedText";
import { SignedImageUrl } from "@/components/SignedImageUrl";
import { Tooltip } from "@/components/Tooltip";
import type { CommentType } from "../../../Share";
import { MediaCommentBody } from "../../media-comment/MediaCommentBody";
import { isMediaComment } from "../../media-comment/media-comment-types";
import CommentInput from "./CommentInput";
import { isResolution } from "./threadState";
import { formatTimeAgo, formatTimestamp } from "./utils";

const formatVideoTimestamp = (timestamp: number) =>
	new Date(timestamp * 1000).toISOString().slice(11, 19);

const ActionButton: React.FC<{
	tooltip: string;
	icon: typeof faReply;
	onClick: () => void;
	danger?: boolean;
}> = ({ tooltip, icon, onClick, danger = false }) => (
	<Tooltip content={tooltip}>
		<button
			type="button"
			onClick={onClick}
			aria-label={tooltip}
			className={clsx(
				"flex size-6 items-center justify-center rounded-md text-gray-8 transition-colors hover:bg-gray-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-9",
				danger ? "hover:text-red-500" : "hover:text-gray-12",
			)}
		>
			<FontAwesomeIcon className="size-[10px]" icon={icon} />
		</button>
	</Tooltip>
);

const CommentRow: React.FC<{
	comment: CommentType;
	isReply?: boolean;
	onDelete?: () => void;
	onReopen?: () => void;
	onSeek?: (time: number) => void;
	badge?: React.ReactNode;
}> = ({ comment, isReply = false, onDelete, onReopen, onSeek, badge }) => {
	const user = useCurrentUser();
	const isOwnComment = user?.id === comment.authorId;
	const commentDate = new Date(comment.createdAt);

	return (
		<div
			id={`comment-${comment.id}`}
			tabIndex={-1}
			className={clsx(
				"group relative focus:outline-none",
				comment.sending && !isMediaComment(comment) && "opacity-40",
			)}
		>
			<div className="flex items-center gap-1.5">
				{comment.authorName && (
					<SignedImageUrl
						image={comment.authorImage}
						name={comment.authorName}
						className={isReply ? "size-4" : "size-5"}
						letterClass={isReply ? "text-[9px]" : "text-[10px]"}
					/>
				)}
				<span className="truncate text-xs font-medium text-gray-12">
					{comment.authorName || "Anonymous"}
				</span>
				{badge}
				<Tooltip content={formatTimestamp(commentDate)}>
					<span className="shrink-0 text-[11px] text-gray-8">
						{formatTimeAgo(commentDate)}
					</span>
				</Tooltip>
				{comment.timestamp !== null && (
					<button
						type="button"
						onClick={() => onSeek?.(Number(comment.timestamp))}
						className="shrink-0 cursor-pointer text-[11px] tabular-nums text-blue-500 hover:text-blue-700"
					>
						{formatVideoTimestamp(comment.timestamp)}
					</button>
				)}
			</div>
			{isMediaComment(comment) ? (
				<div className="mt-2 space-y-2">
					<MediaCommentBody comment={comment} compact />
					{comment.content && (
						<p
							className={clsx(
								"text-[13px] leading-snug text-gray-11 break-words",
								isReply ? "pl-[22px]" : "pl-[26px]",
							)}
						>
							<LinkifiedText text={comment.content} />
						</p>
					)}
				</div>
			) : (
				<p
					className={clsx(
						"mt-0.5 text-[13px] leading-snug text-gray-11 break-words",
						isReply ? "pl-[22px]" : "pl-[26px]",
					)}
				>
					<LinkifiedText text={comment.content} />
				</p>
			)}
			{(onReopen || (isOwnComment && onDelete)) && (
				<div className="absolute -top-1 right-0 hidden items-center gap-0.5 rounded-lg group-focus-within:flex [@media(pointer:coarse)]:flex border border-gray-4 bg-gray-1 p-0.5 shadow-sm group-hover:flex">
					{onReopen && (
						<ActionButton
							tooltip="Reopen thread"
							icon={faRotateLeft}
							onClick={onReopen}
						/>
					)}
					{isOwnComment && onDelete && (
						<ActionButton
							tooltip="Delete comment"
							icon={faTrash}
							onClick={onDelete}
							danger
						/>
					)}
				</div>
			)}
		</div>
	);
};

const ResolutionLine: React.FC<{ comment: CommentType }> = ({ comment }) => (
	<div
		id={`comment-${comment.id}`}
		tabIndex={-1}
		className={clsx(
			"flex items-center gap-1.5 text-[11px] text-gray-9 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-9",
			comment.sending && "opacity-40",
		)}
	>
		<span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
			<FontAwesomeIcon className="size-[7px]" icon={faCheck} />
		</span>
		<span className="truncate">
			<span className="font-medium text-gray-11">
				{comment.authorName || "Anonymous"}
			</span>{" "}
			marked this as done
		</span>
		<Tooltip content={formatTimestamp(new Date(comment.createdAt))}>
			<span className="shrink-0">
				· {formatTimeAgo(new Date(comment.createdAt))}
			</span>
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
	forceShowReplies?: boolean;
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
	forceShowReplies = false,
}) => {
	const isReplying = replyingToId === comment.id;
	const [showReplies, setShowReplies] = useState(!isDone || forceShowReplies);
	const commentParams = useSearchParams().get("comment");
	const replyParams = useSearchParams().get("reply");
	const highlightedId = commentParams || replyParams;
	const isHighlighted =
		highlightedId === comment.id ||
		replies.some((reply) => reply.id === highlightedId);

	useEffect(() => {
		setShowReplies(!isDone || forceShowReplies);
	}, [isDone, forceShowReplies]);

	const handleDelete = (target: CommentType) => {
		if (window.confirm("Are you sure you want to delete this comment?")) {
			onDelete(target.id, target.parentCommentId);
		}
	};

	return (
		<motion.div
			viewport={{ once: true }}
			whileInView={{
				borderColor: isHighlighted ? ["#EEEEEE", "#1696e0"] : "#EEEEEE",
				backgroundColor: isHighlighted ? ["#FFFFFF", "#EDF6FF"] : "#FFFFFF",
			}}
			transition={{ duration: 0.75, ease: "easeInOut", delay: 0.15 }}
			className={clsx(
				"rounded-lg border border-gray-3 bg-white p-2.5",
				isDone && "opacity-75",
			)}
		>
			<CommentRow
				comment={comment}
				onSeek={onSeek}
				badge={
					isDone ? (
						<span className="flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-1.5 py-px text-[10px] font-medium text-green-700">
							<FontAwesomeIcon className="size-[8px]" icon={faCheck} />
							Done
						</span>
					) : undefined
				}
				onReopen={isDone ? () => onReopen(comment.id) : undefined}
				onDelete={() => handleDelete(comment)}
			/>

			{replies.length > 0 && (
				<button
					type="button"
					onClick={() => setShowReplies((visible) => !visible)}
					className="mt-1.5 flex items-center gap-1 ml-[26px] text-[11px] font-medium text-gray-9 transition-colors hover:text-gray-12"
				>
					<FontAwesomeIcon
						className="size-[8px]"
						icon={showReplies ? faChevronDown : faChevronRight}
					/>
					{showReplies
						? "Hide replies"
						: `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
				</button>
			)}

			{showReplies && replies.length > 0 && (
				<div className="mt-2 ml-[9px] space-y-2 border-l border-gray-4 pl-3.5">
					{replies.map((reply) =>
						isResolution(reply) ? (
							<ResolutionLine
								key={reply.clientKey ?? reply.id}
								comment={reply}
							/>
						) : (
							<CommentRow
								key={reply.clientKey ?? reply.id}
								comment={reply}
								isReply
								onSeek={onSeek}
								onDelete={() => handleDelete(reply)}
							/>
						),
					)}
				</div>
			)}

			{!isDone && !comment.sending && !isReplying && (
				<div className="mt-2 flex gap-1.5 ml-[26px]">
					<button
						type="button"
						onClick={() => onReply(comment.id)}
						className="flex items-center gap-1.5 rounded-md border border-gray-4 bg-gray-1 px-2 py-1 text-[11px] font-medium text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
					>
						<FontAwesomeIcon className="size-[9px]" icon={faReply} />
						Reply
					</button>
					<button
						type="button"
						onClick={() => onResolve(comment.id)}
						className="flex items-center gap-1.5 rounded-md border border-gray-4 bg-gray-1 px-2 py-1 text-[11px] font-medium text-gray-10 transition-colors hover:border-green-300 hover:bg-green-50 hover:text-green-700"
					>
						<FontAwesomeIcon className="size-[9px]" icon={faCheck} />
						Mark done
					</button>
				</div>
			)}

			{isReplying && (
				<div className="mt-2 flex items-start gap-1.5 ml-[26px]">
					<div className="min-w-0 flex-1">
						<CommentInput
							onSubmit={handleReply}
							placeholder="Write a reply..."
							autoFocus
						/>
					</div>
					<Tooltip content="Close">
						<button
							type="button"
							onClick={onCancelReply}
							className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-md text-gray-8 transition-colors hover:bg-gray-3 hover:text-gray-12"
						>
							<FontAwesomeIcon className="size-[11px]" icon={faXmark} />
						</button>
					</Tooltip>
				</div>
			)}
		</motion.div>
	);
};

export default CommentThread;
