/// <reference path="./rsocket-shims.d.ts" />
import { Buffer } from "buffer";
import {
	BufferEncoders,
	IdentitySerializer,
	MESSAGE_RSOCKET_AUTHENTICATION,
	MESSAGE_RSOCKET_COMPOSITE_METADATA,
	MESSAGE_RSOCKET_ROUTING,
	RSocketClient,
	encodeBearerAuthMetadata,
	encodeCompositeMetadata,
	encodeRoute,
} from "rsocket-core";
import RSocketWebSocketClient from "rsocket-websocket-client";
import { Observable } from "rxjs";

export type RSocketConnectionStatus = "CONNECTED" | "CONNECTING" | "CLOSED";

export interface RSocketJsonCodec {
	encode(data?: unknown): Buffer;
	decode(raw: unknown): unknown;
}

export interface RSocketConnectOptions {
	url: string;
	jwt?: string;
	keepAlive?: number;
	lifetime?: number;
	dataMimeType?: string;
}

export interface RSocketReconnectOptions extends RSocketConnectOptions {
	maxRetry?: number;
	baseDelay?: number;
	maxDelay?: number;
	jitter?: number;
}

export interface RSocketPayload<Data = Buffer> {
	data: Data;
	metadata?: Buffer;
}

export interface RSocketSubscription {
	request(n: number): void;
	cancel(): void;
}

export interface ReactiveSocketLike<Data = Buffer> {
	requestStream(payload: RSocketPayload<Data>): {
		subscribe(observer: {
			onComplete?: () => void;
			onError?: (err: unknown) => void;
			onNext?: (payload: RSocketPayload<Data>) => void;
			onSubscribe?: (subscription: RSocketSubscription) => void;
		}): void;
	};
	requestResponse(payload: RSocketPayload<Data>): {
		subscribe(observer: {
			onComplete?: (payload: RSocketPayload<Data>) => void;
			onError?: (err: unknown) => void;
			onSubscribe?: () => void;
		}): void;
	};
	connectionStatus(): {
		subscribe(observer: {
			onNext?: (status: { kind?: string }) => void;
			onError?: (err: unknown) => void;
			onSubscribe?: () => void;
			onComplete?: () => void;
		}): void;
	};
	close?: () => void;
}

export interface RSocketApiOptions {
	connector: RSocketReconnect;
	jwt?: string;
	codec?: RSocketJsonCodec;
	maxRequest?: number;
}


export interface RSocketOperationLike {
	route?: string;
	interaction?: string;
	fireAndForget?: boolean;
	request?: unknown;
	response?: unknown;
}

export type RSocketOperationsLike = object;

export type RSocketRoute<Operations extends RSocketOperationsLike> = [Extract<
	keyof Operations,
	string
>] extends [never]
	? string
	: Extract<keyof Operations, string>;

type RSocketOperationProperty<
	Operations extends RSocketOperationsLike,
	TRoute extends RSocketRoute<Operations>,
	TProperty extends string,
> = TRoute extends keyof Operations
	? TProperty extends keyof Operations[TRoute]
		? Operations[TRoute][TProperty]
		: unknown
	: unknown;

export type RSocketOperationRequest<
	Operations extends RSocketOperationsLike,
	TRoute extends RSocketRoute<Operations>,
> = RSocketOperationProperty<Operations, TRoute, "request">;

export type RSocketOperationResponse<
	Operations extends RSocketOperationsLike,
	TRoute extends RSocketRoute<Operations>,
> = RSocketOperationProperty<Operations, TRoute, "response">;

export type RSocketOperationInteraction<
	Operations extends RSocketOperationsLike,
	TRoute extends RSocketRoute<Operations>,
> = RSocketOperationProperty<Operations, TRoute, "interaction"> extends string
	? RSocketOperationProperty<Operations, TRoute, "interaction">
	: string;

export type RSocketRoutesByInteraction<
	Operations extends RSocketOperationsLike,
	TInteraction extends string,
> = string extends RSocketRoute<Operations>
	? string
	: {
			[TRoute in RSocketRoute<Operations>]: RSocketOperationInteraction<
				Operations,
				TRoute
			> extends TInteraction
				? TRoute
				: never;
		}[RSocketRoute<Operations>];

export type RSocketStreamRoute<Operations extends RSocketOperationsLike> =
	RSocketRoutesByInteraction<Operations, "requestStream">;

export type RSocketMonoRoute<Operations extends RSocketOperationsLike> =
	RSocketRoutesByInteraction<Operations, "requestResponse">;

type IsUnknown<T> = unknown extends T
	? [T] extends [unknown]
		? true
		: false
	: false;

export type RSocketRequestArgs<
	Operations extends RSocketOperationsLike,
	TRoute extends RSocketRoute<Operations>,
> = IsUnknown<RSocketOperationRequest<Operations, TRoute>> extends true
	? [data?: unknown]
	: [RSocketOperationRequest<Operations, TRoute>] extends [void | undefined]
		? [data?: RSocketOperationRequest<Operations, TRoute>]
		: {} extends RSocketOperationRequest<Operations, TRoute>
			? [data?: RSocketOperationRequest<Operations, TRoute>]
			: [data: RSocketOperationRequest<Operations, TRoute>];

export const defaultRSocketJsonCodec: RSocketJsonCodec = {
	encode(data?: unknown) {
		if (data == null) return Buffer.alloc(0);
		if (typeof data === "string") return Buffer.from(data, "utf8");
		return Buffer.from(JSON.stringify(data), "utf8");
	},
	decode(raw: unknown) {
		if (!raw) return null;
		if (Buffer.isBuffer(raw)) {
			if (raw.length === 0) return null;
			const text = raw.toString("utf8");
			try {
				const parsed = JSON.parse(text);
				if (typeof parsed !== "string") return parsed;
				try {
					return JSON.parse(parsed);
				} catch {
					return parsed;
				}
			} catch {
				return text;
			}
		}
		return raw;
	},
};

const createAuthSetupMetadata = (jwt?: string): Buffer | undefined => {
	if (!jwt) return undefined;
	return encodeCompositeMetadata([
		[MESSAGE_RSOCKET_AUTHENTICATION, encodeBearerAuthMetadata(jwt)],
	]);
};

export const connectRSocket = async (
	options: RSocketConnectOptions,
): Promise<ReactiveSocketLike<Buffer>> => {
	const client = new RSocketClient({
		setup: {
			keepAlive: options.keepAlive ?? 30_000,
			lifetime: options.lifetime ?? 90_000,
			dataMimeType: options.dataMimeType ?? "application/json",
			metadataMimeType: MESSAGE_RSOCKET_COMPOSITE_METADATA.string,
			payload: {
				data: Buffer.alloc(0),
				metadata:
					createAuthSetupMetadata(options.jwt) ?? Buffer.alloc(0),
			},
		},
		serializers: {
			data: IdentitySerializer,
			metadata: IdentitySerializer,
		},
		transport: new RSocketWebSocketClient(
			{ url: options.url },
			BufferEncoders,
		),
	});

	return await new Promise<ReactiveSocketLike<Buffer>>((resolve, reject) => {
		client.connect().subscribe({
			onComplete: (rs: ReactiveSocketLike<Buffer>) => resolve(rs),
			onError: reject,
			onSubscribe: () => {},
		});
	});
};

export class RSocketReconnect {
	private rsocket: ReactiveSocketLike<Buffer> | null = null;
	private status: RSocketConnectionStatus = "CLOSED";
	private retry = 0;
	private manuallyClosed = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private connectingPromise: Promise<ReactiveSocketLike<Buffer>> | null =
		null;

	private readonly maxRetry: number;
	private readonly baseDelay: number;
	private readonly maxDelay: number;
	private readonly jitter: number;

	constructor(private readonly options: RSocketReconnectOptions) {
		this.maxRetry = options.maxRetry ?? 8;
		this.baseDelay = options.baseDelay ?? 500;
		this.maxDelay = options.maxDelay ?? 10_000;
		this.jitter = options.jitter ?? 250;
	}

	getStatus(): RSocketConnectionStatus {
		return this.status;
	}

	async get(): Promise<ReactiveSocketLike<Buffer>> {
		this.manuallyClosed = false;
		if (this.rsocket) return this.rsocket;
		return this.connect();
	}

	private nextDelay(): number {
		const base = Math.min(
			this.maxDelay,
			this.baseDelay * Math.pow(2, this.retry),
		);
		return base + Math.floor(Math.random() * this.jitter);
	}

	private async connect(): Promise<ReactiveSocketLike<Buffer>> {
		if (this.rsocket) return this.rsocket;
		if (this.connectingPromise) return this.connectingPromise;

		this.manuallyClosed = false;
		this.status = "CONNECTING";
		this.connectingPromise = connectRSocket(this.options)
			.then((rs) => {
				if (this.manuallyClosed) {
					try {
						rs.close?.();
					} catch {}
					throw new Error(
						"RSocket connection was closed before it completed.",
					);
				}
				this.rsocket = rs;
				this.status = "CONNECTED";
				this.retry = 0;
				this.connectingPromise = null;

				rs.connectionStatus().subscribe({
					onNext: (nextStatus: { kind?: string }) => {
						const kind = (nextStatus as { kind?: string }).kind;
						if (kind === "CLOSED" || kind === "ERROR") {
							this.handleClose();
						}
					},
					onError: () => this.handleClose(),
					onSubscribe: () => {},
					onComplete: () => this.handleClose(),
				});

				return rs;
			})
			.catch((err) => {
				this.connectingPromise = null;
				this.handleClose();
				throw err;
			});

		return this.connectingPromise;
	}

	private handleClose() {
		this.rsocket = null;
		this.status = "CLOSED";
		if (!this.manuallyClosed) {
			this.scheduleReconnect();
		}
	}

	private scheduleReconnect() {
		if (
			this.status === "CONNECTING" ||
			this.rsocket ||
			this.reconnectTimer
		) {
			return;
		}
		if (this.retry >= this.maxRetry) return;

		const delay = this.nextDelay();
		this.retry += 1;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect().catch(() => {
				this.scheduleReconnect();
			});
		}, delay);
	}

	close() {
		this.manuallyClosed = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		try {
			const closable = this.rsocket as { close?: () => void } | null;
			closable?.close?.();
		} catch {}
		this.rsocket = null;
		this.connectingPromise = null;
		this.status = "CLOSED";
	}
}

export class RSocketApi<
	Operations extends RSocketOperationsLike = RSocketOperationsLike,
> {
	private readonly connector: RSocketReconnect;
	private readonly jwt?: string;
	private readonly codec: RSocketJsonCodec;
	private readonly maxRequest: number;

	constructor(options: RSocketApiOptions) {
		this.connector = options.connector;
		this.jwt = options.jwt;
		this.codec = options.codec ?? defaultRSocketJsonCodec;
		this.maxRequest = options.maxRequest ?? 2_147_483_647;
	}

	private meta(route: string): Buffer {
		const metadata: [any, Buffer][] = [];

		if (this.jwt) {
			metadata.push([
				MESSAGE_RSOCKET_AUTHENTICATION,
				encodeBearerAuthMetadata(this.jwt),
			]);
		}

		metadata.push([MESSAGE_RSOCKET_ROUTING, encodeRoute(route)]);
		return encodeCompositeMetadata(metadata);
	}

	private async withSocket<T>(
		fn: (rs: ReactiveSocketLike<Buffer>) => T,
	): Promise<T> {
		const rs = await this.connector.get();
		return fn(rs);
	}

	stream<
		TRoute extends RSocketStreamRoute<Operations> & RSocketRoute<Operations>,
	>(
		route: TRoute,
		data?: RSocketOperationRequest<Operations, TRoute>,
	): Observable<RSocketOperationResponse<Operations, TRoute>>;
	stream<R = unknown>(route: string, data?: unknown): Observable<R>;
	stream(route: string, data?: unknown): Observable<unknown> {
		return new Observable<unknown>((subscriber) => {
			let subscription: RSocketSubscription | null = null;

			this.withSocket((rs) => {
				const flowable = rs.requestStream({
					data: this.codec.encode(data),
					metadata: this.meta(route),
				});

				flowable.subscribe({
					onComplete: () => subscriber.complete(),
					onError: (err: unknown) => subscriber.error(err),
					onNext: (payload: RSocketPayload<Buffer>) => {
						subscriber.next(this.codec.decode(payload.data));
					},
					onSubscribe: (nextSubscription: RSocketSubscription) => {
						subscription = nextSubscription;
						nextSubscription.request(this.maxRequest);
					},
				});
			}).catch((err) => subscriber.error(err));

			return () => {
				try {
					subscription?.cancel();
				} catch {}
			};
		});
	}

	mono<
		TRoute extends RSocketMonoRoute<Operations> & RSocketRoute<Operations>,
	>(
		route: TRoute,
		data?: RSocketOperationRequest<Operations, TRoute>,
	): Observable<RSocketOperationResponse<Operations, TRoute>>;
	mono<R = unknown>(route: string, data?: unknown): Observable<R>;
	mono(route: string, data?: unknown): Observable<unknown> {
		return new Observable<unknown>((subscriber) => {
			this.withSocket((rs) => {
				rs.requestResponse({
					data: this.codec.encode(data),
					metadata: this.meta(route),
				}).subscribe({
					onComplete: (payload: RSocketPayload<Buffer>) => {
						subscriber.next(this.codec.decode(payload.data));
						subscriber.complete();
					},
					onError: (err: unknown) => subscriber.error(err),
					onSubscribe: () => {},
				});
			}).catch((err) => subscriber.error(err));
		});
	}

	close(): void {
		this.connector.close();
	}
}

export function createRSocketApi<
	Operations extends RSocketOperationsLike = RSocketOperationsLike,
>(
	url: string,
	jwt?: string,
	options: Omit<RSocketReconnectOptions, "url" | "jwt"> &
		Pick<RSocketApiOptions, "codec" | "maxRequest"> = {},
): RSocketApi<Operations> {
	const connector = new RSocketReconnect({ url, jwt, ...options });
	return new RSocketApi<Operations>({
		connector,
		jwt,
		codec: options.codec,
		maxRequest: options.maxRequest,
	});
}
