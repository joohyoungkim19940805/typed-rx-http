// http-core/next/redirect401.ts
export const redirectToUnauthorizedOnServer401 = async () => {
	const { headers } = await import("next/headers");
	const { redirect } = await import("next/navigation");

	const h = await headers();
	const pageUrl = h.get("x-page-url") || "/";
	const redirectUri = encodeURIComponent(pageUrl);

	redirect(`/unauthorized?redirect_uri=${redirectUri}&logout=true`);
};
