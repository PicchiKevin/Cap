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

const ActionButton: React.FC<{
	tooltip: string;
	icon: typeof faReply;
	onClick: () => void;
	danger?: boolean;
	success?: boolean;
}> = ({ tooltip, icon, onClick, danger, success }) => (
	<Tooltip content={tooltip}>
		<button
			type="button"
			onClick={onClick}
			className={clsx(
				"flex justify-center items-center rounded-md size-6 text-gray-8 transition-colors hover:bg-gray-3",
				danger && "hover:text-red-500",
				success && "hover:text-green-600",
				!danger && !success && "hover:text-gray-12",
			)}
		>
			<FontAwesomeIcon className="size-[10px]" icon={icon} />
		</button>
	</Tooltip>
);

const CommentRow: React.FC<{
	comment: CommentType;
	isReply?: boolean;
	onReply?: () => void;
	onDelete?: () => void;
	onResolve?: () => void;
	onReopen?: () => void;
	onSeek?: (time: number) => void;
	badge?: React.ReactNode;
}> = ({
	comment,
	isReply,
	onReply,
	onDelete,
	onResolve,
	onReopen,
	onSeek,
	badge,
}) => {
	const user = useCurrentUser();
	const isOwnComment = user?.id === comment.authorId;
	const commentDate = new Date(comment.createdAt);

	return (
		<div
			id={`comment-${comment.id}`}
			className={clsx("group relative", comment.sending && "opacity-40")}
		>
			<div className="flex gap-1.5 items-center">
				{comment.authorName && (
					<SignedImageUrl
						image={comment.authorImage}
						name={comment.authorName}
						className={isReply ? "size-4" : "size-5"}
						letterClass={isReply ? "text-[9px]" : "text-[10px]"}
					/>
				)}
				<span className="text-xs font-medium truncate text-gray-12">
					{comment.authorName || "Anonymous"}
				</span>
				{badge}
				<Tooltip content={formatTimestamp(commentDate)}>
					<span className="text-[11px] text-gray-8 shrink-0">
						{formatTimeAgo(commentDate)}
					</span>
				</Tooltip>
				{comment.timestamp !== null && (
					<button
						type="button"
						onClick={() => onSeek?.(Number(comment.timestamp))}
						className="text-[11px] tabular-nums text-blue-500 shrink-0 cursor-pointer hover:text-blue-700"
					>
						{formatVideoTimestamp(comment.timestamp)}
					</button>
				)}
			</div>
			<p
				className={clsx(
					"mt-0.5 text-[13px] leading-snug text-gray-11 break-words",
					isReply ? "pl-[22px]" : "pl-[26px]",
				)}
			>
				<LinkifiedText text={comment.content} />
			</p>
			<div className="hidden absolute -top-1 right-0 gap-0.5 items-center p-0.5 rounded-lg border shadow-sm group-hover:flex bg-gray-1 border-gray-4">
				{onReply && (
					<ActionButton tooltip="Reply" icon={faReply} onClick={onReply} />
				)}
				{onResolve && (
					<ActionButton
						tooltip={`Mark as done — posts "This is done"`}
						icon={faCheck}
						onClick={onResolve}
						success
					/>
				)}
				{onReopen && (
					<ActionButton
						tooltip="Reopen thread"
						icon={faRotateLeft}
						onClick={onReopen}
					/>
				)}
				{isOwnComment && onDelete && (
					<ActionButton
						tooltip="Delete"
						icon={faTrash}
						onClick={onDelete}
						danger
					/>
				)}
			</div>
		</div>
	);
};

const ResolutionLine: React.FC<{ comment: CommentType }> = ({ comment }) => (
	<div
		id={`comment-${comment.id}`}
		className={clsx(
			"flex gap-1.5 items-center text-[11px] text-gray-9",
			comment.sending && "opacity-40",
		)}
	>
		<span className="flex justify-center items-center rounded-full bg-green-100 text-green-700 size-3.5 shrink-0">
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
	const commentParams = useSearchParams().get("comment");
	const replyParams = useSearchParams().get("reply");
	const highlightedId = commentParams || replyParams;
	const isHighlighted =
		highlightedId === comment.id ||
		replies.some((reply) => reply.id === highlightedId);

	useEffect(() => {
		if (isDone) setShowReplies(false);
	}, [isDone]);

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
				"p-2.5 rounded-lg border border-gray-3 bg-white",
				isDone && "opacity-75",
			)}
		>
			<CommentRow
				comment={comment}
				onSeek={onSeek}
				badge={
					isDone ? (
						<span className="flex gap-1 items-center px-1.5 py-px text-[10px] font-medium text-green-700 bg-green-100 rounded-full shrink-0">
							<FontAwesomeIcon className="size-[8px]" icon={faCheck} />
							Done
						</span>
					) : undefined
				}
				onReply={
					user && !isReplying && !isDone ? () => onReply(comment.id) : undefined
				}
				onResolve={user && !isDone ? () => onResolve(comment.id) : undefined}
				onReopen={isDone ? () => onReopen(comment.id) : undefined}
				onDelete={() => handleDelete(comment)}
			/>

			{replies.length > 0 && (
				<button
					type="button"
					onClick={() => setShowReplies((v) => !v)}
					className="flex gap-1 items-center mt-1.5 ml-[26px] text-[11px] font-medium text-gray-9 transition-colors hover:text-gray-12"
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

			<AnimatePresence initial={false}>
				{showReplies && replies.length > 0 && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: "easeInOut" }}
						className="overflow-hidden"
					>
						<div className="mt-2 ml-[9px] pl-3.5 space-y-2 border-l border-gray-4">
							{replies.map((reply) =>
								isDoneMessage(reply) ? (
									<ResolutionLine key={reply.id} comment={reply} />
								) : (
									<CommentRow
										key={reply.id}
										comment={reply}
										isReply
										onSeek={onSeek}
										onDelete={() => handleDelete(reply)}
									/>
								),
							)}
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			{isReplying && (
				<div className="mt-2 ml-[26px]">
					<CommentInput
						onSubmit={handleReply}
						onCancel={onCancelReply}
						placeholder="Write a reply..."
						showCancelButton={true}
						autoFocus={true}
					/>
				</div>
			)}
		</motion.div>
	);
};

export default CommentThread;
