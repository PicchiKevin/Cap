export const canRetryTranscription = ({
	viewerId,
	ownerId,
	canManageOrganizationSettings,
}: {
	viewerId: string | null | undefined;
	ownerId: string;
	canManageOrganizationSettings: boolean;
}) => viewerId === ownerId || canManageOrganizationSettings;
