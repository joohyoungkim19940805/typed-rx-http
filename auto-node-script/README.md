# typed-rx-http auto-node-script

Node-only generators for projects that use `@byeolnaerim/typed-rx-http`.

These modules are intentionally separate from the browser/runtime entry points. They use Node APIs such as `http`, `https`, `fs`, and `child_process`.

## OpenAPI / Swagger

### EventStream watcher

```js
const {
	connectToSwaggerEventStream,
} = require("@byeolnaerim/typed-rx-http/auto-node-script/openapi");

connectToSwaggerEventStream({
	hostname: "localhost",
	port: 8123,
	path: "/for-local/get-swagger",
	swaggerFile: "./swagger.json",
	serviceDir: "./src/handler/service",
	typesDir: "./src/handler/service/@types",
	typesFile: "./src/handler/service/@types/ApiTypes.d.ts",
	unionArraysFile: "./src/handler/service/apiUnionArrays.ts",
	commonServiceFile: "./src/handler/service/commonService.ts",
});
```

### One-shot HTTP GET

Use this when the backend returns plain JSON instead of `text/event-stream`.

```js
const {
	generateSwaggerFromHttp,
} = require("@byeolnaerim/typed-rx-http/auto-node-script/openapi");

generateSwaggerFromHttp({
	hostname: "localhost",
	port: 8123,
	path: "/for-local/get-swagger",
	swaggerFile: "./swagger.json",
	serviceDir: "./src/handler/service",
	typesDir: "./src/handler/service/@types",
	typesFile: "./src/handler/service/@types/ApiTypes.d.ts",
	unionArraysFile: "./src/handler/service/apiUnionArrays.ts",
	commonServiceFile: "./src/handler/service/commonService.ts",
});
```

### Local JSON file

```js
const {
	generateSwaggerFromFile,
} = require("@byeolnaerim/typed-rx-http/auto-node-script/openapi");

generateSwaggerFromFile({
	inputFile: "./swagger.json",
	swaggerFile: "./swagger.json",
	serviceDir: "./src/handler/service",
	typesDir: "./src/handler/service/@types",
	typesFile: "./src/handler/service/@types/ApiTypes.d.ts",
	unionArraysFile: "./src/handler/service/apiUnionArrays.ts",
	commonServiceFile: "./src/handler/service/commonService.ts",
});
```

## AsyncAPI RSocket

`rsoketCommonService.ts` is user-owned. This package only imports it from generated service files.

### EventStream watcher

```js
const {
	connectToAsyncApiRSocketEventStream,
} = require("@byeolnaerim/typed-rx-http/auto-node-script/asyncapi-rsocket");

connectToAsyncApiRSocketEventStream({
	hostname: "localhost",
	port: 8123,
	path: "/for-local/get-asyncapi-rosket",
	asyncApiRSocketFile: "./asyncapi-rosket.json",
	serviceDir: "./src/handler/service",
	typesDir: "./src/handler/service/@types",
	typesFile: "./src/handler/service/@types/AsyncApiTypes.ts",
	commonRSocketServiceFile: "./src/handler/service/rsoketCommonService.ts",
});
```

### One-shot HTTP GET

Use this when the backend returns plain JSON instead of `text/event-stream`.

```js
const {
	generateAsyncApiRSocketFromHttp,
} = require("@byeolnaerim/typed-rx-http/auto-node-script/asyncapi-rsocket");

generateAsyncApiRSocketFromHttp({
	hostname: "localhost",
	port: 8123,
	path: "/for-local/get-asyncapi-rosket",
	asyncApiRSocketFile: "./asyncapi-rosket.json",
	serviceDir: "./src/handler/service",
	typesDir: "./src/handler/service/@types",
	typesFile: "./src/handler/service/@types/AsyncApiTypes.ts",
	commonRSocketServiceFile: "./src/handler/service/rsoketCommonService.ts",
});
```

### Local JSON file

```js
const {
	generateAsyncApiRSocketFromFile,
} = require("@byeolnaerim/typed-rx-http/auto-node-script/asyncapi-rsocket");

generateAsyncApiRSocketFromFile({
	inputFile: "./asyncapi-rosket.json",
	asyncApiRSocketFile: "./asyncapi-rosket.json",
	serviceDir: "./src/handler/service",
	typesDir: "./src/handler/service/@types",
	typesFile: "./src/handler/service/@types/AsyncApiTypes.ts",
	commonRSocketServiceFile: "./src/handler/service/rsoketCommonService.ts",
});
```

## CLI

Default mode is EventStream watcher.

```bash
typed-rx-http-openapi-watch
typed-rx-http-rsocket-watch
```

One-shot HTTP GET mode:

```bash
typed-rx-http-openapi-watch --http
typed-rx-http-rsocket-watch --http
```

Local file mode:

```bash
typed-rx-http-openapi-watch --file
typed-rx-http-rsocket-watch --file
```
