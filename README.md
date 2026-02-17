# @byeolnaerim/typed-rx-http

**Typed, RxJS-based HTTP client for TypeScript**, with an optional Next.js adapter.

## Highlights

- **Route type safety** by injecting an **OpenAPI-style `Paths` type** (often named `paths`) generated from **Swagger/OpenAPI**, **AsyncAPI-derived contracts**, or any custom schema that matches the same shape.
- All APIs return **RxJS `Observable`**.
- **Core is framework-agnostic** (no Next.js dependency).
- Next.js-only features are exposed via a separate entrypoint: `@byeolnaerim/typed-rx-http/next`  
  → Next.js is required **only** when importing `/next`.

---

## Installation

### From npm

```bash
npm i @byeolnaerim/typed-rx-http rxjs
```

---

## Entry points

### Core (framework-agnostic)

```ts
import {
	createHttpClient,
	createHeaderStore,
	createCsrCache,
	createSessionAuth,
	createCommonService,
	HttpResponseError,
	isHttpResponseError,
	type ServiceArguments,
	type CacheForService,
} from "@byeolnaerim/typed-rx-http";
```

### Next.js adapter (optional)

```ts
import {
	callApiSsrCache,
	redirectToUnauthorizedOnServer401,
} from "@byeolnaerim/typed-rx-http/next";
```

> Do not import `@byeolnaerim/typed-rx-http/next` in non-Next projects.

---

## Core usage

### 1) Provide a `Paths` type (often called OpenAPI `paths`)

`createHttpClient<Paths>()` expects a type that represents your **route contract**.  
In this README we call it `paths` because that’s the common convention, but **it doesn’t have to come from OpenAPI/Swagger, and it doesn’t have to be literally named `paths`.**

However, core is constrained by `OpenApiPathsLike`, so `Paths` must be **compatible with the OpenAPI `paths` shape**:

- top-level keys: URL path strings (e.g. `"/users/{id}"`)
- nested keys: HTTP methods (`get`/`post`/`put`/`delete`/`patch` …)
- each method contains fields like `parameters.query/path/header/cookie`, `requestBody`, `responses` (or `never`)

Core builds `ServiceArguments` types by looking at fields in this structure, primarily:

- `url`: `keyof Paths`
- `method`: `keyof Paths[url]`
- `queryString`: `parameters.query`
- `pathVariable`: `parameters.path`
- `body`: `requestBody`

Example (typical `openapi-typescript` output, abbreviated):

```ts
export interface paths {
	"/test/get-hello-world": {
		parameters: {
			query?: never;
			header?: never;
			path?: never;
			cookie?: never;
		};
		get: {
			parameters: {
				query?: never;
				header?: never;
				path?: never;
				cookie?: never;
			};
			requestBody?: never;
			responses: {
				200: {
					content: {
						"application/json": components["schemas"]["TestResponse"];
					};
				};
			};
		};
	};
}
```

> Even without OpenAPI, you can still use this library by defining (or mapping) your own types into a **compatible shape**.

```ts
// aliasing: OpenAPI `paths` -> `Paths`
import type { paths as Paths } from "./@types/ApiTypes";
```

### 2) Create a header store

`HeaderStore` is a small in-memory store to manage default headers (useful for CSR/session auth).

```ts
import { createHeaderStore } from "@byeolnaerim/typed-rx-http";

export const headerStore = createHeaderStore({
	"Content-Type": "application/json",
});
```

### 3) Create an HTTP client

- `headerStore` is optional (but recommended for CSR).
- `headersProvider` is for SSR/multi-tenant environments where headers must be computed per request.

```ts
import { createHttpClient } from "@byeolnaerim/typed-rx-http";
import type { paths as Paths } from "./@types/ApiTypes";

const apiUrl = process.env.NEXT_PUBLIC_API_URL!;

export const client = createHttpClient<Paths>({
	baseUrl: apiUrl,
	headerStore,
});
```

### 4) Call APIs (typed)

Request typing (URL/method/pathVariable/queryString/body) comes from the **type you inject into `createHttpClient<Paths>()`** (commonly OpenAPI `paths`).  
Response typing is chosen by the caller via the generic `R` (`callApi<R>()`; core does not infer from `responses`).

```ts
export const getAdminList = () => {
	return client.callApi<{ items: any[]; total: number }>({
		url: "/api/account/search/admin/get-list",
		method: "get",
		queryString: { pageNumber: 1, pageSize: 20 },
	});
};
```

---

## Optional response wrapper

This library does **not** force a response wrapper. Use generics to choose a response shape per endpoint.

### Wrapped response

```ts
type ResponseWrapper<T> = { data: T; message?: string; resultType?: string };

export const bidCreate = (body: unknown) => {
	return client.callApi<ResponseWrapper<{ requestId: string }>>({
		url: "/api/bid/create/bid/request",
		method: "post",
		body,
	});
};
```

### Unwrapped response

```ts
export const bidCreate = (body: unknown) => {
	return client.callApi<{ requestId: string }>({
		url: "/api/bid/create/bid/request",
		method: "post",
		body,
	});
};
```

---

## Streaming (NDJSON)

Use `callApiStream` for NDJSON responses (one JSON per line).  
If `Accept` is missing, it defaults to `application/x-ndjson`.

```ts
export const streamEvents = () => {
	return client.callApiStream<{ eventName: string; content: unknown }>({
		url: "/api/event/stream",
		method: "get",
		// headers: { Accept: "application/x-ndjson" }, // optional
	});
};
```

---

## CSR cache (client-side cache)

`createCsrCache<CacheName>()` provides:

- `callApiCsrCache(callApiFn, serviceArgs, cacheOptions)`
- `removeCsrCache(cacheName)` — supports both typed names and raw strings

```ts
import { createCsrCache } from "@byeolnaerim/typed-rx-http";
import type { paths as Paths } from "./@types/ApiTypes";

type CacheNames = "adminList" | "profile";

const csrCache = createCsrCache<CacheNames>();

export const callApiClientCache = <R>(
	args: ServiceArguments<Paths, any, any, R>,
	cache: { cacheName: CacheNames; cacheTime: number; cacheSize?: number },
) => csrCache.callApiCsrCache(client.callApi, args as any, cache as any);

csrCache.removeCsrCache("adminList"); // typed
csrCache.removeCsrCache("any-prefix"); // string
```

---

## Session auth plugin (optional)

`createSessionAuth` is a **pluggable** session-based auth layer:

- Stores `Authorization` in `headerStore`
- `ensureToken$()` syncs token from `tokenUrl` if missing
- On `401`, refreshes once (`refreshUrl`) and retries the original observable
- If refresh fails, calls `logoutUrl` then rethrows

```ts
import { createSessionAuth } from "@byeolnaerim/typed-rx-http";

const auth = createSessionAuth({
	headerStore,
	onLoginChange: (loggedIn) => {
		// connect your UI/app state here (optional)
	},
	// tokenUrl / refreshUrl / logoutUrl can be customized
});

// attach per-call
export const secureCall = () => {
	return client
		.callApi<{ ok: true }>({ url: "/api/secure", method: "get" })
		.pipe(auth.withSessionAuth());
};
```

If only token synchronization is needed (without refresh/retry):

```ts
return client.callApi(...).pipe(auth.withEnsureToken());
```

---

## Error handling

For non-2xx, core throws `HttpResponseError` (includes `status`, `response`, `args`, `data`).

Legacy compatibility behavior:

- If the parsed error body is an object containing `resultType`, that object is thrown as-is.

```ts
import { isHttpResponseError } from "@byeolnaerim/typed-rx-http";

client.callApi(...).subscribe({
  error: (e) => {
    if (isHttpResponseError(e)) {
      console.log(e.status, e.data);
    }
  },
});
```

---

## Next.js adapter (`/next`)

### redirectToUnauthorizedOnServer401

`redirectToUnauthorizedOnServer401` is a **convenience default implementation** for Next.js (App Router) SSR that runs when a `401` happens.

```ts
import { redirectToUnauthorizedOnServer401 } from "@byeolnaerim/typed-rx-http/next";
```

Hard-coded behavior:

- redirects to `/unauthorized`
- query string: `redirect_uri=<current page>` + `logout=true`
- “current page” is read from the `x-page-url` header (fallback: `/`)

Use it only if your project follows the same route/query conventions.  
If your app uses a different route/params, **implement your own `onServer401` and inject it**:

```ts
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const onServer401 = async () => {
	const h = await headers();
	const pageUrl = h.get("x-page-url") || "/";
	redirect(`/login?next=${encodeURIComponent(pageUrl)}`);
};
```

### callApiSsrCache

A Next-only SSR helper built on `next/cache` (`unstable_cache`).

- `GET` + `cacheTime > 0` → `force-cache` with `revalidate`
- otherwise → `no-store`
- `headersProvider` injects per-request `Cookie` / `Authorization`
- on `401`, runs `onServer401` if provided (typically calls `redirect()`)

```ts
import type { paths as Paths } from "./@types/ApiTypes";
import { firstValueFrom } from "rxjs";
import {
	callApiSsrCache,
	redirectToUnauthorizedOnServer401,
} from "@byeolnaerim/typed-rx-http/next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL!;

const headersProvider = async () => {
	const { cookies } = await import("next/headers");
	const cookieStore = await cookies();

	const cookieHeader = cookieStore
		.getAll()
		.map((c) => `${c.name}=${c.value}`)
		.join("; ");

	const accessToken = cookieStore.get("accessToken")?.value;

	return {
		...(cookieHeader ? { Cookie: cookieHeader } : {}),
		...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
	};
};

const obs$ = callApiSsrCache<Paths, { ok: true }, "adminList">({
	baseUrl: apiUrl,
	serviceArguments: { url: "/api/secure", method: "get" },
	cacheForService: { cacheName: "adminList", cacheTime: 10_000 },
	headersProvider,
	onServer401: redirectToUnauthorizedOnServer401,
});

const res = await firstValueFrom(obs$);
```

---

## Full Next.js integration example

This example matches the common pattern: core client + CSR cache + SSR cache helper.

```ts
import {
	type CacheForService,
	createCsrCache,
	createHeaderStore,
	createHttpClient,
	type ServiceArguments,
} from "@byeolnaerim/typed-rx-http";
import {
	callApiSsrCache,
	redirectToUnauthorizedOnServer401,
} from "@byeolnaerim/typed-rx-http/next";

import type { paths as Paths } from "./@types/ApiTypes";
import type { CacheNames } from "./@types/CacheNames";
import { cookies } from "next/headers";

const apiUrl = process.env.NEXT_PUBLIC_API_URL!;

export const headerStore = createHeaderStore();

export const service = createHttpClient<Paths>({
	baseUrl: apiUrl,
	headerStore,
	onServer401: redirectToUnauthorizedOnServer401,
});

export const callApi = service.callApi;
export const callApiStream = service.callApiStream;

// CSR cache
const csrCache = createCsrCache<CacheNames>();
export const callApiClientCache = csrCache.callApiCsrCache;
export const removeCsrCache = csrCache.removeCsrCache;

// SSR headers provider
const headersProvider = async () => {
	const cookieStore = await cookies();
	const cookieHeader = cookieStore
		.getAll()
		.map((c) => `${c.name}=${c.value}`)
		.join("; ");

	const accessToken = cookieStore.get("accessToken")?.value;

	return {
		...(cookieHeader ? { Cookie: cookieHeader } : {}),
		...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
	};
};

export function callApiServerCache<R>(
	serviceArguments: ServiceArguments<Paths, any, any, R>,
	cacheForService: CacheForService<CacheNames>,
) {
	return callApiSsrCache<Paths, R, CacheNames>({
		baseUrl: apiUrl,
		serviceArguments,
		cacheForService,
		headersProvider,
		onServer401: redirectToUnauthorizedOnServer401,
	});
}
```

---

## API reference (core)

### createHttpClient<Paths>(options)

Returns:

- `callApi<R>(args): Observable<R>`
- `callApiStream<RChunk>(args): Observable<RChunk>`
- `uploadFile({ file, url, ifNoneMatch?, headers? }): Observable<Response>`
- `createSSEObservable<R>(args): Observable<R>`

Options:

- `baseUrl: string`
- `headerStore?: HeaderStore`
- `headersProvider?: () => Record<string, string> | Promise<Record<string, string>>`
- `dropAuthWhenCacheControl?: boolean` (default: `true`)
- `onServer401?: () => void | Promise<void>`

### createHeaderStore(initial?)

- `get()`, `set()`, `merge()`, `remove()`, `clear()`

### createCsrCache<CacheName>()

- `callApiCsrCache(callApiFn, serviceArgs, cacheForService)`
- `removeCsrCache(cacheName)` (typed + string)

### createSessionAuth(options)

- `withSessionAuth()`, `withEnsureToken()`
- `ensureToken$()`, `refreshToken$()`, `logout$()`

---

## Runtime requirements

- Relies on `fetch` (`rxjs/fetch`) and `Response` APIs.
- Streaming uses `ReadableStream` + `TextDecoder` (for NDJSON).
- SSE uses `EventSource`.

Most modern browsers and Next.js runtimes provide these. For custom Node runtimes, polyfills may be required.
