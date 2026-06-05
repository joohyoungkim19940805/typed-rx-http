#!/usr/bin/env node
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { generateSwaggerServices } = require("./generateSwaggerXxxService.cjs");

const DEFAULT_OPTIONS = {
	hostname: "localhost",
	port: 8123,
	path: "/for-local/get-swagger",
	method: "GET",
	headers: {
		Accept: "text/event-stream",
	},
	serviceDir: "./src/handler/service",
	swaggerFile: "./swagger.json",
	typesDir: "./src/handler/service/@types",
	typesFile: "./src/handler/service/@types/ApiTypes.d.ts",
	unionArraysFile: "./src/handler/service/apiUnionArrays.ts",
	commonServiceFile: "./src/handler/service/commonService.ts",
	reconnectDelayMs: 10000,
	openApiTypescriptCommand: null,
	openApiTypescriptPackage: "openapi-typescript@latest",
	openApiTypescriptTypescriptPackage: "typescript@5.9.3",
	generateServices: true,
	generateUnionArraysFile: true,
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

function quoteShellArg(value) {
	return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function createOpenApiTypescriptCommand(options) {
	if (options.openApiTypescriptCommand) {
		return options.openApiTypescriptCommand;
	}

	const packages = [options.openApiTypescriptPackage];
	if (options.openApiTypescriptTypescriptPackage) {
		packages.push(options.openApiTypescriptTypescriptPackage);
	}

	const packageArgs = packages
		.filter(Boolean)
		.map((packageName) => `-p ${quoteShellArg(packageName)}`)
		.join(" ");

	return `npx -y ${packageArgs} openapi-typescript ${quoteShellArg(options.swaggerFile)} --output ${quoteShellArg(options.typesFile)}`;
}

function generateTypes(options, onSuccess = () => {}) {
	const command = createOpenApiTypescriptCommand(options);

	options.log.log?.("Running openapi-typescript...");
	exec(command, (err, stdout, stderr) => {
		if (err) {
			options.log.error?.("Failed to generate TypeScript types:", err.message);
			return;
		}
		if (stdout) {
			options.log.log?.(stdout);
		}
		if (stderr) {
			options.log.error?.("openapi-typescript stderr:", stderr);
		}
		options.log.log?.("TypeScript types generated successfully.");
		onSuccess();
	});
}

function generateUnionArrays(swaggerData) {
    console.log('Generating union arrays file...');
    try {
        const schemas = swaggerData?.components?.schemas;
        const pathsData = swaggerData?.paths;

        if (!schemas && !pathsData) {
            console.log('No schemas or paths found in swagger.json.');
            return;
        }

        const httpMethods = [
            'get',
            'put',
            'post',
            'delete',
            'options',
            'head',
            'patch',
            'trace',
        ];

        const parameterLocations = ['query', 'path', 'header', 'cookie'];

        const escapeTypeKey = value =>
            String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        const toPascalCase = value =>
            String(value)
                .replace(/[{}]/g, '')
                .split(/[^a-zA-Z0-9]+/)
                .filter(Boolean)
                .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                .join('');

        const toIdentifier = value => {
            const identifier = String(value)
                .replace(/[{}]/g, 'By')
                .split(/[^a-zA-Z0-9]+/)
                .filter(Boolean)
                .map((part, index) => {
                    if (index === 0) {
                        return part.charAt(0).toLowerCase() + part.slice(1);
                    }

                    return part.charAt(0).toUpperCase() + part.slice(1);
                })
                .join('');

            if (!identifier) {
                return 'value';
            }

            if (/^[0-9]/.test(identifier)) {
                return `_${identifier}`;
            }

            return identifier;
        };

        const getPathVariableName = pathName => {
            const variableName = String(pathName)
                .split('/')
                .filter(Boolean)
                .map(segment => {
                    if (
                        segment.startsWith('{') &&
                        segment.endsWith('}')
                    ) {
                        return `By${toPascalCase(segment)}`;
                    }

                    return toPascalCase(segment);
                })
                .join('');

            return variableName || 'root';
        };

        const resolveRef = ref => {
            if (!ref || !String(ref).startsWith('#/')) {
                return null;
            }

            return String(ref)
                .slice(2)
                .split('/')
                .map(key =>
                    key.replace(/~1/g, '/').replace(/~0/g, '~')
                )
                .reduce((current, key) => {
                    if (!current) {
                        return null;
                    }

                    return current[key];
                }, swaggerData);
        };

        const resolveObject = object => {
            if (object?.$ref) {
                return resolveRef(object.$ref);
            }

            return object;
        };

        const uniqueEnumValues = values => {
            const result = [];
            const seen = new Set();

            for (const value of values) {
                if (value === null || value === undefined) {
                    continue;
                }

                const key = JSON.stringify(value);
                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                result.push(value);
            }

            return result;
        };

        const getEnumDetails = schema => {
            const resolvedSchema = resolveObject(schema);
            if (!resolvedSchema) {
                return null;
            }

            if (
                resolvedSchema.enum &&
                Array.isArray(resolvedSchema.enum)
            ) {
                const enumValues = uniqueEnumValues(resolvedSchema.enum);
                if (!enumValues.length) {
                    return null;
                }

                return {
                    enumValues,
                    isArray: false,
                };
            }

            const items = resolveObject(resolvedSchema.items);
            if (
                resolvedSchema.type === 'array' &&
                items?.enum &&
                Array.isArray(items.enum)
            ) {
                const enumValues = uniqueEnumValues(items.enum);
                if (!enumValues.length) {
                    return null;
                }

                return {
                    enumValues,
                    isArray: true,
                };
            }

            if (resolvedSchema.type === 'array') {
                const itemEnumDetails = getEnumDetails(items);
                if (itemEnumDetails) {
                    return {
                        enumValues: itemEnumDetails.enumValues,
                        isArray: true,
                    };
                }
            }

            for (const unionKey of ['oneOf', 'anyOf', 'allOf']) {
                if (!Array.isArray(resolvedSchema[unionKey])) {
                    continue;
                }

                const enumValues = [];

                for (const childSchema of resolvedSchema[unionKey]) {
                    const childEnumDetails = getEnumDetails(childSchema);
                    if (!childEnumDetails || childEnumDetails.isArray) {
                        continue;
                    }

                    enumValues.push(...childEnumDetails.enumValues);
                }

                const uniqueValues = uniqueEnumValues(enumValues);
                if (uniqueValues.length) {
                    return {
                        enumValues: uniqueValues,
                        isArray: false,
                    };
                }
            }

            return null;
        };

        let fileContent = `// This file is auto-generated by a script. Do not edit.\n\n`;
        fileContent += `import type { components, paths } from './@types/ApiTypes';\n\n`;
        fileContent += `type ArrayItem<T> = T extends readonly (infer U)[] ? U : T extends (infer U)[] ? U : never;\n\n`;

        if (schemas) {
            for (const schemaName in schemas) {
                const schema = resolveObject(schemas[schemaName]);
                const properties = schema?.properties;
                if (!properties) continue;

                for (const propName in properties) {
                    const propDetails = properties[propName];
                    const enumDetails = getEnumDetails(propDetails);
                    if (!enumDetails) continue;

                    const variableName = `${schemaName}_${propName}`;
                    const schemaKey = escapeTypeKey(schemaName);
                    const propKey = escapeTypeKey(propName);
                    const propertyType = `NonNullable<components['schemas']['${schemaKey}']['${propKey}']>`;
                    const typeName = enumDetails.isArray
                        ? `ArrayItem<${propertyType}>`
                        : propertyType;
                    const arrayString = JSON.stringify(
                        enumDetails.enumValues
                    );

                    fileContent += `export const ${variableName}: readonly ${typeName}[] = ${arrayString} as const;\n`;
                }
            }
        }

        if (pathsData) {
            for (const pathName in pathsData) {
                const pathItem = pathsData[pathName];
                const pathParameters = Array.isArray(pathItem?.parameters)
                    ? pathItem.parameters
                    : [];
                const pathVariableName = getPathVariableName(pathName);
                const pathKey = escapeTypeKey(pathName);

                for (const pathParameter of pathParameters) {
                    const parameter = resolveObject(pathParameter);
                    if (
                        !parameter ||
                        !parameterLocations.includes(parameter.in)
                    ) {
                        continue;
                    }

                    const enumDetails = getEnumDetails(parameter.schema);
                    if (!enumDetails) {
                        continue;
                    }

                    const parameterKey = escapeTypeKey(parameter.name);
                    const variableName = `${pathVariableName}_${toIdentifier(
                        parameter.in
                    )}_${toIdentifier(parameter.name)}`;
                    const parameterType = `NonNullable<NonNullable<paths['${pathKey}']['parameters']['${parameter.in}']>['${parameterKey}']>`;
                    const typeName = enumDetails.isArray
                        ? `ArrayItem<${parameterType}>`
                        : parameterType;
                    const arrayString = JSON.stringify(
                        enumDetails.enumValues
                    );

                    fileContent += `export const ${variableName}: readonly ${typeName}[] = ${arrayString} as const;\n`;
                }

                for (const method of httpMethods) {
                    const operation = pathItem?.[method];
                    if (!operation) continue;

                    const operationParameters = Array.isArray(
                        operation.parameters
                    )
                        ? operation.parameters
                        : [];

                    for (const operationParameter of operationParameters) {
                        const parameter = resolveObject(operationParameter);
                        if (
                            !parameter ||
                            !parameterLocations.includes(parameter.in)
                        ) {
                            continue;
                        }

                        const enumDetails = getEnumDetails(parameter.schema);
                        if (!enumDetails) {
                            continue;
                        }

                        const parameterKey = escapeTypeKey(parameter.name);
                        const variableName = `${pathVariableName}_${method}_${toIdentifier(
                            parameter.in
                        )}_${toIdentifier(parameter.name)}`;
                        const parameterType = `NonNullable<NonNullable<paths['${pathKey}']['${method}']['parameters']['${parameter.in}']>['${parameterKey}']>`;
                        const typeName = enumDetails.isArray
                            ? `ArrayItem<${parameterType}>`
                            : parameterType;
                        const arrayString = JSON.stringify(
                            enumDetails.enumValues
                        );

                        fileContent += `export const ${variableName}: readonly ${typeName}[] = ${arrayString} as const;\n`;
                    }
                }
            }
        }

        fs.writeFileSync(UNION_ARRAYS_FILE, fileContent);
        console.log('Union arrays file generated successfully.');
    } catch (err) {
        console.error('Failed to generate union arrays file:', err);
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

async function generateSwaggerFromHttp(rawOptions = {}) {
	const options = mergeOptions(rawOptions);
	options.log.log?.("Requesting Swagger JSON once...");
	const swaggerData = await requestJsonOnce(options);
	handleSwaggerData(swaggerData, options);
	return swaggerData;
}

function generateSwaggerFromFile(rawOptions = {}) {
	const options = mergeOptions(rawOptions);
	const inputFile = options.inputFile || options.swaggerFile;
	options.log.log?.(`Reading Swagger JSON from ${inputFile}...`);
	const swaggerData = JSON.parse(fs.readFileSync(inputFile, "utf8"));
	handleSwaggerData(swaggerData, options);
	return swaggerData;
}

function handleSwaggerData(swaggerData, rawOptions = {}) {
	const options = mergeOptions(rawOptions);
	ensureDirSync(options.typesDir);
	ensureDirSync(options.serviceDir);
	ensureDirSync(path.dirname(options.swaggerFile));

	fs.writeFileSync(options.swaggerFile, JSON.stringify(swaggerData, null, 2), "utf8");
	options.log.log?.("Swagger JSON saved successfully.");

	generateTypes(options, () => {
		if (options.generateUnionArraysFile) {
			generateUnionArrays(swaggerData, options);
		}

		if (options.generateServices) {
			generateSwaggerServices({
				swaggerData,
				serviceDir: options.serviceDir,
				typesDir: options.typesDir,
				typesFile: options.typesFile,
				commonServiceFile: options.commonServiceFile,
				log: options.log,
			});
		}
	});
}

function connectToSwaggerEventStream(rawOptions = {}) {
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
		options.log.log?.("Attempting to connect to Swagger EventStream...");

		req = http.request(
			createRequestOptions(options),
			(res) => {
				if (res.statusCode !== 200) {
					options.log.error?.(`Failed to connect: ${res.statusCode}`);
					scheduleReconnect();
					return;
				}

				options.log.log?.("Connected to Swagger EventStream.");
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
							options.log.log?.("Received updated Swagger JSON.");
							try {
								handleSwaggerData(parsedData, options);
							} catch (err) {
								options.log.error?.("Failed to process Swagger JSON:", err.message);
							}
						}

						boundary = eventBuffer.indexOf("\n\n");
					}
				});

				res.on("end", () => {
					options.log.log?.("Swagger EventStream connection closed by server.");
					scheduleReconnect();
				});
				res.on("close", () => {
					options.log.log?.("Swagger EventStream connection closed.");
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
		generateSwaggerFromHttp().catch((err) => {
			console.error(err);
			process.exit(1);
		});
	} else if (mode === "file") {
		try {
			generateSwaggerFromFile();
		} catch (err) {
			console.error(err);
			process.exit(1);
		}
	} else {
		connectToSwaggerEventStream();
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
	generateSwaggerFromHttp,
	generateSwaggerFromFile,
	createOpenApiTypescriptCommand,
	generateTypes,
	generateUnionArrays,
	handleSwaggerData,
	connectToSwaggerEventStream,
	generateSwaggerServices,
};
