import { Observable } from 'rxjs';
import { O as OpenApiPathsLike, S as ServiceArguments, C as CacheForService } from './types-tVxoDKEq.js';

declare const redirectToUnauthorizedOnServer401: () => Promise<void>;

declare const callApiSsrCache: <Paths extends OpenApiPathsLike, R, CacheName extends string = string, TPath extends keyof Paths = keyof Paths, TMethod extends keyof Paths[TPath] & string = keyof Paths[TPath] & string>(opts: {
    baseUrl: string;
    serviceArguments: ServiceArguments<Paths, TPath, TMethod, R>;
    cacheForService: CacheForService<CacheName>;
    /** SSR에서 기본 헤더를 만들고 싶으면(예: 쿠키 Authorization) */
    headersProvider?: () => Promise<Record<string, string>> | Record<string, string>;
    /** 401 redirect 핸들러 */
    onServer401?: () => void | Promise<void>;
}) => Observable<R>;

export { callApiSsrCache, redirectToUnauthorizedOnServer401 };
