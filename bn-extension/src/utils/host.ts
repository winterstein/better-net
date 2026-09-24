/**
 * Hostname matching that does not confuse substrings (x.com vs netflix.com)
 * or www. vs bare domain.
 */

export function hostnameOf(urlOrHost: string): string {
	if (!urlOrHost) return '';
	try {
		if (urlOrHost.includes('://') || urlOrHost.startsWith('//')) {
			return new URL(urlOrHost).hostname.toLowerCase();
		}
		return new URL(`https://${urlOrHost}`).hostname.toLowerCase();
	} catch {
		return String(urlOrHost).split('/')[0].split(':')[0].toLowerCase();
	}
}

/** Drop a leading www. so bbc.co.uk and www.bbc.co.uk are the same site. */
export function normalizeHost(urlOrHost: string): string {
	return hostnameOf(urlOrHost).replace(/^www\./, '');
}

/** True when `host` is `domain` or a subdomain of it (not a substring of another TLD). */
export function hostIsDomain(host: string, domain: string): boolean {
	const h = hostnameOf(host);
	const d = hostnameOf(domain);
	if (!h || !d) return false;
	return h === d || h.endsWith(`.${d}`);
}

export function hostsEqual(a: string, b: string): boolean {
	return normalizeHost(a) === normalizeHost(b);
}

export function hostListed(host: string, list: string[] | undefined): boolean {
	if (!host || !list?.length) return false;
	return list.some((entry) => hostsEqual(host, entry));
}
