// http-core/headers.ts
export interface HeaderStore {
	get(): Record<string, string>;
	set(next: Record<string, string>): void;
	merge(next: Record<string, string>): void;
	remove(key: string): void;
	clear(keys?: string[]): void;
}

export const createHeaderStore = (
	initial: Record<string, string> = { "Content-Type": "application/json" },
): HeaderStore => {
	let h = { ...initial };

	return {
		get: () => ({ ...h }),
		set: (next) => {
			h = { ...next };
		},
		merge: (next) => {
			for (const [k, v] of Object.entries(next)) {
				if (!v) continue;
				h[k] = v;
			}
		},
		remove: (key) => {
			delete h[key];
		},
		clear: (keys) => {
			if (!keys) {
				h = {};
				return;
			}
			for (const k of keys) delete h[k];
		},
	};
};
