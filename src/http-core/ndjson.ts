import { Observable } from "rxjs";

export function ndjsonStream<T>(
	body: ReadableStream<Uint8Array>,
): Observable<T> {
	return new Observable<T>((subscriber) => {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		const read = () => {
			reader
				.read()
				.then(({ done, value }) => {
					if (done) {
						// 마지막 버퍼 처리
						if (buffer.trim().length > 0) {
							try {
								subscriber.next(JSON.parse(buffer) as T);
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
					buffer = lines.pop() ?? ""; // 마지막은 미완성 조각일 수 있음

					for (const line of lines) {
						if (!line.trim()) continue;
						try {
							subscriber.next(JSON.parse(line) as T);
						} catch (e) {
							subscriber.error(e);
							return;
						}
					}

					read();
				})
				.catch((err) => subscriber.error(err));
		};

		read();

		return () => {
			reader.cancel().catch(() => {});
		};
	});
}
