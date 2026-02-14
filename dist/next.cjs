'use strict';

var rxjs = require('rxjs');

// src/http-core/next/redirect401.ts
var redirectToUnauthorizedOnServer401 = async () => {
  const { headers } = await import('next/headers');
  const { redirect } = await import('next/navigation');
  const h = await headers();
  const pageUrl = h.get("x-page-url") || "/";
  const redirectUri = encodeURIComponent(pageUrl);
  redirect(`/unauthorized?redirect_uri=${redirectUri}&logout=true`);
};

// src/http-core/types.ts
var HttpResponseError = class extends Error {
  constructor(response, args, data, message) {
    super(message ?? `HTTP ${response.status}`);
    this.response = response;
    this.args = args;
    this.data = data;
    this.name = "HttpResponseError";
  }
  get status() {
    return this.response.status;
  }
};

// src/http-core/utils.ts
var replacePathVariable = (template, record) => {
  return template.replace(/\{(.*?)\}/g, (_, key) => {
    const value = record[key];
    return value != null ? String(encodeURIComponent(value)) : `{${key}}`;
  });
};
var toQueryString = (record) => {
  const qs = Object.entries(record).reduce((query, [key, value]) => {
    if (value == null) return query;
    let pair = "";
    if (Array.isArray(value)) {
      pair = value.map(
        (item) => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`
      ).join("&");
    } else {
      pair = `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
    }
    return query ? `${query}&${pair}` : pair;
  }, "");
  return `?${qs}`;
};
var stableStringify = (obj) => {
  if (!obj) return "{}";
  if (typeof obj !== "object") return JSON.stringify(obj);
  const allKeys = /* @__PURE__ */ new Set();
  JSON.stringify(obj, (k, v) => (allKeys.add(k), v));
  const keys = Array.from(allKeys).sort();
  return JSON.stringify(obj, keys);
};
var joinUrl = (baseUrl, path) => {
  const b = baseUrl.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${b}/${p}`;
};

// src/http-core/next/ssr-cache.ts
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
  return rxjs.from(run());
};

exports.callApiSsrCache = callApiSsrCache;
exports.redirectToUnauthorizedOnServer401 = redirectToUnauthorizedOnServer401;
//# sourceMappingURL=next.cjs.map
//# sourceMappingURL=next.cjs.map