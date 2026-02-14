// http-core/client.ts
import {
	Observable,
	Subscriber,
	catchError,
	concatMap,
	defer,
	from,
	switchMap,
	throwError,
} from "rxjs";
import { fromFetch } from "rxjs/fetch";

import type { OpenApiPathsLike, ServiceArguments } from "./types";
import { HttpResponseError } from "./types";
import type { HeaderStore } from "./headers";
import { ndjsonStream } from "./ndjson";
import { joinUrl, replacePathVariable, toQueryString } from "./utils";

export type HeadersProvider =
	| (() => Record<string, string> | Promise<Record<string, string>>)
	| undefined;

export interface HttpClientOptions {
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

const defaultErrorMessage = (status?: number) => {
	if (status === 500) {
		return "서버에서 오류가 발생하였습니다.\n정상 처리되었는지 확인 후 다시 시도해주십시오.";
	}
	return "서버에서 오류가 발생하였습니다.\n잠시 후 다시 시도해주십시오.";
};

const parseErrorBody = async (res: Response) => {
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

const normalizeBodyAndHeaders = (
	body: any,
	headers: Record<string, string>,
) => {
	// FormData면 Content-Type 제거(브라우저 boundary 자동)
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

export const createHttpClient = <Paths extends OpenApiPathsLike>(
	opts: HttpClientOptions,
) => {
	const {
		baseUrl,
		headerStore,
		headersProvider,
		dropAuthWhenCacheControl = true,
		onServer401,
	} = opts;

	const getBaseHeaders$ = () => {
		if (headersProvider) return from(Promise.resolve(headersProvider()));
		if (headerStore) return from(Promise.resolve(headerStore.get()));
		return from(Promise.resolve({}));
	};

	const callApi = <
		R,
		TPath extends keyof Paths = keyof Paths,
		TMethod extends keyof Paths[TPath] & string = keyof Paths[TPath] &
			string,
	>(
		serviceArguments: ServiceArguments<Paths, TPath, TMethod, R>,
	): Observable<R> => {
		let url = serviceArguments.pathVariable
			? replacePathVariable(
					String(serviceArguments.url),
					serviceArguments.pathVariable as any,
				)
			: String(serviceArguments.url);

		url =
			url +
			((serviceArguments.queryString &&
				toQueryString(serviceArguments.queryString as any)) ||
				"");

		return getBaseHeaders$().pipe(
			concatMap((baseHeaders) => {
				const merged: Record<string, string> = {
					...baseHeaders,
					...(serviceArguments.headers || {}),
				};

				if (dropAuthWhenCacheControl && merged["Cache-Control"]) {
					delete merged["Authorization"];
				}

				const { body, headers } = normalizeBodyAndHeaders(
					serviceArguments.body,
					merged,
				);

				const fullUrl = joinUrl(baseUrl, url);

				return fromFetch(fullUrl, {
					method: serviceArguments.method,
					body,
					headers,
				}).pipe(
					switchMap((res) => {
						// SSR 401 redirect는 코어가 모르고, 주입되면 실행
						if (
							typeof window === "undefined" &&
							res.status === 401 &&
							onServer401
						) {
							return defer(() =>
								Promise.resolve(onServer401()),
							).pipe(
								switchMap(() =>
									throwError(
										() =>
											new HttpResponseError(
												res,
												serviceArguments,
												undefined,
											),
									),
								),
							);
						}

						if (serviceArguments.resultInterceptor) {
							return from(
								serviceArguments.resultInterceptor(res),
							);
						}

						if (!res.ok) {
							return from(parseErrorBody(res)).pipe(
								switchMap((data) => {
									// 기존 프로젝트 호환: resultType 있으면 그대로 던지기
									if (
										data &&
										typeof data === "object" &&
										(data as any).resultType
									) {
										return throwError(() => data);
									}
									const msg =
										(data as any)?.message ??
										defaultErrorMessage(res.status);

									return throwError(
										() =>
											new HttpResponseError(
												res,
												serviceArguments,
												data,
												msg,
											),
									);
								}),
							);
						}

						return from(res.json() as Promise<R>);
					}),
					catchError((err) => {
						// 네트워크 에러/런타임 에러
						if (err instanceof HttpResponseError) {
							return throwError(() => err);
						}
						if (err instanceof Error) {
							return throwError(() => ({
								message: err.message,
								stack: err.stack,
							}));
						}
						return throwError(() => err);
					}),
				);
			}),
		);
	};

	const callApiStream = <
		RChunk,
		TPath extends keyof Paths = keyof Paths,
		TMethod extends keyof Paths[TPath] & string = keyof Paths[TPath] &
			string,
	>(
		serviceArguments: ServiceArguments<Paths, TPath, TMethod, RChunk>,
	): Observable<RChunk> => {
		let url = serviceArguments.pathVariable
			? replacePathVariable(
					String(serviceArguments.url),
					serviceArguments.pathVariable as any,
				)
			: String(serviceArguments.url);

		url =
			url +
			((serviceArguments.queryString &&
				toQueryString(serviceArguments.queryString as any)) ||
				"");

		return getBaseHeaders$().pipe(
			concatMap((baseHeaders) => {
				const merged: Record<string, string> = {
					...baseHeaders,
					...(serviceArguments.headers || {}),
				};

				// 스트리밍이면 Accept 기본값을 NDJSON으로
				if (!merged["Accept"]) {
					merged["Accept"] = "application/x-ndjson";
					// 서버가 application/ndjson이면 호출부에서 headers로 오버라이드 가능
				}

				// 기존 정책 유지: Cache-Control 있으면 Authorization 제거
				if (dropAuthWhenCacheControl && merged["Cache-Control"]) {
					delete merged["Authorization"];
				}

				const { body, headers } = normalizeBodyAndHeaders(
					serviceArguments.body,
					merged,
				);

				const fullUrl = joinUrl(baseUrl, url);

				return fromFetch(fullUrl, {
					method: serviceArguments.method,
					body,
					headers,
				}).pipe(
					switchMap((res) => {
						// SSR 401 redirect (옵션)
						if (
							typeof window === "undefined" &&
							res.status === 401 &&
							onServer401
						) {
							return defer(() =>
								Promise.resolve(onServer401()),
							).pipe(
								switchMap(() =>
									throwError(
										() =>
											new HttpResponseError(
												res,
												serviceArguments,
												undefined,
											),
									),
								),
							);
						}

						// 스트리밍은 resultInterceptor(단일 JSON 파서) 대신 기본 NDJSON 처리
						if (!res.ok) {
							return from(parseErrorBody(res)).pipe(
								switchMap((data) => {
									// 프로젝트 호환: resultType 있으면 그대로 던지기
									if (
										data &&
										typeof data === "object" &&
										(data as any).resultType
									) {
										return throwError(() => data);
									}
									const msg =
										(data as any)?.message ??
										defaultErrorMessage(res.status);

									return throwError(
										() =>
											new HttpResponseError(
												res,
												serviceArguments,
												data,
												msg,
											),
									);
								}),
							);
						}

						if (!res.body) {
							return throwError(
								() => new Error("ReadableStream body is null"),
							);
						}

						// ✅ 한 줄에 하나씩 RChunk(JSON) 내려온다고 가정
						return ndjsonStream<RChunk>(res.body);
					}),
				);
			}),
		);
	};

	/** uploadFile은 코어에 남겨도 setLogin/Wrapper와 무관 */
	const uploadFile = ({
		file,
		url,
		ifNoneMatch,
	}: {
		file: File;
		url: string;
		ifNoneMatch?: string;
	}) => {
		const headers: Record<string, string> = {
			"Content-Encoding": "base64",
			"Content-Type": "application/octet-stream",
		};
		if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
		return fromFetch(url, { method: "PUT", body: file as any, headers });
	};

	/** 개별 SSE Observable(기존 createSSEObservable 유지) */
	const createSSEObservable = <R>(
		serviceArguments: ServiceArguments<Paths, any, any, any>,
	) => {
		let url = serviceArguments.pathVariable
			? replacePathVariable(
					String(serviceArguments.url),
					serviceArguments.pathVariable as any,
				)
			: String(serviceArguments.url);

		url =
			url +
			((serviceArguments.queryString &&
				toQueryString(serviceArguments.queryString as any)) ||
				"");

		return new Observable<R>((observer: Subscriber<R>) => {
			const eventSource = new EventSource(joinUrl(baseUrl, url), {
				withCredentials: false,
			});

			eventSource.onmessage = (event) => {
				observer.next(JSON.parse(event.data) as R);
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
