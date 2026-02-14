// http-core/csr-cache.ts
import {
	BehaviorSubject,
	Observable,
	shareReplay,
	switchMap,
	take,
} from "rxjs";
import type {
	CacheForService,
	OpenApiPathsLike,
	ServiceArguments,
} from "./types";
import { stableStringify } from "./utils";

type AnyObs = Observable<any>;
type CacheMap = Record<string, BehaviorSubject<AnyObs>>;

export const createCsrCache = <CacheName extends string = string>() => {
	const cacheMap: CacheMap | null = typeof window !== "undefined" ? {} : null;

	function removeCsrCache(cacheName: CacheName): void;
	function removeCsrCache(cacheName: string): void;
	function removeCsrCache(cacheName: string) {
		if (!cacheMap) return;
		Object.keys(cacheMap).forEach((key) => {
			if (key.startsWith(cacheName)) delete cacheMap[key];
		});
	}
	const callApiCsrCache = <
		Paths extends OpenApiPathsLike,
		R,
		TPath extends keyof Paths = keyof Paths,
		TMethod extends keyof Paths[TPath] & string = keyof Paths[TPath] &
			string,
	>(
		callApi: (
			args: ServiceArguments<Paths, TPath, TMethod, R>,
		) => Observable<R>,
		serviceArguments: ServiceArguments<Paths, TPath, TMethod, R>,
		cacheForService: CacheForService,
	): Observable<R> => {
		if (typeof window === "undefined" || cacheMap == null) {
			return callApi(serviceArguments);
		}

		const cacheKey =
			cacheForService.cacheName +
			"=" +
			String(serviceArguments.method) +
			String(serviceArguments.url) +
			stableStringify(serviceArguments.queryString) +
			stableStringify(serviceArguments.pathVariable) +
			stableStringify(serviceArguments.body);

		let subject = cacheMap[cacheKey];
		if (!subject) {
			const shared$ = callApi(serviceArguments).pipe(
				shareReplay({
					bufferSize: cacheForService.cacheSize ?? 1,
					windowTime: cacheForService.cacheTime,
					refCount: false,
				}),
			);
			subject = new BehaviorSubject(shared$);
			cacheMap[cacheKey] = subject;
		}

		return subject.pipe(
			switchMap((s) => s),
			take(1),
		);
	};

	return { callApiCsrCache, removeCsrCache };
};
