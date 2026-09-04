import { FatalError, RetryableError } from "workflow";
import { SlackDeliveryError } from "@/lib/slack/client";
import type {
	SlackCommentNotificationInput,
	SlackDelivery,
} from "@/lib/slack/comment-notifications";

async function prepareSlackCommentNotificationStep(
	input: SlackCommentNotificationInput,
) {
	"use step";
	const { prepareSlackCommentDeliveries } = await import(
		"@/lib/slack/comment-notifications"
	);
	return prepareSlackCommentDeliveries(input);
}

async function deliverSlackCommentNotificationStep(delivery: SlackDelivery) {
	"use step";
	try {
		const { deliverSlackCommentNotification } = await import(
			"@/lib/slack/comment-notifications"
		);
		await deliverSlackCommentNotification(delivery);
	} catch (error) {
		if (error instanceof SlackDeliveryError) {
			if (!error.retryable) {
				throw new FatalError(error.message);
			}
			throw new RetryableError(error.message, {
				retryAfter: error.retryAfterMs
					? `${Math.ceil(error.retryAfterMs / 1000)} seconds`
					: "1 minute",
			});
		}
		throw new RetryableError("Slack comment delivery failed", {
			retryAfter: "1 minute",
		});
	}
}
deliverSlackCommentNotificationStep.maxRetries = 5;

export async function slackCommentNotificationWorkflow(
	input: SlackCommentNotificationInput,
) {
	"use workflow";
	const deliveries = await prepareSlackCommentNotificationStep(input);
	await Promise.allSettled(
		deliveries.map((delivery) => deliverSlackCommentNotificationStep(delivery)),
	);
}
