import type { OpenApiPathsLike } from "./types";
import { createHttpClient } from "./client";
import { createHeaderStore } from "./headers";

export function createCommonService<Paths extends OpenApiPathsLike>(opts: {
	baseUrl: string;
	onServer401?: () => void | Promise<void>;
}) {
	const headerStore = createHeaderStore({
		"Content-Type": "application/json",
	});

	const client = createHttpClient<Paths>({
		baseUrl: opts.baseUrl,
		headerStore,
		onServer401: opts.onServer401,
	});

	return {
		headerStore,
		callApi: client.callApi,
		callApiStream: client.callApiStream,
		uploadFile: client.uploadFile,
		createSSEObservable: client.createSSEObservable,
	};
}
