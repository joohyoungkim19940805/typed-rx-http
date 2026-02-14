type OpenApiPathsLike = object;
interface ServiceArguments<Paths extends OpenApiPathsLike, TPath extends keyof Paths, TMethod extends keyof Paths[TPath] & string, R> {
    url: TPath;
    method: TMethod;
    pathVariable?: Paths[TPath][TMethod] extends {
        parameters: {
            path: infer P;
        };
    } ? P | undefined : Record<string, unknown> | undefined;
    queryString?: Paths[TPath][TMethod] extends {
        parameters: {
            query: infer Q;
        };
    } ? Q | undefined : Record<string, unknown> | undefined;
    body?: Paths[TPath][TMethod] extends {
        requestBody: {
            content: {
                "application/json": infer B;
            };
        };
    } ? B | undefined : unknown;
    /** response.ok 여부와 상관없이 Response를 직접 파싱하고 싶을 때 */
    resultInterceptor?: (response: Response) => Promise<R>;
    /** per-request headers */
    headers?: Readonly<Record<string, string>>;
}
interface CacheForService<CacheName extends string = string> {
    cacheTime: number;
    cacheSize?: number;
    cacheName: CacheName;
}
/** 코어가 던지는 표준 에러 (401 포함) */
declare class HttpResponseError<Args = unknown> extends Error {
    readonly response: Response;
    readonly args: Args;
    readonly data?: unknown | undefined;
    readonly name = "HttpResponseError";
    constructor(response: Response, args: Args, data?: unknown | undefined, message?: string);
    get status(): number;
}
declare const isHttpResponseError: (e: unknown) => e is HttpResponseError<any>;

export { type CacheForService as C, HttpResponseError as H, type OpenApiPathsLike as O, type ServiceArguments as S, isHttpResponseError as i };
