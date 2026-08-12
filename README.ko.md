# @byeolnaerim/typed-rx-http

TypeScript용 **RxJS 기반 타입 세이프 HTTP 클라이언트** + (선택) Next.js/RSocket 어댑터.

## 핵심 특징

- Swagger/OpenAPI / AsyncAPI 파생 스키마 / 커스텀 계약 등으로부터 얻은 **OpenAPI-style `Paths` 타입**(관례상 `paths`)을 주입해 **라우트(요청) 타입 안정성**을 확보
- 모든 API는 **RxJS `Observable`** 반환
- **core는 프레임워크 독립** (Next.js 의존 없음)
- Next.js 전용 기능은 `@byeolnaerim/typed-rx-http/next` 엔트리포인트로 분리  
  → `/next`를 import할 때만 Next.js가 필요
- RSocket 전용 기능은 `@byeolnaerim/typed-rx-http/rsocket` 엔트리포인트로 분리  
  → `/rsocket`을 import할 때만 RSocket 패키지가 필요

---

## 설치

### npm

```bash
npm i @byeolnaerim/typed-rx-http rxjs
```

## 엔트리포인트

### Core (프레임워크 독립)

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

### Next.js 어댑터(선택)

```ts
import {
	callApiSsrCache,
	redirectToUnauthorizedOnServer401,
} from "@byeolnaerim/typed-rx-http/next";
```

> Next.js를 사용하지 않는 프로젝트에서는 `/next`를 import하지 마세요.

### RSocket 어댑터(선택)

RSocket을 쓰는 프로젝트에서만 peer 패키지를 설치하세요.

```bash
npm i rsocket-core rsocket-types rsocket-websocket-client
```

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

> RSocket을 사용하지 않는 프로젝트에서는 `/rsocket`을 import하지 마세요.

---

## Core 사용법

### 1) `Paths` 타입 준비 (보통은 OpenAPI `paths`)

`createHttpClient<Paths>()`의 `Paths`는 “요청 스펙(라우트)”을 표현하는 타입입니다.  
문서에서는 관례상 `paths`라고 부르지만, **꼭 OpenAPI/Swagger일 필요도, 이름이 `paths`일 필요도 없습니다.**

다만 코어는 내부적으로 `OpenApiPathsLike` 제약을 사용하므로, `Paths`는 아래처럼 **OpenAPI `paths`와 유사한 형태**여야 합니다.

- 최상위 키: URL 경로 문자열(예: `"/users/{id}"`)
- 하위 키: HTTP method (`get`/`post`/`put`/`delete`/`patch` …)
- 각 method 안에 `parameters.query/path/header/cookie`, `requestBody`, `responses` 같은 필드가 존재(또는 `never`)

코어는 위 구조에서 주로 아래 필드를 참조해 `ServiceArguments`의 타입을 구성합니다.

- `url`: `keyof Paths`
- `method`: `keyof Paths[url]`
- `queryString`: `parameters.query`
- `pathVariable`: `parameters.path`
- `body`: `requestBody`

예: `openapi-typescript` 출력물은 보통 아래와 같은 규격입니다(일부 축약).

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

> OpenAPI가 아니더라도, 위와 **호환되는 형태**로 타입을 정의(또는 변환 타입을 만들어 매핑)하면 그대로 사용할 수 있습니다.

```ts
// aliasing: OpenAPI `paths` -> `Paths`
import type { paths as Paths } from "./@types/ApiTypes";
```

### 2) HeaderStore 생성

`HeaderStore`는 CSR에서 기본 헤더를 관리하기 위한 간단한 in-memory store입니다.

```ts
import { createHeaderStore } from "@byeolnaerim/typed-rx-http";

export const headerStore = createHeaderStore({
	"Content-Type": "application/json",
});
```

### 3) HTTP client 생성

- `headerStore`는 선택이지만, CSR에서 기본 헤더/세션 인증을 사용하려면 넣는 것을 권장합니다.
- `headersProvider`는 SSR/멀티테넌트처럼 “요청마다 헤더 계산”이 필요할 때 사용합니다.

```ts
import { createHttpClient } from "@byeolnaerim/typed-rx-http";
import type { paths as Paths } from "./@types/ApiTypes";

const apiUrl = process.env.NEXT_PUBLIC_API_URL!;

export const client = createHttpClient<Paths>({
	baseUrl: apiUrl,
	headerStore,
});
```

### 4) API 호출 (타입 세이프)

요청 타입(url/method/pathVariable/queryString/body)은 **사용자가 `createHttpClient<Paths>()`에 주입한 타입**(관례상 OpenAPI `paths`)으로부터 결정됩니다.  
응답 타입은 `callApi<R>()`에서 호출자가 제너릭 `R`로 선택합니다(코어가 `responses`에서 자동 추론하지 않습니다).

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

## 응답 래핑(ResponseWrapper) — 선택

이 라이브러리는 **응답 래핑을 강제하지 않습니다.**  
API별로 제너릭으로 응답 형태를 선택하면 됩니다.

### 래핑된 응답

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

### 래핑 없는 응답

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

## 스트리밍 (NDJSON)

서버가 NDJSON(한 줄에 JSON 하나)을 내려줄 때 `callApiStream`을 사용합니다.  
`Accept` 헤더가 없으면 기본값으로 `application/x-ndjson`가 설정됩니다.

```ts
export const streamEvents = () => {
	return client.callApiStream<{ eventName: string; content: unknown }>({
		url: "/api/event/stream",
		method: "get",
		// headers: { Accept: "application/x-ndjson" }, // 선택
	});
};
```

---

## CSR 캐시 (클라이언트 캐시)

`createCsrCache<CacheName>()`가 제공하는 기능:

- `callApiCsrCache(callApiFn, serviceArgs, cacheOptions)`
- `removeCsrCache(cacheName)` — 타입 캐시명 + 문자열 모두 지원

```ts
import { createCsrCache } from "@byeolnaerim/typed-rx-http";
import type { paths as Paths } from "./@types/ApiTypes";

type CacheNames = "adminList" | "profile";

const csrCache = createCsrCache<CacheNames>();

export const callApiClientCache = <R>(
	args: ServiceArguments<Paths, any, any, R>,
	cache: { cacheName: CacheNames; cacheTime: number; cacheSize?: number },
) => csrCache.callApiCsrCache(client.callApi, args as any, cache as any);

// 무효화
csrCache.removeCsrCache("adminList"); // 타입
csrCache.removeCsrCache("any-prefix"); // 문자열
```

---

## 세션 기반 인증 플러그인 (선택)

`createSessionAuth`는 “세션 인증 로직”을 코어에서 분리해 **옵션으로 붙였다 떼는 방식**입니다.

동작:

- `Authorization`을 `headerStore`에 유지
- `ensureToken$()`로 토큰 동기화(`/api/auth/token`)
- 401 발생 시 refresh 1회 시도(`/api/auth/token/refresh`) 후 원 요청 재시도
- refresh 실패 시 logout(`/api/auth/logout`) 후 에러 전달
- 로그인 상태 변경은 `onLoginChange` 콜백으로 외부에서 처리

```ts
import { createSessionAuth } from "@byeolnaerim/typed-rx-http";

const auth = createSessionAuth({
	headerStore,
	onLoginChange: (loggedIn) => {
		// 예: setLogin(loggedIn) 같은 외부 상태 업데이트(선택)
	},
	// tokenUrl / refreshUrl / logoutUrl 커스터마이징 가능
});

export const secureCall = () => {
	return client
		.callApi<{ ok: true }>({ url: "/api/secure", method: "get" })
		.pipe(auth.withSessionAuth());
};
```

refresh/retry 없이 “토큰 동기화만” 필요하면:

```ts
return client.callApi(...).pipe(auth.withEnsureToken());
```

---

## 에러 처리

2xx가 아니면 `HttpResponseError`를 throw 합니다 (`status`, `response`, `args`, `data` 포함).

레거시 호환:

- 에러 바디가 `{ resultType: ... }` 형태면 그 객체를 그대로 throw 합니다.

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

## Next.js 어댑터 (`/next`)

### redirectToUnauthorizedOnServer401

`redirectToUnauthorizedOnServer401`는 **Next.js(App Router) SSR 환경에서 401이 발생했을 때 redirect를 수행하는 “기본 구현(편의 함수)”**입니다.

```ts
import { redirectToUnauthorizedOnServer401 } from "@byeolnaerim/typed-rx-http/next";
```

동작 규칙(고정):

- redirect 대상: `/unauthorized`
- queryString: `redirect_uri=<현재 페이지>` + `logout=true`
- 현재 페이지는 `x-page-url` 헤더에서 읽습니다(없으면 `/`)

즉, 위 경로/쿼리 규칙이 프로젝트와 맞을 때만 그대로 사용하세요.  
경로가 다르거나 쿼리 규칙이 다르면, 아래처럼 **직접 `onServer401`를 구현해서 주입**하면 됩니다.

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

Next의 `next/cache` (`unstable_cache`) 기반 SSR 캐시 도우미입니다.

- `GET` + `cacheTime > 0` → `force-cache` + `revalidate`
- 그 외 → `no-store`
- `headersProvider`로 요청별 `Cookie` / `Authorization` 주입
- 401 발생 시 `onServer401`가 있으면 실행(보통 `redirect()`)

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

## Next.js 통합 예시 (템플릿)

아래 예시는 core client + CSR cache + SSR cache helper 구성 예시입니다.

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

## API 레퍼런스 (core)

### createHttpClient<Paths>(options)

반환:

- `callApi<R>(args): Observable<R>`
- `callApiStream<RChunk>(args): Observable<RChunk>`
- `uploadFile({ file, url, ifNoneMatch?, headers? }): Observable<Response>`
- `createSSEObservable<R>(args): Observable<R>`

옵션:

- `baseUrl: string`
- `headerStore?: HeaderStore`
- `headersProvider?: () => Record<string, string> | Promise<Record<string, string>>`
- `dropAuthWhenCacheControl?: boolean` (기본값: `true`)
- `onServer401?: () => void | Promise<void>`

### createHeaderStore(initial?)

- `get()`, `set()`, `merge()`, `remove()`, `clear()`

### createCsrCache<CacheName>()

- `callApiCsrCache(callApiFn, serviceArgs, cacheForService)`
- `removeCsrCache(cacheName)` (타입 + 문자열)

### createSessionAuth(options)

- `withSessionAuth()`, `withEnsureToken()`
- `ensureToken$()`, `refreshToken$()`, `logout$()`

---

## 런타임 요구사항

- `fetch` / `Response` API 사용(`rxjs/fetch`)
- 스트리밍(NDJSON)은 `ReadableStream` + `TextDecoder` 필요
- SSE는 `EventSource` 필요

대부분의 최신 브라우저와 Next.js 런타임에서는 기본 제공됩니다. 커스텀 Node 런타임에서는 폴리필이 필요할 수 있습니다.


---

## Auto Node Script: OpenAPI/Swagger 코드 생성(선택)

이 패키지는 런타임 HTTP 클라이언트와 별도로, OpenAPI/Swagger JSON에서 타입/서비스 코드를 생성하는 Node 스크립트를 함께 제공합니다. 이 스크립트는 **선택 기능**입니다.

일반적인 `@byeolnaerim/typed-rx-http`, `/next`, `/rsocket` 사용자는 이 스크립트를 실행하지 않아도 되며, `openapi-typescript`를 설치할 필요도 없습니다.

```ts
import {
	connectToSwaggerEventStream,
	generateSwaggerFromHttp,
	generateSwaggerFromFile,
} from "@byeolnaerim/typed-rx-http/auto-node-script/openapi";
```

### 의존성 격리

OpenAPI 타입 생성에는 `openapi-typescript` CLI가 필요합니다. 하지만 이 패키지는 `openapi-typescript`를 일반 `dependencies`에 넣지 않습니다.

`@byeolnaerim/typed-rx-http` 라이브러리 자체는 `devDependencies.typescript`로 TypeScript 6.0.3을 사용합니다. `typed-rx-http`, `/next`, `/rsocket` 엔트리포인트와 라이브러리 빌드는 이 TypeScript 6.0.3 기준을 유지합니다.

다만 `openapi-typescript`는 아직 특정 TypeScript 5.x 버전을 요구할 수 있으므로, OpenAPI auto node script만 별도의 npx 임시 실행 환경에서 `openapi-typescript`와 `typescript@5.9.3`을 같이 실행합니다. 이 임시 실행 환경은 라이브러리의 `devDependencies.typescript` 6.0.3을 바꾸지 않고, 사용자의 프로젝트에 설치된 `typescript`나 `openapi-typescript` 버전도 사용하지 않습니다.

기본값은 auto script 실행 시점에만 아래 명령을 생성해서 실행하는 것입니다.

```bash
npx -y -p openapi-typescript@latest -p typescript@5.9.3 openapi-typescript swagger.json --output ./src/handler/service/@types/ApiTypes.d.ts
```

따라서 사용법 자체는 바뀌지 않습니다. 기존처럼 auto node script를 호출하면 되고, OpenAPI 타입 생성 단계에서만 격리된 TypeScript 5.9.3 환경이 사용됩니다. auto script를 쓰지 않는 사용자는 `openapi-typescript`나 TypeScript 5.9.3에 전혀 묶이지 않습니다.

필요하면 기본 명령에 사용되는 패키지 버전만 고정할 수 있습니다.

```ts
generateSwaggerFromFile({
	inputFile: "./swagger.json",
	openApiTypescriptPackage: "openapi-typescript@7.0.0",
	openApiTypescriptTypescriptPackage: "typescript@5.9.3",
});
```

### 생성되는 파일

기본 설정은 아래 파일들을 생성합니다.

```txt
swagger.json
src/handler/service/@types/ApiTypes.d.ts
src/handler/service/auto/*Service.ts
src/handler/service/@types/auto/*Types.ts
src/handler/service/apiUnionArrays.ts
```

`apiUnionArrays.ts`는 OpenAPI schema enum뿐 아니라 `query`, `path`, `header`, `cookie` parameter enum도 상수 배열로 생성합니다. 배열 query parameter의 `items.enum`도 처리합니다.

### EventStream 감시

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

### HTTP 1회 요청

```ts
await generateSwaggerFromHttp({
	hostname: "localhost",
	port: 8788,
	path: "/oauth2/for-local/get-swagger",
});
```

### 로컬 파일에서 생성

```ts
generateSwaggerFromFile({
	inputFile: "./swagger.json",
});
```

---
