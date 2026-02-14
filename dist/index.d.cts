import { Observable, MonoTypeOperatorFunction } from 'rxjs';
import { O as OpenApiPathsLike, S as ServiceArguments, C as CacheForService } from './types-tVxoDKEq.cjs';
export { H as HttpResponseError, i as isHttpResponseError } from './types-tVxoDKEq.cjs';

interface HeaderStore {
    get(): Record<string, string>;
    set(next: Record<string, string>): void;
    merge(next: Record<string, string>): void;
    remove(key: string): void;
    clear(keys?: string[]): void;
}
declare const createHeaderStore: (initial?: Record<string, string>) => HeaderStore;

type HeadersProvider = (() => Record<string, string> | Promise<Record<string, string>>) | undefined;
interface HttpClientOptions {
    baseUrl: string;
    /** CSR에서 defaultHeaders를 쓰고 싶으면 store를 주면 됨(선택) */
    headerStore?: HeaderStore;
    /**
     * SSR/멀티테넌트 등 “요청마다 헤더 계산”이 필요하면 provider로 처리(선택)
     * - Next 쿠키 기반 Authorization도 여기에 넣을 수 있음
     */
    headersProvider?: HeadersProvider;
    /**
     * Cache-Control이 있으면 Authorization 제거하는 기존 동작 유지 여부
     * (Next Data Cache/공유 캐시 사고 방지용으로 쓰던 로직)
     */
    dropAuthWhenCacheControl?: boolean;
    /**
     * SSR에서 401을 redirect 처리하고 싶으면 여기로 주입 (Next adapter에서 제공)
     */
    onServer401?: () => void | Promise<void>;
}
declare const createHttpClient: <Paths extends OpenApiPathsLike>(opts: HttpClientOptions) => {
    callApi: <R, TPath extends keyof Paths = keyof Paths, TMethod extends keyof Paths[TPath] & string = keyof Paths[TPath] & string>(serviceArguments: ServiceArguments<Paths, TPath, TMethod, R>) => Observable<R>;
    callApiStream: <RChunk, TPath_1 extends keyof Paths = keyof Paths, TMethod_1 extends keyof Paths[TPath_1] & string = keyof Paths[TPath_1] & string>(serviceArguments: ServiceArguments<Paths, TPath_1, TMethod_1, RChunk>) => Observable<RChunk>;
    uploadFile: ({ file, url, ifNoneMatch, }: {
        file: File;
        url: string;
        ifNoneMatch?: string;
    }) => Observable<Response>;
    createSSEObservable: <R>(serviceArguments: ServiceArguments<Paths, any, any, any>) => Observable<R>;
};

declare const createCsrCache: <CacheName extends string = string>() => {
    callApiCsrCache: <Paths extends OpenApiPathsLike, R, TPath extends keyof Paths = keyof Paths, TMethod extends keyof Paths[TPath] & string = keyof Paths[TPath] & string>(callApi: (args: ServiceArguments<Paths, TPath, TMethod, R>) => Observable<R>, serviceArguments: ServiceArguments<Paths, TPath, TMethod, R>, cacheForService: CacheForService) => Observable<R>;
    removeCsrCache: {
        (cacheName: CacheName): void;
        (cacheName: string): void;
    };
};

declare function ndjsonStream<T>(body: ReadableStream<Uint8Array>): Observable<T>;

declare const replacePathVariable: (template: string, record: Record<string, string | number | boolean | null | undefined>) => string;
declare const toQueryString: (record: Record<string, string | string[] | number | number[] | boolean | boolean[] | null | undefined>) => string;
declare const stableStringify: (obj: any) => string;
declare const joinUrl: (baseUrl: string, path: string) => string;

interface SessionAuthOptions {
    headerStore: HeaderStore;
    /** setLogin 같은 외부 사이드이펙트 주입 */
    onLoginChange?: (loggedIn: boolean) => void;
    /** 엔드포인트들(프로젝트마다 다르면 바꾸기) */
    tokenUrl?: string;
    refreshUrl?: string;
    logoutUrl?: string;
    /** Authorization 포맷(기본: Bearer) */
    formatAuthorization?: (rawToken: string) => string;
}
declare const createSessionAuth: (opts: SessionAuthOptions) => {
    ensureToken$: () => Observable<string>;
    refreshToken$: () => Observable<string>;
    logout$: () => Observable<any>;
    withSessionAuth: <T>() => MonoTypeOperatorFunction<T>;
    withEnsureToken: <T>() => MonoTypeOperatorFunction<T>;
};

export { CacheForService, type HeaderStore, type HeadersProvider, type HttpClientOptions, OpenApiPathsLike, ServiceArguments, type SessionAuthOptions, createCsrCache, createHeaderStore, createHttpClient, createSessionAuth, joinUrl, ndjsonStream, replacePathVariable, stableStringify, toQueryString };
