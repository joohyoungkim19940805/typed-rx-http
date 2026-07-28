# @byeolnaerim/typed-rx-http

**Typed, RxJS-based HTTP client for TypeScript**, with optional Next.js and RSocket adapters.

## Highlights

- **Route type safety** by injecting an **OpenAPI-style `Paths` type** (often named `paths`) generated from **Swagger/OpenAPI**, **AsyncAPI-derived contracts**, or any custom schema that matches the same shape.
- All APIs return **RxJS `Observable`**.
- **Core is framework-agnostic** (no Next.js dependency).
- Next.js-only features are exposed via a separate entrypoint: `@byeolnaerim/typed-rx-http/next`  
  → Next.js is required **only** when importing `/next`.
- RSocket features are exposed via a separate entrypoint: `@byeolnaerim/typed-rx-http/rsocket`  
  → RSocket packages are required **only** when importing `/rsocket`.

---

## Installation

### From npm

```bash
npm i @byeolnaerim/typed-rx-http rxjs
```

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

### RSocket adapter (optional)

Install RSocket peer packages only in projects that use this entrypoint.

```bash
npm i rsocket-core rsocket-types rsocket-websocket-client
```

> The RSocket adapter does not require the `buffer` package or a Buffer polyfill. Buffer creation is handled using the implementation selected by `rsocket-core`.

```ts
import { createRSocketApi } from "@byeolnaerim/typed-rx-http/rsocket";

const api = createRSocketApi("ws://localhost:7000/rsocket", jwt);

api.mono<User>("user.findById", { id: 1 }).subscribe((user) => {
	console.log(user);
});

api.stream<Notification>("notification.stream").subscribe((notification) => {
	console.log(notification);
});
```

> Do not import `@byeolnaerim/typed-rx-http/rsocket` in projects that do not use RSocket.

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
	createCsrCache,
	createHeaderStore,
	createHttpClient,
	createSessionAuth,
} from "@byeolnaerim/typed-rx-http";

import type {
	CacheForService,
	ServiceArguments,
} from "@byeolnaerim/typed-rx-http";

import { defer, Observable } from "rxjs";

import { setLogin } from "@ui/handler/hooks/useAccounts";

import type { paths } from "./@types/ApiTypes";

import type { CacheNames } from "./@types/CacheNames";

export const redirectToUnauthorizedOnServer401 = async () => {
	const { headers } = await import("next/headers");
	const { redirect } = await import("next/navigation");

	const h = await headers();
	const pageUrl = h.get("x-page-url") || "/";
	const redirectUri = encodeURIComponent(pageUrl);

	redirect(`/unauthorized?redirect_uri=${redirectUri}&logout=true`);
};

export const headerStore = createHeaderStore({
	"Content-Type": "application/json",
});

const headersProvider = async () => {
	if (typeof window !== "undefined") {
		/**
		 * 라이브러리쪽 코드가
		 * if (headersProvider) return headersProvider();
		 * if (headerStore) return headerStore.get();
		 * 이렇게 되어있음 같이 못씀, 방향자체는 맞음. 라이브러리쪽에서 marge해버리면 csr/ssr 구분못함
		 */
		return headerStore.get();
	}

	const { cookies } = await import("next/headers");

	const cookieStore = await cookies();
	const cookieHeader = cookieStore
		.getAll()
		.map((c) => `${c.name}=${c.value}`)
		.join("; ");

	const authorization = cookieStore.get("Authorization")?.value;
	const accessToken = cookieStore.get("accessToken")?.value;

	return {
		...(cookieHeader ? { Cookie: cookieHeader } : {}),
		...(authorization
			? {
					Authorization: authorization.startsWith("Bearer ")
						? authorization
						: `Bearer ${authorization}`,
				}
			: {}),
		...(!authorization && accessToken
			? {
					Authorization: accessToken.startsWith("Bearer ")
						? accessToken
						: `Bearer ${accessToken}`,
				}
			: {}),
	};
};

export const service = createHttpClient<paths>({
	baseUrl: process.env.NEXT_PUBLIC_API_URL || "",
	onServer401: redirectToUnauthorizedOnServer401,
	defaultErrorMessage: () => {
		return "알 수 없는 오류가 발생했습니다.";
	},
	headerStore,
	headersProvider,
	dropAuthWhenCacheControl: true,
});

const sessionAuth = createSessionAuth({
	headerStore,
	tokenUrl: "/api/auth/token",
	refreshUrl: "/api/auth/token/refresh",
	logoutUrl: "/api/auth/logout",
	onLoginChange: (loggedIn) => {
		if (typeof window !== "undefined") {
			setLogin(loggedIn);
		}
	},
});

export const callApi = <
	R,
	TPath extends keyof paths = keyof paths,
	TMethod extends keyof paths[TPath] & string = keyof paths[TPath] & string,
>(
	serviceArguments: ServiceArguments<paths, TPath, TMethod, R>,
): Observable<R> => {
	return defer(() =>
		service.callApi<R, TPath, TMethod>(serviceArguments),
	).pipe(sessionAuth.withSessionAuth());
};

export const callApiStream = <
	R,
	TPath extends keyof paths = keyof paths,
	TMethod extends keyof paths[TPath] & string = keyof paths[TPath] & string,
>(
	serviceArguments: ServiceArguments<paths, TPath, TMethod, R>,
): Observable<R> => {
	return defer(() =>
		service.callApiStream<R, TPath, TMethod>(serviceArguments),
	).pipe(sessionAuth.withSessionAuth());
};

// CSR cache
const csrCache = createCsrCache<CacheNames>();

export const callApiClientCache = <
	R,
	TPath extends keyof paths = keyof paths,
	TMethod extends keyof paths[TPath] & string = keyof paths[TPath] & string,
>(
	serviceArguments: ServiceArguments<paths, TPath, TMethod, R>,
	cacheForService: CacheForService<CacheNames>,
): Observable<R> => {
	return csrCache.callApiCsrCache(callApi, serviceArguments, cacheForService);
};

export const removeCsrCache = csrCache.removeCsrCache;

export const callApiServerCache = <
	R,
	TPath extends keyof paths = keyof paths,
	TMethod extends keyof paths[TPath] & string = keyof paths[TPath] & string,
>(
	serviceArguments: ServiceArguments<paths, TPath, TMethod, R>,
	cacheForService: CacheForService<CacheNames>,
): Observable<R> => {
	if (typeof window !== "undefined") {
		return callApiClientCache(serviceArguments, cacheForService);
	}

	return new Observable<R>((subscriber) => {
		let closed = false;

		import("@byeolnaerim/typed-rx-http/next")
			.then(({ callApiSsrCache }) => {
				if (closed) {
					return;
				}

				const subscription = callApiSsrCache<paths, R, CacheNames>({
					baseUrl: process.env.NEXT_PUBLIC_API_URL || "",
					serviceArguments: serviceArguments as ServiceArguments<
						paths,
						keyof paths,
						keyof paths[keyof paths] & string,
						R
					>,
					cacheForService,
					headersProvider,
					onServer401: redirectToUnauthorizedOnServer401,
				}).subscribe(subscriber);

				subscriber.add(() => {
					closed = true;
					subscription.unsubscribe();
				});
			})
			.catch((error) => {
				if (!closed) {
					subscriber.error(error);
				}
			});

		return () => {
			closed = true;
		};
	});
};
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


---

## Auto Node Script: OpenAPI/Swagger code generation (optional)

This package also ships Node scripts that generate TypeScript types and service files from an OpenAPI/Swagger JSON document. These scripts are **optional**.

Regular users of `@byeolnaerim/typed-rx-http`, `/next`, or `/rsocket` do not need to run these scripts and do not need to install `openapi-typescript`.

```ts
import {
	connectToSwaggerEventStream,
	generateSwaggerFromHttp,
	generateSwaggerFromFile,
} from "@byeolnaerim/typed-rx-http/auto-node-script/openapi";
```

### Dependency isolation

OpenAPI type generation requires the `openapi-typescript` CLI. However, this package does **not** include `openapi-typescript` in its regular `dependencies`.

The `@byeolnaerim/typed-rx-http` library itself uses TypeScript 6.0.3 in `devDependencies.typescript`. The core `typed-rx-http`, `/next`, and `/rsocket` entry points, as well as the library build, keep using that TypeScript 6.0.3 setup.

However, `openapi-typescript` may still require a specific TypeScript 5.x version. For that reason, only the OpenAPI auto node script runs `openapi-typescript` together with `typescript@5.9.3` in a separate temporary npx execution environment. This does not change the library's `devDependencies.typescript` 6.0.3 and does not use the `typescript` or `openapi-typescript` version installed in the user's project.

By default, the auto script builds and runs this command only during OpenAPI generation:

```bash
npx -y -p openapi-typescript@latest -p typescript@5.9.3 openapi-typescript swagger.json --output ./src/handler/service/@types/ApiTypes.d.ts
```

So the usage itself does not change. You call the same auto node script as before, and only the OpenAPI type generation step uses the isolated TypeScript 5.9.3 environment. Users who do not use the auto script are not tied to `openapi-typescript` or TypeScript 5.9.3 at all.

You can pin or replace the command with `openApiTypescriptCommand`.

```ts
generateSwaggerFromFile({
	inputFile: "./swagger.json",
	openApiTypescriptCommand:
		"npx -y -p openapi-typescript@7.0.0 -p typescript@5.9.3 openapi-typescript ./swagger.json --output ./src/handler/service/@types/ApiTypes.d.ts",
});
```

Or override only the package versions used to build the default command.

```ts
generateSwaggerFromFile({
	inputFile: "./swagger.json",
	openApiTypescriptPackage: "openapi-typescript@7.0.0",
	openApiTypescriptTypescriptPackage: "typescript@5.9.3",
});
```

### Generated files

The default setup generates these files:

```txt
swagger.json
src/handler/service/@types/ApiTypes.d.ts
src/handler/service/auto/*Service.ts
src/handler/service/@types/auto/*Types.ts
src/handler/service/apiUnionArrays.ts
```

`apiUnionArrays.ts` generates readonly constant arrays from OpenAPI schema enums and from `query`, `path`, `header`, and `cookie` parameter enums. It also handles `items.enum` for array query parameters.

### Watch an EventStream

```ts
connectToSwaggerEventStream({
	hostname: "localhost",
	port: 8788,
	path: "/oauth2/for-local/get-swagger",
	serviceDir: "./src/handler/service",
	typesDir: "./src/handler/service/@types",
	commonServiceFile: "./src/handler/service/rxjsHttpService.ts",
});
```

### One-shot HTTP request

```ts
await generateSwaggerFromHttp({
	hostname: "localhost",
	port: 8788,
	path: "/oauth2/for-local/get-swagger",
});
```

### Generate from a local file

```ts
generateSwaggerFromFile({
	inputFile: "./swagger.json",
});
```

---
