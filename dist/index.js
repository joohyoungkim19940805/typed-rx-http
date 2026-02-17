import { stableStringify, replacePathVariable, toQueryString, joinUrl, HttpResponseError, isHttpResponseError } from './chunk-RL7KIYQL.js';
export { HttpResponseError, isHttpResponseError, joinUrl, replacePathVariable, stableStringify, toQueryString } from './chunk-RL7KIYQL.js';
import { Observable, shareReplay, BehaviorSubject, switchMap, take, concatMap, defer, throwError, from, catchError, of, map, tap, finalize } from 'rxjs';
import { fromFetch } from 'rxjs/fetch';

function ndjsonStream(body) {
  return new Observable((subscriber) => {
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

// src/http-core/client.ts
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
    onServer401,
    defaultErrorMessage: defaultErrorMessageResolver
  } = opts;
  const getBaseHeaders$ = () => {
    if (headersProvider) return from(Promise.resolve(headersProvider()));
    if (headerStore) return from(Promise.resolve(headerStore.get()));
    return from(Promise.resolve({}));
  };
  const resolveErrorMessage = (res, data) => {
    const apiMsg = data?.message;
    if (typeof apiMsg === "string" && apiMsg.length > 0) return apiMsg;
    if (defaultErrorMessageResolver) {
      return defaultErrorMessageResolver({
        status: res.status,
        res,
        data
      });
    }
    return `HTTP ERROR${res.status} / ${res.statusText}
${JSON.stringify(data)}`;
  };
  const callApi = (serviceArguments) => {
    let url = serviceArguments.pathVariable ? replacePathVariable(
      String(serviceArguments.url),
      serviceArguments.pathVariable
    ) : String(serviceArguments.url);
    url = url + (serviceArguments.queryString && toQueryString(serviceArguments.queryString) || "");
    return getBaseHeaders$().pipe(
      concatMap((baseHeaders) => {
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
        return fromFetch(fullUrl, {
          method: serviceArguments.method,
          body,
          headers
        }).pipe(
          switchMap((res) => {
            if (typeof window === "undefined" && res.status === 401 && onServer401) {
              return defer(
                () => Promise.resolve(onServer401())
              ).pipe(
                switchMap(
                  () => throwError(
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
              return from(
                serviceArguments.resultInterceptor(res)
              );
            }
            if (!res.ok) {
              return from(parseErrorBody(res)).pipe(
                switchMap((data) => {
                  if (data && typeof data === "object" && data.resultType) {
                    return throwError(() => data);
                  }
                  const msg = resolveErrorMessage(res, data);
                  return throwError(
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
            return from(res.json());
          }),
          catchError((err) => {
            if (err instanceof HttpResponseError) {
              return throwError(() => err);
            }
            if (err instanceof Error) {
              return throwError(() => ({
                message: err.message,
                stack: err.stack
              }));
            }
            return throwError(() => err);
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
      concatMap((baseHeaders) => {
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
        return fromFetch(fullUrl, {
          method: serviceArguments.method,
          body,
          headers
        }).pipe(
          switchMap((res) => {
            if (typeof window === "undefined" && res.status === 401 && onServer401) {
              return defer(
                () => Promise.resolve(onServer401())
              ).pipe(
                switchMap(
                  () => throwError(
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
              return from(parseErrorBody(res)).pipe(
                switchMap((data) => {
                  if (data && typeof data === "object" && data.resultType) {
                    return throwError(() => data);
                  }
                  const msg = resolveErrorMessage(res, data);
                  return throwError(
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
              return throwError(
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
    ifNoneMatch,
    headers
  }) => {
    ({
      ...headers || {}
    });
    return fromFetch(url, { method: "PUT", body: file, headers });
  };
  const createSSEObservable = (serviceArguments) => {
    let url = serviceArguments.pathVariable ? replacePathVariable(
      String(serviceArguments.url),
      serviceArguments.pathVariable
    ) : String(serviceArguments.url);
    url = url + (serviceArguments.queryString && toQueryString(serviceArguments.queryString) || "");
    return new Observable((observer) => {
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
        shareReplay({
          bufferSize: cacheForService.cacheSize ?? 1,
          windowTime: cacheForService.cacheTime,
          refCount: false
        })
      );
      subject = new BehaviorSubject(shared$);
      cacheMap[cacheKey] = subject;
    }
    return subject.pipe(
      switchMap((s) => s),
      take(1)
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
    return fromFetch(tokenUrl).pipe(
      switchMap((res) => {
        if (!res.ok) return Promise.reject(res);
        return res.json();
      }),
      map((json) => json.token ?? ""),
      tap((token) => setAuth(token)),
      catchError((err) => {
        console.error(err);
        setAuth("");
        return of("");
      }),
      finalize(() => {
        inFlightToken$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
  };
  const ensureToken$ = () => {
    const cur = getCurrentAuthHeader();
    if (cur) return of(cur);
    if (!inFlightToken$) {
      inFlightToken$ = fetchToken$();
    }
    return inFlightToken$;
  };
  const refreshToken$ = () => {
    return ensureToken$().pipe(
      switchMap((authHeader) => {
        if (!authHeader) {
          setAuth("");
          return of("");
        }
        return fromFetch(refreshUrl, {
          headers: { Authorization: authHeader }
        }).pipe(
          switchMap((res) => {
            if (!res.ok) return Promise.reject(res);
            return res.json();
          }),
          map((json) => json.token ?? ""),
          tap((token) => setAuth(token)),
          catchError((err) => {
            console.error(err);
            setAuth("");
            return of("");
          })
        );
      })
    );
  };
  const sharedLogout$ = () => {
    if (!inFlightLogout$) {
      inFlightLogout$ = fromFetch(logoutUrl).pipe(
        tap(() => setAuth("")),
        finalize(() => {
          inFlightLogout$ = null;
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return inFlightLogout$;
  };
  const withSessionAuth = () => {
    return (source) => defer(
      () => ensureToken$().pipe(
        switchMap(() => source),
        catchError((err) => {
          if (isHttpResponseError(err) && err.status === 401) {
            return refreshToken$().pipe(
              switchMap((newToken) => {
                if (!newToken) {
                  return sharedLogout$().pipe(
                    switchMap(
                      () => throwError(() => err)
                    )
                  );
                }
                return source;
              }),
              catchError(
                () => sharedLogout$().pipe(
                  switchMap(() => throwError(() => err))
                )
              )
            );
          }
          return throwError(() => err);
        })
      )
    );
  };
  const withEnsureToken = () => {
    return (source) => defer(() => ensureToken$().pipe(switchMap(() => source)));
  };
  return {
    ensureToken$,
    refreshToken$,
    logout$: sharedLogout$,
    withSessionAuth,
    withEnsureToken
  };
};

export { createCsrCache, createHeaderStore, createHttpClient, createSessionAuth, ndjsonStream };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map