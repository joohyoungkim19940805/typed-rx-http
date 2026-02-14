import { replacePathVariable, toQueryString, joinUrl, stableStringify, HttpResponseError } from './chunk-RL7KIYQL.js';
import { from } from 'rxjs';

// src/http-core/next/redirect401.ts
var redirectToUnauthorizedOnServer401 = async () => {
  const { headers } = await import('next/headers');
  const { redirect } = await import('next/navigation');
  const h = await headers();
  const pageUrl = h.get("x-page-url") || "/";
  const redirectUri = encodeURIComponent(pageUrl);
  redirect(`/unauthorized?redirect_uri=${redirectUri}&logout=true`);
};
var normalizeBodyAndHeaders = (body, headers) => {
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const next = { ...headers };
    delete next["Content-Type"];
    return { body, headers: next };
  }
  if (body != null) return { body: JSON.stringify(body), headers };
  return { body, headers };
};
var parseErrorBody = async (res) => {
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
var callApiSsrCache = (opts) => {
  const run = async () => {
    const {
      baseUrl,
      serviceArguments,
      cacheForService,
      headersProvider,
      onServer401
    } = opts;
    let url = serviceArguments.pathVariable ? replacePathVariable(
      String(serviceArguments.url),
      serviceArguments.pathVariable
    ) : String(serviceArguments.url);
    url = url + (serviceArguments.queryString && toQueryString(serviceArguments.queryString) || "");
    const baseHeaders = headersProvider ? await headersProvider() : {};
    const merged = {
      ...baseHeaders,
      ...serviceArguments.headers || {}
    };
    if (merged["Cache-Control"]) delete merged["Authorization"];
    const { body, headers } = normalizeBodyAndHeaders(
      serviceArguments.body,
      merged
    );
    const fullUrl = joinUrl(baseUrl, url);
    const isGet = String(serviceArguments.method).toUpperCase() === "GET";
    const allowDataCache = isGet && cacheForService.cacheTime > 0;
    const doFetch = async (cacheMode, revalidateSeconds) => {
      const init = {
        method: serviceArguments.method,
        headers,
        body,
        cache: cacheMode
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
          await Promise.resolve(onServer401());
        }
        const data = await parseErrorBody(res);
        if (data && typeof data === "object" && data.resultType)
          throw data;
        throw new HttpResponseError(
          res,
          serviceArguments,
          data,
          data?.message ?? `HTTP ${res.status}`
        );
      }
      return await res.json();
    };
    if (allowDataCache) {
      const { unstable_cache } = await import('next/cache');
      const revalidateSeconds = Math.max(
        1,
        Math.ceil(cacheForService.cacheTime / 1e3)
      );
      const key = cacheForService.cacheName + "=" + String(serviceArguments.method) + String(serviceArguments.url) + stableStringify(serviceArguments.queryString) + stableStringify(serviceArguments.pathVariable) + stableStringify(serviceArguments.body);
      const cached = unstable_cache(
        () => doFetch("force-cache", revalidateSeconds),
        [key],
        {
          revalidate: revalidateSeconds,
          tags: [cacheForService.cacheName]
        }
      );
      return cached();
    }
    return doFetch("no-store");
  };
  return from(run());
};

export { callApiSsrCache, redirectToUnauthorizedOnServer401 };
//# sourceMappingURL=next.js.map
//# sourceMappingURL=next.js.map