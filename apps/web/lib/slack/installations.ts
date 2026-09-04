import type { Organisation, User } from "@cap/web-domain";
import {
	deleteIntegrationInstallation,
	deleteIntegrationInstallationByExternalId,
	getIntegrationInstallationCredentials,
	listIntegrationInstallations,
	saveIntegrationInstallation,
} from "@/lib/integrations/installations";
import { SLACK_NOTIFICATION_SCOPES, SLACK_UNFURL_SCOPES } from "./client";

const SLACK_PROVIDER = "slack";

export type SlackInstallationSummary = {
	id: string;
	teamId: string;
	teamName: string;
	needsReauthorization: boolean;
	createdAt: Date;
	updatedAt: Date;
};

export const hasSlackUnfurlScopes = (scopes: unknown) =>
	Array.isArray(scopes) &&
	SLACK_UNFURL_SCOPES.every((scope) => scopes.includes(scope));

export const hasSlackNotificationScopes = (scopes: unknown) =>
	Array.isArray(scopes) &&
	SLACK_NOTIFICATION_SCOPES.every((scope) => scopes.includes(scope));

export const saveSlackInstallation = async ({
	organizationId,
	installedByUserId,
	teamId,
	teamName,
	enterpriseId,
	botUserId,
	accessToken,
	scope,
}: {
	organizationId: Organisation.OrganisationId;
	installedByUserId: User.UserId;
	teamId: string;
	teamName: string;
	enterpriseId: string | null;
	botUserId: string | null;
	accessToken: string;
	scope: string;
}) => {
	await saveIntegrationInstallation({
		provider: SLACK_PROVIDER,
		externalId: teamId,
		displayName: teamName,
		organizationId,
		installedByUserId,
		credentials: { accessToken },
		metadata: {
			enterpriseId,
			botUserId,
			scopes: scope
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean),
		},
	});
};

export const listSlackInstallations = async (
	organizationId: Organisation.OrganisationId,
): Promise<SlackInstallationSummary[]> =>
	listIntegrationInstallations({
		organizationId,
		provider: SLACK_PROVIDER,
	}).then((installations) =>
		installations.map((installation) => ({
			id: installation.id,
			teamId: installation.externalId,
			teamName: installation.displayName,
			needsReauthorization: !hasSlackNotificationScopes(
				installation.metadata?.scopes,
			),
			createdAt: installation.createdAt,
			updatedAt: installation.updatedAt,
		})),
	);

const getSlackInstallationTokenForScopes = async ({
	teamId,
	requiredScopes,
}: {
	teamId: string;
	requiredScopes: (scopes: unknown) => boolean;
}) => {
	const installation = await getIntegrationInstallationCredentials({
		provider: SLACK_PROVIDER,
		externalId: teamId,
	});
	if (installation === null || !requiredScopes(installation.metadata.scopes)) {
		return null;
	}
	const { credentials } = installation;
	if (
		typeof credentials !== "object" ||
		Array.isArray(credentials) ||
		typeof (credentials as { accessToken?: unknown }).accessToken !== "string"
	) {
		throw new Error("Slack installation credentials are invalid");
	}
	return (credentials as { accessToken: string }).accessToken;
};

export const getSlackInstallationToken = async (teamId: string) =>
	getSlackInstallationTokenForScopes({
		teamId,
		requiredScopes: hasSlackUnfurlScopes,
	});

export const getSlackNotificationInstallationToken = async (teamId: string) =>
	getSlackInstallationTokenForScopes({
		teamId,
		requiredScopes: (scopes) =>
			hasSlackUnfurlScopes(scopes) && hasSlackNotificationScopes(scopes),
	});

export const getSlackInstallationTokens = async (
	organizationId: Organisation.OrganisationId,
) => {
	const installations = await listSlackInstallations(organizationId);
	const tokens = await Promise.all(
		installations.map(async (installation) => {
			if (installation.needsReauthorization) return null;
			const accessToken = await getSlackNotificationInstallationToken(
				installation.teamId,
			);
			return accessToken ? { accessToken, teamId: installation.teamId } : null;
		}),
	);
	return tokens.filter(
		(token): token is { accessToken: string; teamId: string } => token !== null,
	);
};

export const deleteSlackInstallation = async ({
	organizationId,
	installationId,
}: {
	organizationId: Organisation.OrganisationId;
	installationId: string;
}) => {
	await deleteIntegrationInstallation({
		provider: SLACK_PROVIDER,
		organizationId,
		installationId,
	});
};

export const deleteSlackInstallationByTeamId = async (teamId: string) => {
	await deleteIntegrationInstallationByExternalId({
		provider: SLACK_PROVIDER,
		externalId: teamId,
	});
};
