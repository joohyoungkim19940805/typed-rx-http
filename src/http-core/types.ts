// http-core/@types/types.ts
export type OpenApiPathsLike = object;

export interface ServiceArguments<
	Paths extends OpenApiPathsLike,
	TPath extends keyof Paths,
	TMethod extends keyof Paths[TPath] & string,
	R,
> {
	url: TPath;
	method: TMethod;

	pathVariable?: Paths[TPath][TMethod] extends {
		parameters: { path: infer P };
	}
		? P | undefined
		: Record<string, unknown> | undefined;

	queryString?: Paths[TPath][TMethod] extends {
		parameters: { query: infer Q };
	}
		? Q | undefined
		: Record<string, unknown> | undefined;

	body?: Paths[TPath][TMethod] extends {
		requestBody: { content: { "application/json": infer B } };
	}
		? B | undefined
		: unknown;

	/** response.ok 여부와 상관없이 Response를 직접 파싱하고 싶을 때 */
	resultInterceptor?: (response: Response) => Promise<R>;

	/** per-request headers */
	headers?: Readonly<Record<string, string>>;
}

export interface CacheForService<CacheName extends string = string> {
	cacheTime: number;
	cacheSize?: number;
	cacheName: CacheName;
}

/** 코어가 던지는 표준 에러 (401 포함) */
export class HttpResponseError<Args = unknown> extends Error {
	public readonly name = "HttpResponseError";
	constructor(
		public readonly response: Response,
		public readonly args: Args,
		public readonly data?: unknown,
		message?: string,
	) {
		super(message ?? `HTTP ${response.status} / ${response.statusText}`);
	}

	get status() {
		return this.response.status;
	}
}

export const isHttpResponseError = (e: unknown): e is HttpResponseError<any> =>
	e instanceof HttpResponseError;
