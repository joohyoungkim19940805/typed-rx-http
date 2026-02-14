// src/http-core/types.ts
var HttpResponseError = class extends Error {
  constructor(response, args, data, message) {
    super(message ?? `HTTP ${response.status}`);
    this.response = response;
    this.args = args;
    this.data = data;
    this.name = "HttpResponseError";
  }
  get status() {
    return this.response.status;
  }
};
var isHttpResponseError = (e) => e instanceof HttpResponseError;

// src/http-core/utils.ts
var replacePathVariable = (template, record) => {
  return template.replace(/\{(.*?)\}/g, (_, key) => {
    const value = record[key];
    return value != null ? String(encodeURIComponent(value)) : `{${key}}`;
  });
};
var toQueryString = (record) => {
  const qs = Object.entries(record).reduce((query, [key, value]) => {
    if (value == null) return query;
    let pair = "";
    if (Array.isArray(value)) {
      pair = value.map(
        (item) => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`
      ).join("&");
    } else {
      pair = `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
    }
    return query ? `${query}&${pair}` : pair;
  }, "");
  return `?${qs}`;
};
var stableStringify = (obj) => {
  if (!obj) return "{}";
  if (typeof obj !== "object") return JSON.stringify(obj);
  const allKeys = /* @__PURE__ */ new Set();
  JSON.stringify(obj, (k, v) => (allKeys.add(k), v));
  const keys = Array.from(allKeys).sort();
  return JSON.stringify(obj, keys);
};
var joinUrl = (baseUrl, path) => {
  const b = baseUrl.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${b}/${p}`;
};

export { HttpResponseError, isHttpResponseError, joinUrl, replacePathVariable, stableStringify, toQueryString };
//# sourceMappingURL=chunk-RL7KIYQL.js.map
//# sourceMappingURL=chunk-RL7KIYQL.js.map