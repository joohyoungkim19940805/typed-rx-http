// http-core/plugins/session-auth.ts
import {
	Observable,
	catchError,
	defer,
	finalize,
	map,
	of,
	shareReplay,
	switchMap,
	tap,
	throwError,
	type MonoTypeOperatorFunction,
} from "rxjs";
import { fromFetch } from "rxjs/fetch";
import type { HeaderStore } from "../headers";
import { isHttpResponseError } from "../types";

type TokenJson = { token?: string };

export interface SessionAuthOptions {
	headerStore: HeaderStore;

	/** setLogin 같은 외부 사이드이펙트 주입 */
	onLoginChange?: (loggedIn: boolean) => void;

	/** 엔드포인트들(프로젝트마다 다르면 바꾸기) */
	tokenUrl?: string; // /api/auth/token
	refreshUrl?: string; // /api/auth/token/refresh
	logoutUrl?: string; // /api/auth/logout

	/** Authorization 포맷(기본: Bearer) */
	formatAuthorization?: (rawToken: string) => string;
}

export const createSessionAuth = (opts: SessionAuthOptions) => {
	const {
		headerStore,
		onLoginChange,
		tokenUrl = "/api/auth/token",
		refreshUrl = "/api/auth/token/refresh",
		logoutUrl = "/api/auth/logout",
		formatAuthorization = (t) =>
			t.startsWith("Bearer ") ? t : `Bearer ${t}`,
	} = opts;

	let inFlightToken$: Observable<string> | null = null;
	let inFlightLogout$: Observable<any> | null = null;

	const setAuth = (rawToken: string) => {
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
				return res.json() as Promise<TokenJson>;
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
			shareReplay({ bufferSize: 1, refCount: false }),
		);
	};

	/** 토큰이 없으면 서버에서 한 번 동기화(/api/auth/token) */
	const ensureToken$ = (): Observable<string> => {
		const cur = getCurrentAuthHeader();
		if (cur) return of(cur);

		if (!inFlightToken$) {
			inFlightToken$ = fetchToken$();
		}
		return inFlightToken$;
	};

	const refreshToken$ = (): Observable<string> => {
		// refresh는 현재 Authorization 헤더가 있어야 의미가 있음
		return ensureToken$().pipe(
			switchMap((authHeader) => {
				if (!authHeader) {
					setAuth("");
					return of("");
				}

				return fromFetch(refreshUrl, {
					headers: { Authorization: authHeader },
				}).pipe(
					switchMap((res) => {
						if (!res.ok) return Promise.reject(res);
						return res.json() as Promise<TokenJson>;
					}),
					map((json) => json.token ?? ""),
					tap((token) => setAuth(token)),
					catchError((err) => {
						console.error(err);
						setAuth("");
						return of("");
					}),
				);
			}),
		);
	};

	const sharedLogout$ = () => {
		if (!inFlightLogout$) {
			inFlightLogout$ = fromFetch(logoutUrl).pipe(
				tap(() => setAuth("")),
				finalize(() => {
					inFlightLogout$ = null;
				}),
				shareReplay({ bufferSize: 1, refCount: false }),
			);
		}
		return inFlightLogout$;
	};

	/**
	 *  callApi(...) 뒤에 .pipe(withSessionAuth())로 붙였다 떼기
	 * - subscribe 시점에 ensureToken$ 먼저 수행(헤더 세팅)
	 * - 401이면 refresh 1번 시도 후 원 소스 재구독
	 * - refresh 실패/토큰 없음이면 logout 후 에러 throw
	 */
	const withSessionAuth = <T>(): MonoTypeOperatorFunction<T> => {
		return (source) =>
			defer(() =>
				ensureToken$().pipe(
					switchMap(() => source),
					catchError((err) => {
						// 401만 세션 로직 개입
						if (isHttpResponseError(err) && err.status === 401) {
							return refreshToken$().pipe(
								switchMap((newToken) => {
									if (!newToken) {
										return sharedLogout$().pipe(
											switchMap(() =>
												throwError(() => err),
											),
										);
									}
									// refresh 성공 -> 원 요청 재시도
									return source;
								}),
								catchError(() =>
									sharedLogout$().pipe(
										switchMap(() => throwError(() => err)),
									),
								),
							);
						}

						// 코어가 던진 HttpResponseError가 아니어도 그대로 전달
						return throwError(() => err);
					}),
				),
			);
	};

	/**
	 * 원하면 “ensureToken만” 따로 붙일 수도 있음
	 * - 인증이 필요한데 401 refresh는 싫을 때
	 */
	const withEnsureToken = <T>(): MonoTypeOperatorFunction<T> => {
		return (source) =>
			defer(() => ensureToken$().pipe(switchMap(() => source)));
	};

	return {
		ensureToken$,
		refreshToken$,
		logout$: sharedLogout$,
		withSessionAuth,
		withEnsureToken,
	};
};
