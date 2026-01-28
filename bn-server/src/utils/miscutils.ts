export function is(value: any): boolean {
	return value !== null && value !== undefined;
}

export function isDeepEqual(a: any, b: any) {
	return isDeepEqualLoopCheck(a, b, []);
}

function isDeepEqualLoopCheck(a: any, b: any, loopCheck: any[] = []): boolean {
	if (loopCheck.includes(a)) {
		return false;
	}
	loopCheck.push(a);
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch (e) {
		if (typeof a === 'object' && typeof b === 'object') {
			const keysA = Object.keys(a);
			const keysB = Object.keys(b);
			if (keysA.length !== keysB.length) {
				return false;
			}
			for (const key of keysA) {
				if ( ! isDeepEqualLoopCheck(a[key], b[key], loopCheck)) {
					return false;
				}
			}
			return true;
		}
		if (Array.isArray(a) && Array.isArray(b)) {
			if (a.length !== b.length) {
				return false;
			}
			for (let i = 0; i < a.length; i++) {
				if ( ! isDeepEqualLoopCheck(a[i], b[i], loopCheck)) {
					return false;
				}
			}
			return true;
		}
		// fallback to simple equality check
		return a === b;
	}
}