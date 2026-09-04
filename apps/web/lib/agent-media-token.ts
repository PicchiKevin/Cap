import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@cap/env";

type AgentMediaTokenPayload = {
	kind: "agent-media";
	videoId: string;
	expiresAt: number;
};

const encode = (value: unknown) =>
	Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const sign = (payload: string) =>
	createHmac("sha256", serverEnv().NEXTAUTH_SECRET)
		.update(payload)
		.digest("base64url");

export const createAgentMediaToken = (
	payload: Pick<AgentMediaTokenPayload, "videoId">,
	ttlSeconds = 300,
) => {
	const encodedPayload = encode({
		...payload,
		kind: "agent-media",
		expiresAt: Date.now() + ttlSeconds * 1_000,
	});
	return `${encodedPayload}.${sign(encodedPayload)}`;
};

export const verifyAgentMediaToken = (token: string) => {
	const [encodedPayload, signature, extra] = token.split(".");
	if (!encodedPayload || !signature || extra !== undefined) return null;

	const expected = sign(encodedPayload);
	const signatureBuffer = Buffer.from(signature);
	const expectedBuffer = Buffer.from(expected);
	if (signatureBuffer.length !== expectedBuffer.length) return null;
	if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

	let payload: AgentMediaTokenPayload;
	try {
		payload = JSON.parse(
			Buffer.from(encodedPayload, "base64url").toString("utf8"),
		) as AgentMediaTokenPayload;
	} catch {
		return null;
	}

	if (
		payload.kind !== "agent-media" ||
		typeof payload.videoId !== "string" ||
		typeof payload.expiresAt !== "number" ||
		payload.expiresAt < Date.now()
	) {
		return null;
	}

	return payload;
};
