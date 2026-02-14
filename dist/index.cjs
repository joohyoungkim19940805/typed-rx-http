'use strict';

var rxjs = require('rxjs');
var fetch = require('rxjs/fetch');

// src/http-core/client.ts

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
var isHttpResponseError = (e) => e instanceof HttpResponseError;
function ndjsonStream(body) {
  return new rxjs.Observable((subscriber) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const read = () => {
      reader.read().then(({ done, value }) => {
        if (done) {
          if (buffer.trim().length > 0) {
            try {
              subscriber.next(JSON.parse(buffer));
            } catch (e) {
              subscriber.error(e);
              return;
            }
          }
          subscriber.complete();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            subscriber.next(JSON.parse(line));
          } catch (e) {
            subscriber.error(e);
            return;
          }
        }
        read();
      }).catch((err) => subscriber.error(err));
    };
    read();
    return () => {
      reader.cancel().catch(() => {
      });
    };
  });
}

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

// src/http-core/client.ts
var defaultErrorMessage = (status) => {
  if (status === 500) {
    return "\uC11C\uBC84\uC5D0\uC11C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD558\uC600\uC2B5\uB2C8\uB2E4.\n\uC815\uC0C1 \uCC98\uB9AC\uB418\uC5C8\uB294\uC9C0 \uD655\uC778 \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC2ED\uC2DC\uC624.";
  }
  return "\uC11C\uBC84\uC5D0\uC11C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD558\uC600\uC2B5\uB2C8\uB2E4.\n\uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC2ED\uC2DC\uC624.";
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
var normalizeBodyAndHeaders = (body, headers) => {
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const next = { ...headers };
    delete next["Content-Type"];
    return { body, headers: next };
  }
  if (body != null) {
    return { body: JSON.stringify(body), headers };
  }
  return { body, headers };
};
var createHttpClient = (opts) => {
  const {
    baseUrl,
    headerStore,
    headersProvider,
    dropAuthWhenCacheControl = true,
    onServer401
  } = opts;
  const getBaseHeaders$ = () => {
    if (headersProvider) return rxjs.from(Promise.resolve(headersProvider()));
    if (headerStore) return rxjs.from(Promise.resolve(headerStore.get()));
    return rxjs.from(Promise.resolve({}));
  };
  const callApi = (serviceArguments) => {
    let url = serviceArguments.pathVariable ? replacePathVariable(
      String(serviceArguments.url),
      serviceArguments.pathVariable
    ) : String(serviceArguments.url);
    url = url + (serviceArguments.queryString && toQueryString(serviceArguments.queryString) || "");
    return getBaseHeaders$().pipe(
      rxjs.concatMap((baseHeaders) => {
        const merged = {
          ...baseHeaders,
          ...serviceArguments.headers || {}
        };
        if (dropAuthWhenCacheControl && merged["Cache-Control"]) {
          delete merged["Authorization"];
        }
        const { body, headers } = normalizeBodyAndHeaders(
          serviceArguments.body,
          merged
        );
        const fullUrl = joinUrl(baseUrl, url);
        return fetch.fromFetch(fullUrl, {
          method: serviceArguments.method,
          body,
          headers
        }).pipe(
          rxjs.switchMap((res) => {
            if (typeof window === "undefined" && res.status === 401 && onServer401) {
              return rxjs.defer(
                () => Promise.resolve(onServer401())
              ).pipe(
                rxjs.switchMap(
                  () => rxjs.throwError(
                    () => new HttpResponseError(
                      res,
                      serviceArguments,
                      void 0
                    )
                  )
                )
              );
            }
            if (serviceArguments.resultInterceptor) {
              return rxjs.from(
                serviceArguments.resultInterceptor(res)
              );
            }
            if (!res.ok) {
              return rxjs.from(parseErrorBody(res)).pipe(
                rxjs.switchMap((data) => {
                  if (data && typeof data === "object" && data.resultType) {
                    return rxjs.throwError(() => data);
                  }
                  const msg = data?.message ?? defaultErrorMessage(res.status);
                  return rxjs.throwError(
                    () => new HttpResponseError(
                      res,
                      serviceArguments,
                      data,
                      msg
                    )
                  );
                })
              );
            }
            return rxjs.from(res.json());
          }),
          rxjs.catchError((err) => {
            if (err instanceof HttpResponseError) {
              return rxjs.throwError(() => err);
            }
            if (err instanceof Error) {
              return rxjs.throwError(() => ({
                message: err.message,
                stack: err.stack
              }));
            }
            return rxjs.throwError(() => err);
          })
        );
      })
    );
  };
  const callApiStream = (serviceArguments) => {
    let url = serviceArguments.pathVariable ? replacePathVariable(
      String(serviceArguments.url),
      serviceArguments.pathVariable
    ) : String(serviceArguments.url);
    url = url + (serviceArguments.queryString && toQueryString(serviceArguments.queryString) || "");
    return getBaseHeaders$().pipe(
      rxjs.concatMap((baseHeaders) => {
        const merged = {
          ...baseHeaders,
          ...serviceArguments.headers || {}
        };
        if (!merged["Accept"]) {
          merged["Accept"] = "application/x-ndjson";
        }
        if (dropAuthWhenCacheControl && merged["Cache-Control"]) {
          delete merged["Authorization"];
        }
        const { body, headers } = normalizeBodyAndHeaders(
          serviceArguments.body,
          merged
        );
        const fullUrl = joinUrl(baseUrl, url);
        return fetch.fromFetch(fullUrl, {
          method: serviceArguments.method,
          body,
          headers
        }).pipe(
          rxjs.switchMap((res) => {
            if (typeof window === "undefined" && res.status === 401 && onServer401) {
              return rxjs.defer(
                () => Promise.resolve(onServer401())
              ).pipe(
                rxjs.switchMap(
                  () => rxjs.throwError(
                    () => new HttpResponseError(
                      res,
                      serviceArguments,
                      void 0
                    )
                  )
                )
              );
            }
            if (!res.ok) {
              return rxjs.from(parseErrorBody(res)).pipe(
                rxjs.switchMap((data) => {
                  if (data && typeof data === "object" && data.resultType) {
                    return rxjs.throwError(() => data);
                  }
                  const msg = data?.message ?? defaultErrorMessage(res.status);
                  return rxjs.throwError(
                    () => new HttpResponseError(
                      res,
                      serviceArguments,
                      data,
                      msg
                    )
                  );
                })
              );
            }
            if (!res.body) {
              return rxjs.throwError(
                () => new Error("ReadableStream body is null")
              );
            }
            return ndjsonStream(res.body);
          })
        );
      })
    );
  };
  const uploadFile = ({
    file,
    url,
    ifNoneMatch
  }) => {
    const headers = {
      "Content-Encoding": "base64",
      "Content-Type": "application/octet-stream"
    };
    if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
    return fetch.fromFetch(url, { method: "PUT", body: file, headers });
  };
  const createSSEObservable = (serviceArguments) => {
    let url = serviceArguments.pathVariable ? replacePathVariable(
      String(serviceArguments.url),
      serviceArguments.pathVariable
    ) : String(serviceArguments.url);
    url = url + (serviceArguments.queryString && toQueryString(serviceArguments.queryString) || "");
    return new rxjs.Observable((observer) => {
      const eventSource = new EventSource(joinUrl(baseUrl, url), {
        withCredentials: false
      });
      eventSource.onmessage = (event) => {
        observer.next(JSON.parse(event.data));
      };
      eventSource.onerror = () => {
        observer.complete();
        eventSource.close();
      };
      return () => eventSource.close();
    });
  };
  return { callApi, callApiStream, uploadFile, createSSEObservable };
};

// src/http-core/headers.ts
var createHeaderStore = (initial = { "Content-Type": "application/json" }) => {
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
    }
  };
};
var createCsrCache = () => {
  const cacheMap = typeof window !== "undefined" ? {} : null;
  function removeCsrCache(cacheName) {
    if (!cacheMap) return;
    Object.keys(cacheMap).forEach((key) => {
      if (key.startsWith(cacheName)) delete cacheMap[key];
    });
  }
  const callApiCsrCache = (callApi, serviceArguments, cacheForService) => {
    if (typeof window === "undefined" || cacheMap == null) {
      return callApi(serviceArguments);
    }
    const cacheKey = cacheForService.cacheName + "=" + String(serviceArguments.method) + String(serviceArguments.url) + stableStringify(serviceArguments.queryString) + stableStringify(serviceArguments.pathVariable) + stableStringify(serviceArguments.body);
    let subject = cacheMap[cacheKey];
    if (!subject) {
      const shared$ = callApi(serviceArguments).pipe(
        rxjs.shareReplay({
          bufferSize: cacheForService.cacheSize ?? 1,
          windowTime: cacheForService.cacheTime,
          refCount: false
        })
      );
      subject = new rxjs.BehaviorSubject(shared$);
      cacheMap[cacheKey] = subject;
    }
    return subject.pipe(
      rxjs.switchMap((s) => s),
      rxjs.take(1)
    );
  };
  return { callApiCsrCache, removeCsrCache };
};
var createSessionAuth = (opts) => {
  const {
    headerStore,
    onLoginChange,
    tokenUrl = "/api/auth/token",
    refreshUrl = "/api/auth/token/refresh",
    logoutUrl = "/api/auth/logout",
    formatAuthorization = (t) => t.startsWith("Bearer ") ? t : `Bearer ${t}`
  } = opts;
  let inFlightToken$ = null;
  let inFlightLogout$ = null;
  const setAuth = (rawToken) => {
    if (rawToken) {
      headerStore.merge({ Authorization: formatAuthorization(rawToken) });
      onLoginChange?.(true);
    } else {
      headerStore.remove("Authorization");
      onLoginChange?.(false);
    }
  };
  const getCurrentAuthHeader = () => {
    const h = headerStore.get();
    const v = h["Authorization"];
    return v && v.trim() ? v : "";
  };
  const fetchToken$ = () => {
    return fetch.fromFetch(tokenUrl).pipe(
      rxjs.switchMap((res) => {
        if (!res.ok) return Promise.reject(res);
        return res.json();
      }),
      rxjs.map((json) => json.token ?? ""),
      rxjs.tap((token) => setAuth(token)),
      rxjs.catchError((err) => {
        console.error(err);
        setAuth("");
        return rxjs.of("");
      }),
      rxjs.finalize(() => {
        inFlightToken$ = null;
      }),
      rxjs.shareReplay({ bufferSize: 1, refCount: false })
    );
  };
  const ensureToken$ = () => {
    const cur = getCurrentAuthHeader();
    if (cur) return rxjs.of(cur);
    if (!inFlightToken$) {
      inFlightToken$ = fetchToken$();
    }
    return inFlightToken$;
  };
  const refreshToken$ = () => {
    return ensureToken$().pipe(
      rxjs.switchMap((authHeader) => {
        if (!authHeader) {
          setAuth("");
          return rxjs.of("");
        }
        return fetch.fromFetch(refreshUrl, {
          headers: { Authorization: authHeader }
        }).pipe(
          rxjs.switchMap((res) => {
            if (!res.ok) return Promise.reject(res);
            return res.json();
          }),
          rxjs.map((json) => json.token ?? ""),
          rxjs.tap((token) => setAuth(token)),
          rxjs.catchError((err) => {
            console.error(err);
            setAuth("");
            return rxjs.of("");
          })
        );
      })
    );
  };
  const sharedLogout$ = () => {
    if (!inFlightLogout$) {
      inFlightLogout$ = fetch.fromFetch(logoutUrl).pipe(
        rxjs.tap(() => setAuth("")),
        rxjs.finalize(() => {
          inFlightLogout$ = null;
        }),
        rxjs.shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return inFlightLogout$;
  };
  const withSessionAuth = () => {
    return (source) => rxjs.defer(
      () => ensureToken$().pipe(
        rxjs.switchMap(() => source),
        rxjs.catchError((err) => {
          if (isHttpResponseError(err) && err.status === 401) {
            return refreshToken$().pipe(
              rxjs.switchMap((newToken) => {
                if (!newToken) {
                  return sharedLogout$().pipe(
                    rxjs.switchMap(
                      () => rxjs.throwError(() => err)
                    )
                  );
                }
                return source;
              }),
              rxjs.catchError(
                () => sharedLogout$().pipe(
                  rxjs.switchMap(() => rxjs.throwError(() => err))
                )
              )
            );
          }
          return rxjs.throwError(() => err);
        })
      )
    );
  };
  const withEnsureToken = () => {
    return (source) => rxjs.defer(() => ensureToken$().pipe(rxjs.switchMap(() => source)));
  };
  return {
    ensureToken$,
    refreshToken$,
    logout$: sharedLogout$,
    withSessionAuth,
    withEnsureToken
  };
};

exports.HttpResponseError = HttpResponseError;
exports.createCsrCache = createCsrCache;
exports.createHeaderStore = createHeaderStore;
exports.createHttpClient = createHttpClient;
exports.createSessionAuth = createSessionAuth;
exports.isHttpResponseError = isHttpResponseError;
exports.joinUrl = joinUrl;
exports.ndjsonStream = ndjsonStream;
exports.replacePathVariable = replacePathVariable;
exports.stableStringify = stableStringify;
exports.toQueryString = toQueryString;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map