// http-core//next/ssr-cache.ts
import { from, Observable } from "rxjs";
import type {
	CacheForService,
	OpenApiPathsLike,
	ServiceArguments,
} from "../types";
import { HttpResponseError } from "../types";
import {
	joinUrl,
	replacePathVariable,
	stableStringify,
	toQueryString,
} from "../utils";

const normalizeBodyAndHeaders = (
	body: any,
	headers: Record<string, string>,
) => {
	if (typeof FormData !== "undefined" && body instanceof FormData) {
		const next = { ...headers };
		delete next["Content-Type"];
		return { body, headers: next };
	}
	if (body != null) return { body: JSON.stringify(body), headers };
	return { body, headers };
};

const parseErrorBody = async (res: Response) => {
	try {
		return await res.json();
	} catch {
		try {
			return await res.text();
		} catch {
			return null;
		}
	}
};

export const callApiSsrCache = <
	Paths extends OpenApiPathsLike,
	R,
	CacheName extends string = string,
	TPath extends keyof Paths = keyof Paths,
	TMethod extends keyof Paths[TPath] & string = keyof Paths[TPath] & string,
>(opts: {
	baseUrl: string;
	serviceArguments: ServiceArguments<Paths, TPath, TMethod, R>;
	cacheForService: CacheForService<CacheName>;

	/** SSR에서 기본 헤더를 만들고 싶으면(예: 쿠키 Authorization) */
	headersProvider?: () =>
		| Promise<Record<string, string>>
		| Record<string, string>;

	/** 401 redirect 핸들러 */
	onServer401?: () => void | Promise<void>;
}): Observable<R> => {
	const run = async () => {
		const {
			baseUrl,
			serviceArguments,
			cacheForService,
			headersProvider,
			onServer401,
		} = opts;

		let url = serviceArguments.pathVariable
			? replacePathVariable(
					String(serviceArguments.url),
					serviceArguments.pathVariable as any,
				)
			: String(serviceArguments.url);

		url =
			url +
			((serviceArguments.queryString &&
				toQueryString(serviceArguments.queryString as any)) ||
				"");

		const baseHeaders = headersProvider ? await headersProvider() : {};
		const merged: Record<string, string> = {
			...baseHeaders,
			...(serviceArguments.headers || {}),
		};

		// Cache-Control 있으면 Authorization 제거(기존 정책 유지)
		if (merged["Cache-Control"]) delete merged["Authorization"];

		const { body, headers } = normalizeBodyAndHeaders(
			serviceArguments.body,
			merged,
		);
		const fullUrl = joinUrl(baseUrl, url);

		// Data Cache 조건(기존과 동일한 철학): GET + cacheTime > 0
		const isGet = String(serviceArguments.method).toUpperCase() === "GET";
		const allowDataCache = isGet && cacheForService.cacheTime > 0;

		const doFetch = async (
			cacheMode: "no-store" | "force-cache",
			revalidateSeconds?: number,
		) => {
			const init: RequestInit & { next?: { revalidate?: number } } = {
				method: serviceArguments.method as any,
				headers,
				body,
				cache: cacheMode,
			};
			if (cacheMode === "force-cache" && revalidateSeconds != null) {
				init.next = { revalidate: revalidateSeconds };
			}

			const res = await fetch(fullUrl, init);

			if (serviceArguments.resultInterceptor) {
				return serviceArguments.resultInterceptor(res);
			}

			if (!res.ok) {
				if (res.status === 401 && onServer401) {
					await Promise.resolve(onServer401()); // redirect() throws
				}
				const data = await parseErrorBody(res);
				if (
					data &&
					typeof data === "object" &&
					(data as any).resultType
				)
					throw data;

				throw new HttpResponseError(
					res,
					serviceArguments,
					data,
					(data as any)?.message ?? `HTTP ${res.status}`,
				);
			}

			return (await res.json()) as R;
		};

		if (allowDataCache) {
			const { unstable_cache } = await import("next/cache");
			const revalidateSeconds = Math.max(
				1,
				Math.ceil(cacheForService.cacheTime / 1000),
			);

			const key =
				cacheForService.cacheName +
				"=" +
				String(serviceArguments.method) +
				String(serviceArguments.url) +
				stableStringify(serviceArguments.queryString) +
				stableStringify(serviceArguments.pathVariable) +
				stableStringify(serviceArguments.body);

			const cached = unstable_cache(
				() => doFetch("force-cache", revalidateSeconds),
				[key],
				{
					revalidate: revalidateSeconds,
					tags: [cacheForService.cacheName],
				},
			);

			return cached();
		}

		return doFetch("no-store");
	};

	return from(run());
};
