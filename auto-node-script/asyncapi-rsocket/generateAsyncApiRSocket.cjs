const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { generateAsyncApiRSocketServices } = require("./generateAsyncApiRSocketXxxService.cjs");

const SERVICE_DIR = "./src/handler/service";
const ASYNC_API_RSOCKET_FILE = "./asyncapi-rosket.json"; // 저장할 AsyncAPI RSocket 파일 경로
const TYPES_DIR = "./src/handler/service/@types";
const TYPES_FILE = TYPES_DIR + "/AsyncApiTypes.ts";
const COMMON_RSOCKET_SERVICE_FILE = SERVICE_DIR + "/rsoketCommonService.ts";

const PRIMITIVE_SCHEMA_TYPE_MAP = {
	int: "number",
	long: "number",
	float: "number",
	double: "number",
	boolean: "boolean",
	String: "string",
};

const PRIMITIVE_JAVA_TYPE_MAP = {
	byte: "number",
	short: "number",
	int: "number",
	long: "number",
	float: "number",
	double: "number",
	"java.lang.Byte": "number",
	"java.lang.Short": "number",
	"java.lang.Integer": "number",
	"java.lang.Long": "number",
	"java.lang.Float": "number",
	"java.lang.Double": "number",
	boolean: "boolean",
	"java.lang.Boolean": "boolean",
	char: "string",
	"java.lang.Character": "string",
	"java.lang.String": "string",
	"java.time.Instant": "string",
	"java.time.LocalDateTime": "string",
	"java.time.LocalDate": "string",
	"java.time.LocalTime": "string",
	"java.math.BigDecimal": "number",
	"java.math.BigInteger": "number",
};

// 디렉토리가 없으면 생성
if (!fs.existsSync(TYPES_DIR)) {
	fs.mkdirSync(TYPES_DIR, { recursive: true });
}

if (!fs.existsSync(SERVICE_DIR)) {
	fs.mkdirSync(SERVICE_DIR, { recursive: true });
}

// 서버와 연결 설정
const options = {
	hostname: "localhost", // 서버 주소
	port: 8123, // 서버 포트
	path: "/for-local/get-asyncapi-rosket", // EventStream 경로
	method: "GET",
	headers: {
		Accept: "text/event-stream",
	},
};

// 이벤트 버퍼
let eventBuffer = "";
let reconnectTimeout = null;

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapeComment(value) {
	return String(value).replace(/\*\//g, "* /");
}

function toPascalCase(value) {
	const parts = String(value || "")
		.replace(/\{([^}]+)}/g, " by $1 ")
		.split(/[^A-Za-z0-9]+/g)
		.filter(Boolean);

	const result = parts
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");

	return result || "Value";
}

function toTsIdentifier(value, fallback = "Value") {
	const identifier = toPascalCase(value || fallback).replace(/^[0-9]+/, "");
	return identifier || fallback;
}

function getRefName(ref) {
	return ref ? ref.split("/").pop() : null;
}

function resolveRef(ref, asyncapiData) {
	if (!ref || !ref.startsWith("#/")) {
		return null;
	}

	return ref
		.slice(2)
		.split("/")
		.reduce((current, token) => {
			if (current == null) {
				return null;
			}

			return current[token.replace(/~1/g, "/").replace(/~0/g, "~")];
		}, asyncapiData);
}

function getJavaTypeSimpleName(javaType) {
	if (!javaType) {
		return null;
	}

	return String(javaType)
		.split(".")
		.pop()
		.split("$")
		.map((part) => toTsIdentifier(part))
		.join("");
}

function getSchemaBaseTypeName(schemaName, schema) {
	const javaType = schema?.["x-javaType"];
	const javaTypeSimpleName = getJavaTypeSimpleName(javaType);

	if (javaTypeSimpleName) {
		return javaTypeSimpleName;
	}

	return (
		String(schemaName)
			.split("_")
			.filter(Boolean)
			.slice(-1)
			.map((part) => toTsIdentifier(part))
			.join("") || toTsIdentifier(schemaName)
	);
}

function getSchemaPrefixCandidates(schemaName, schema) {
	const javaType = schema?.["x-javaType"];
	const tokens = javaType
		? String(javaType).replace(/\$/g, ".").split(".").filter(Boolean)
		: String(schemaName).split("_").filter(Boolean);

	return tokens.map((token) => toTsIdentifier(token)).filter(Boolean);
}

function createSchemaNameMap(schemas) {
	const baseNames = new Map();

	Object.entries(schemas).forEach(([schemaName, schema]) => {
		const javaType = schema?.["x-javaType"];
		if (
			PRIMITIVE_SCHEMA_TYPE_MAP[schemaName] ||
			PRIMITIVE_JAVA_TYPE_MAP[javaType]
		) {
			return;
		}

		const baseName = getSchemaBaseTypeName(schemaName, schema);
		if (!baseNames.has(baseName)) {
			baseNames.set(baseName, []);
		}

		baseNames.get(baseName).push([schemaName, schema]);
	});

	const nameMap = new Map();
	const usedNames = new Set();

	for (const [baseName, entries] of baseNames.entries()) {
		if (entries.length === 1 && !usedNames.has(baseName)) {
			nameMap.set(entries[0][0], baseName);
			usedNames.add(baseName);
			continue;
		}

		entries.forEach(([schemaName, schema]) => {
			const candidates = getSchemaPrefixCandidates(schemaName, schema);
			let finalName = baseName;

			for (let size = 2; size <= candidates.length; size += 1) {
				const candidate = candidates.slice(-size).join("");
				if (candidate.endsWith(baseName) && !usedNames.has(candidate)) {
					finalName = candidate;
					break;
				}
			}

			let suffix = 2;
			while (usedNames.has(finalName)) {
				finalName = `${baseName}${suffix}`;
				suffix += 1;
			}

			nameMap.set(schemaName, finalName);
			usedNames.add(finalName);
		});
	}

	return nameMap;
}

function isRequired(required, propertyName) {
	return Array.isArray(required) && required.includes(propertyName);
}

function getPropertyKey(propertyName) {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(propertyName)
		? propertyName
		: JSON.stringify(propertyName);
}

function schemaToType(schema, context) {
	if (!schema) {
		return "unknown";
	}

	if (schema.$ref) {
		const schemaName = getRefName(schema.$ref);
		const target = resolveRef(schema.$ref, context.asyncapiData);
		const javaType = target?.["x-javaType"];

		if (PRIMITIVE_JAVA_TYPE_MAP[javaType]) {
			return PRIMITIVE_JAVA_TYPE_MAP[javaType];
		}

		if (PRIMITIVE_SCHEMA_TYPE_MAP[schemaName]) {
			return PRIMITIVE_SCHEMA_TYPE_MAP[schemaName];
		}

		return context.schemaNameMap.get(schemaName) || toTsIdentifier(schemaName);
	}

	if (Array.isArray(schema.oneOf)) {
		return schema.oneOf.map((item) => schemaToType(item, context)).join(" | ") || "unknown";
	}

	if (Array.isArray(schema.anyOf)) {
		return schema.anyOf.map((item) => schemaToType(item, context)).join(" | ") || "unknown";
	}

	if (Array.isArray(schema.allOf)) {
		const meaningfulItems = schema.allOf.filter(
			(item) => isObject(item) && !item["x-paramName"],
		);
		const itemTypes = meaningfulItems.map((item) => schemaToType(item, context));
		return itemTypes.length > 0 ? itemTypes.join(" & ") : "unknown";
	}

	if (Array.isArray(schema.enum)) {
		return schema.enum.map((value) => JSON.stringify(value)).join(" | ") || "string";
	}

	if (schema.type === "array") {
		return `${schemaToType(schema.items || {}, context)}[]`;
	}

	if (schema.type === "integer" || schema.type === "number") {
		return "number";
	}

	if (schema.type === "boolean") {
		return "boolean";
	}

	if (schema.type === "string") {
		return "string";
	}

	if (schema.additionalProperties && isObject(schema.additionalProperties)) {
		return `Record<string, ${schemaToType(schema.additionalProperties, context)}>`;
	}

	if (schema.additionalProperties === true) {
		return "Record<string, unknown>";
	}

	if (schema.type === "object" || schema.properties) {
		const properties = schema.properties || {};
		const propertyEntries = Object.entries(properties);

		if (propertyEntries.length === 0) {
			return "Record<string, never>";
		}

		const lines = propertyEntries.map(([propertyName, propertySchema]) => {
			const optional = isRequired(schema.required, propertyName) ? "" : "?";
			return `${getPropertyKey(propertyName)}${optional}: ${schemaToType(propertySchema, context)};`;
		});

		return `{ ${lines.join(" ")} }`;
	}

	return "unknown";
}

function generateInterface(schemaName, schema, context) {
	const typeName = context.schemaNameMap.get(schemaName);

	if (!typeName) {
		return null;
	}

	const properties = schema.properties || {};
	const lines = [];

	if (schema["x-javaType"]) {
		lines.push(`/** Java type: ${escapeComment(schema["x-javaType"])} */`);
	}

	lines.push(`export interface ${typeName} {`);

	Object.entries(properties).forEach(([propertyName, propertySchema]) => {
		const optional = isRequired(schema.required, propertyName) ? "" : "?";
		lines.push(`\t${getPropertyKey(propertyName)}${optional}: ${schemaToType(propertySchema, context)};`);
	});

	lines.push("}");
	return lines.join("\n");
}

function getMessagePayloadType(messageRefOrObject, context) {
	if (!messageRefOrObject) {
		return "void";
	}

	if (messageRefOrObject.$ref) {
		const message = resolveRef(messageRefOrObject.$ref, context.asyncapiData);
		return getMessagePayloadType(message, context);
	}

	if (Array.isArray(messageRefOrObject.oneOf)) {
		return messageRefOrObject.oneOf
			.map((item) => getMessagePayloadType(item, context))
			.join(" | ");
	}

	return schemaToType(messageRefOrObject.payload || {}, context);
}

function getMessageRSocketMeta(messageRefOrObject, context) {
	if (!messageRefOrObject) {
		return {};
	}

	if (messageRefOrObject.$ref) {
		const message = resolveRef(messageRefOrObject.$ref, context.asyncapiData);
		return getMessageRSocketMeta(message, context);
	}

	if (Array.isArray(messageRefOrObject.oneOf) && messageRefOrObject.oneOf.length > 0) {
		return getMessageRSocketMeta(messageRefOrObject.oneOf[0], context);
	}

	return messageRefOrObject["x-rsocket"] || {};
}

function getOperationName(destination) {
	return `${toTsIdentifier(destination)}Operation`;
}

function generateRouteTypes(asyncapiData, context) {
	const channels = asyncapiData.channels || {};
	const routeEntries = Object.entries(channels).map(([destination, channel]) => {
		const publishMessage = channel.publish?.message;
		const subscribeMessage = channel.subscribe?.message;
		const publishMeta = getMessageRSocketMeta(publishMessage, context);
		const responseMeta = getMessageRSocketMeta(subscribeMessage, context);
		const channelMeta = channel["x-rsocket"] || {};
		const routeMeta = Array.isArray(channelMeta.routes) ? channelMeta.routes[0] || {} : {};
		const isStream = Boolean(channel.subscribe?.["x-rsocket"]?.stream);
		const interaction = publishMeta.interaction || responseMeta.interaction || (isStream ? "requestStream" : "requestResponse");
		const fireAndForget = Boolean(publishMeta.fireAndForget || responseMeta.fireAndForget);

		return {
			destination,
			operationName: getOperationName(destination),
			interaction,
			fireAndForget,
			requestType: getMessagePayloadType(publishMessage, context),
			responseType: fireAndForget ? "void" : getMessagePayloadType(subscribeMessage, context),
			controller: publishMeta.controller || responseMeta.controller || routeMeta.controller,
			method: publishMeta.method || responseMeta.method || routeMeta.method,
		};
	});

	const lines = [];

	if (routeEntries.length === 0) {
		lines.push("export type AsyncApiRSocketRoute = never;");
		lines.push("export interface AsyncApiRSocketOperations {}");
		return lines.join("\n");
	}

	lines.push("export type AsyncApiRSocketRoute =");
	routeEntries.forEach((entry, index) => {
		const terminator = index === routeEntries.length - 1 ? ";" : "";
		lines.push(`\t| ${JSON.stringify(entry.destination)}${terminator}`);
	});
	lines.push("");

	routeEntries.forEach((entry) => {
		if (entry.controller || entry.method) {
			lines.push(`/** ${escapeComment([entry.controller, entry.method].filter(Boolean).join("#"))} */`);
		}

		lines.push(`export interface ${entry.operationName} {`);
		lines.push(`\troute: ${JSON.stringify(entry.destination)};`);
		lines.push(`\tinteraction: ${JSON.stringify(entry.interaction)};`);
		lines.push(`\tfireAndForget: ${entry.fireAndForget};`);
		lines.push(`\trequest: ${entry.requestType};`);
		lines.push(`\tresponse: ${entry.responseType};`);
		lines.push("}");
		lines.push("");
	});

	lines.push("export interface AsyncApiRSocketOperations {");
	routeEntries.forEach((entry) => {
		lines.push(`\t${JSON.stringify(entry.destination)}: ${entry.operationName};`);
	});
	lines.push("}");
	lines.push("");
	lines.push("export type AsyncApiRSocketRequest<TRoute extends AsyncApiRSocketRoute> = AsyncApiRSocketOperations[TRoute]['request'];");
	lines.push("export type AsyncApiRSocketResponse<TRoute extends AsyncApiRSocketRoute> = AsyncApiRSocketOperations[TRoute]['response'];");
		lines.push("export type AsyncApiRSocketInteraction<TRoute extends AsyncApiRSocketRoute> = AsyncApiRSocketOperations[TRoute]['interaction'];");
	lines.push('export type AsyncApiRSocketStreamRoute = {');
	lines.push("\t[TRoute in AsyncApiRSocketRoute]: AsyncApiRSocketOperations[TRoute]['interaction'] extends 'requestStream' ? TRoute : never;");
	lines.push('}[AsyncApiRSocketRoute];');
	lines.push('export type AsyncApiRSocketMonoRoute = {');
	lines.push("\t[TRoute in AsyncApiRSocketRoute]: AsyncApiRSocketOperations[TRoute]['interaction'] extends 'requestResponse' ? TRoute : never;");
	lines.push('}[AsyncApiRSocketRoute];');

	return lines.join("\n");
}

function generateAsyncApiTypes(asyncapiData, sourceName = ASYNC_API_RSOCKET_FILE) {
	if (!asyncapiData || asyncapiData.asyncapi == null) {
		throw new Error("Invalid AsyncAPI document. Missing asyncapi field.");
	}

	const schemas = asyncapiData.components?.schemas || {};
	const context = {
		asyncapiData,
		schemaNameMap: createSchemaNameMap(schemas),
	};

	const lines = [];
	lines.push("/* eslint-disable */");
	lines.push("/**");
	lines.push(` * This file was generated from ${sourceName}.`);
	lines.push(" * Do not edit this file manually.");
	lines.push(" */");
	lines.push("");

	Object.entries(schemas).forEach(([schemaName, schema]) => {
		const interfaceCode = generateInterface(schemaName, schema, context);
		if (interfaceCode) {
			lines.push(interfaceCode);
			lines.push("");
		}
	});

	lines.push(generateRouteTypes(asyncapiData, context));
	lines.push("");

	return lines.join("\n");
}


const DEFAULT_OPTIONS = {
	hostname: "localhost",
	port: 8123,
	path: "/for-local/get-asyncapi-rosket",
	method: "GET",
	headers: {
		Accept: "text/event-stream",
	},
	serviceDir: "./src/handler/service",
	asyncApiRSocketFile: "./asyncapi-rosket.json",
	typesDir: "./src/handler/service/@types",
	typesFile: "./src/handler/service/@types/AsyncApiTypes.ts",
	commonRSocketServiceFile: "./src/handler/service/rsoketCommonService.ts",
	reconnectDelayMs: 10000,
	generateServices: true,
	keepAlive: true,
	log: console,
};

function mergeOptions(options = {}) {
	return {
		...DEFAULT_OPTIONS,
		...options,
		headers: {
			...DEFAULT_OPTIONS.headers,
			...(options.headers || {}),
		},
	};
}

function ensureDirSync(dirPath) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

function stripExtension(fileName) {
	return fileName.replace(/\.d\.ts$/i, "").replace(/\.ts$/i, "");
}

function normalizeImportPath(filePath) {
	let normalized = filePath.replace(/\\/g, "/");
	if (!normalized.startsWith(".")) {
		normalized = "./" + normalized;
	}
	return normalized;
}

function getRelativeImportPath(fromFilePath, toFilePath) {
	const fromDir = path.dirname(fromFilePath);
	const rel = path.relative(fromDir, toFilePath);
	return normalizeImportPath(stripExtension(rel));
}

function writeFileIfChanged(filePath, nextContent) {
	const prevContent = fs.existsSync(filePath)
		? fs.readFileSync(filePath, "utf8")
		: null;

	if (prevContent === nextContent) {
		return false;
	}

	fs.writeFileSync(filePath, nextContent, "utf8");
	return true;
}

function writeAsyncApiTypes(asyncapiData, rawOptions = {}) {
	const options = mergeOptions(rawOptions);
	options.log.log?.("Generating AsyncAPI RSocket TypeScript types...");
	try {
		ensureDirSync(path.dirname(options.typesFile));
		const fileContent = generateAsyncApiTypes(asyncapiData, options.asyncApiRSocketFile);
		fs.writeFileSync(options.typesFile, fileContent, "utf8");
		options.log.log?.("AsyncAPI RSocket TypeScript types generated successfully.");
	} catch (err) {
		options.log.error?.("Failed to generate AsyncAPI RSocket TypeScript types:", err.message);
	}
}

function parseServerSentEvent(event, log = console) {
	const lines = event.split("\n");
	let data = "";

	lines.forEach((line) => {
		if (line.startsWith("data:")) {
			data += line.slice(5).trim();
		}
	});

	if (!data) {
		return null;
	}

	try {
		return JSON.parse(data);
	} catch (err) {
		log.error?.("Failed to parse JSON data:", err.message, "\nRaw Data:", data);
		return null;
	}
}


function parseJsonResponseText(text, log = console) {
	try {
		return JSON.parse(text);
	} catch (err) {
		log.error?.("Failed to parse JSON response:", err.message, "\nRaw Data:", text);
		return null;
	}
}

function createRequestOptions(options, headersOverride = {}) {
	return {
		hostname: options.hostname,
		port: options.port,
		path: options.path,
		method: options.method,
		headers: {
			...options.headers,
			...headersOverride,
		},
	};
}

function requestJsonOnce(rawOptions = {}) {
	const options = mergeOptions(rawOptions);
	const requestLib = options.protocol === "https:" || options.https ? https : http;

	return new Promise((resolve, reject) => {
		const req = requestLib.request(
			createRequestOptions(options, { Accept: "application/json" }),
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () => {
					if (res.statusCode < 200 || res.statusCode >= 300) {
						reject(new Error(`HTTP ${res.statusCode}: ${body}`));
						return;
					}

					const parsed = parseJsonResponseText(body, options.log);
					if (!parsed) {
						reject(new Error("Failed to parse JSON response."));
						return;
					}

					resolve(parsed);
				});
			},
		);

		req.on("error", reject);
		req.end();
	});
}

async function generateAsyncApiRSocketFromHttp(rawOptions = {}) {
	const options = mergeOptions(rawOptions);
	options.log.log?.("Requesting AsyncAPI RSocket JSON once...");
	const asyncapiData = await requestJsonOnce(options);
	handleAsyncApiRSocketData(asyncapiData, options);
	return asyncapiData;
}

function generateAsyncApiRSocketFromFile(rawOptions = {}) {
	const options = mergeOptions(rawOptions);
	const inputFile = options.inputFile || options.asyncApiRSocketFile;
	options.log.log?.(`Reading AsyncAPI RSocket JSON from ${inputFile}...`);
	const asyncapiData = JSON.parse(fs.readFileSync(inputFile, "utf8"));
	handleAsyncApiRSocketData(asyncapiData, options);
	return asyncapiData;
}

function handleAsyncApiRSocketData(asyncapiData, rawOptions = {}) {
	const options = mergeOptions(rawOptions);
	ensureDirSync(options.serviceDir);
	ensureDirSync(options.typesDir);
	ensureDirSync(path.dirname(options.asyncApiRSocketFile));

	fs.writeFileSync(options.asyncApiRSocketFile, JSON.stringify(asyncapiData, null, 2), "utf8");
	options.log.log?.("AsyncAPI RSocket JSON saved successfully.");

	writeAsyncApiTypes(asyncapiData, options);


	if (options.generateServices) {
		generateAsyncApiRSocketServices({
			asyncapiData,
			serviceDir: options.serviceDir,
			typesDir: options.typesDir,
			typesFile: options.typesFile,
			commonRSocketServiceFile: options.commonRSocketServiceFile,
			log: options.log,
		});
	}
}

function connectToAsyncApiRSocketEventStream(rawOptions = {}) {
	const options = mergeOptions(rawOptions);
	ensureDirSync(options.typesDir);
	ensureDirSync(options.serviceDir);

	let eventBuffer = "";
	let reconnectTimeout = null;
	let req = null;

	function scheduleReconnect() {
		if (reconnectTimeout) {
			return;
		}
		options.log.log?.(`Scheduling reconnect in ${options.reconnectDelayMs / 1000} seconds...`);
		reconnectTimeout = setTimeout(() => {
			reconnectTimeout = null;
			connect();
		}, options.reconnectDelayMs);
	}

	function connect() {
		options.log.log?.("Attempting to connect to AsyncAPI RSocket EventStream...");

		req = http.request(
			createRequestOptions(options),
			(res) => {
				if (res.statusCode !== 200) {
					options.log.error?.(`Failed to connect: ${res.statusCode}`);
					scheduleReconnect();
					return;
				}

				options.log.log?.("Connected to AsyncAPI RSocket EventStream.");
				eventBuffer = "";
				res.setEncoding("utf8");

				res.on("data", (chunk) => {
					eventBuffer += chunk;
					let boundary = eventBuffer.indexOf("\n\n");
					while (boundary !== -1) {
						const event = eventBuffer.slice(0, boundary);
						eventBuffer = eventBuffer.slice(boundary + 2);

						const parsedData = parseServerSentEvent(event, options.log);
						if (parsedData) {
							options.log.log?.("Received updated AsyncAPI RSocket JSON.");
							try {
								handleAsyncApiRSocketData(parsedData, options);
							} catch (err) {
								options.log.error?.("Failed to process AsyncAPI RSocket JSON:", err.message);
							}
						}

						boundary = eventBuffer.indexOf("\n\n");
					}
				});

				res.on("end", () => {
					options.log.log?.("AsyncAPI RSocket EventStream connection closed by server.");
					scheduleReconnect();
				});
				res.on("close", () => {
					options.log.log?.("AsyncAPI RSocket EventStream connection closed.");
					scheduleReconnect();
				});
				res.on("error", (err) => {
					options.log.error?.("Stream error:", err.message);
					scheduleReconnect();
				});
			},
		);

		req.on("error", (err) => {
			options.log.error?.("Connection error:", err.message);
			scheduleReconnect();
		});

		req.end();
	}

	connect();

	let keepAliveTimer = null;
	if (options.keepAlive) {
		keepAliveTimer = setInterval(() => {}, 1000);
	}

	return {
		close() {
			if (reconnectTimeout) {
				clearTimeout(reconnectTimeout);
				reconnectTimeout = null;
			}
			if (keepAliveTimer) {
				clearInterval(keepAliveTimer);
				keepAliveTimer = null;
			}
			req?.destroy?.();
		},
	};
}

if (require.main === module) {
	const mode = process.argv.includes("--http") ? "http" : process.argv.includes("--file") ? "file" : "event-stream";
	if (mode === "http") {
		generateAsyncApiRSocketFromHttp().catch((err) => {
			console.error(err);
			process.exit(1);
		});
	} else if (mode === "file") {
		try {
			generateAsyncApiRSocketFromFile();
		} catch (err) {
			console.error(err);
			process.exit(1);
		}
	} else {
		connectToAsyncApiRSocketEventStream();
	}
	process.on("SIGINT", () => process.exit());
	process.on("SIGTERM", () => process.exit());
	process.on("uncaughtException", (err) => {
		console.error("Uncaught exception:", err);
		process.exit(1);
	});
}

module.exports = {
	DEFAULT_OPTIONS,
	mergeOptions,
	parseServerSentEvent,
	parseJsonResponseText,
	requestJsonOnce,
	generateAsyncApiRSocketFromHttp,
	generateAsyncApiRSocketFromFile,
	generateAsyncApiTypes,
	writeAsyncApiTypes,
	handleAsyncApiRSocketData,
	connectToAsyncApiRSocketEventStream,
	generateAsyncApiRSocketServices,
};
