// http-core/utils.ts
export const replacePathVariable = (
	template: string,
	record: Record<string, string | number | boolean | null | undefined>,
): string => {
	return template.replace(/\{(.*?)\}/g, (_, key) => {
		const value = record[key];
		return value != null ? String(encodeURIComponent(value)) : `{${key}}`;
	});
};

export const toQueryString = (
	record: Record<
		string,
		| string
		| string[]
		| number
		| number[]
		| boolean
		| boolean[]
		| null
		| undefined
	>,
): string => {
	const qs = Object.entries(record).reduce((query, [key, value]) => {
		if (value == null) return query;
		let pair = "";
		if (Array.isArray(value)) {
			pair = value
				.map(
					(item) =>
						`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`,
				)
				.join("&");
		} else {
			pair = `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
		}
		return query ? `${query}&${pair}` : pair;
	}, "");

	return `?${qs}`;
};

export const stableStringify = (obj: any) => {
	if (!obj) return "{}";
	if (typeof obj !== "object") return JSON.stringify(obj);
	const allKeys = new Set<string>();
	JSON.stringify(obj, (k, v) => (allKeys.add(k), v));
	const keys = Array.from(allKeys).sort();
	return JSON.stringify(obj, keys);
};

export const joinUrl = (baseUrl: string, path: string) => {
	const b = baseUrl.replace(/\/+$/, "");
	const p = path.replace(/^\/+/, "");
	return `${b}/${p}`;
};
