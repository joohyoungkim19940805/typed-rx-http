declare module "rsocket-core" {
	export const BufferEncoders: any;
	export const IdentitySerializer: any;
	export const MESSAGE_RSOCKET_AUTHENTICATION: any;
	export const MESSAGE_RSOCKET_COMPOSITE_METADATA: any;
	export const MESSAGE_RSOCKET_ROUTING: any;
	export class RSocketClient {
		constructor(options: any);
		connect(): any;
	}
	export function createBuffer(length: number): any;
	export function encodeBearerAuthMetadata(jwt: string): any;
	export function encodeCompositeMetadata(metadata: [any, any][]): any;
	export function encodeRoute(route: string): any;
	export function toBuffer(...args: any[]): any;
}

declare module "rsocket-websocket-client" {
	export default class RSocketWebSocketClient {
		constructor(options: any, encoders: any);
	}
}
