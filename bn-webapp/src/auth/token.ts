/**
 * Auth0's getAccessTokenSilently is typed as possibly returning undefined. Treat that as
 * not signed in rather than sending `Bearer undefined` and puzzling over a 401.
 */
export async function requireToken(get: () => Promise<string | undefined>): Promise<string> {
	const token = await get();
	if (!token) throw new Error('Sign-in required');
	return token;
}
