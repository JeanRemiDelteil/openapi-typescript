// settings & const
const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
};

const LEADING_QUESTION_RE = /^\?+/;
const PATH_PARAM_RE = /\{[^{}]+\}/g;

/**
 * Create an openapi-fetch client.
 * @type {import("./index.js").default}
 */
export default function createClient(clientOptions) {
  const {
    fetch: baseFetch = globalThis.fetch,
    querySerializer: globalQuerySerializer,
    bodySerializer: globalBodySerializer,
    ...baseOptions
  } = clientOptions ?? {};
  let baseUrl = baseOptions.baseUrl ?? "";
  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1); // remove trailing slash
  }

  /**
   * Per-request fetch (keeps settings created in createClient()
   * @param {T} url
   * @param {import('./index.js').FetchOptions<T>} fetchOptions
   */
  async function coreFetch(url, fetchOptions) {
    const {
      fetch = baseFetch,
      headers,
      body: requestBody,
      params = {},
      parseAs = "json",
      querySerializer: requestQuerySerializer,
      bodySerializer = globalBodySerializer ?? defaultBodySerializer,
      ...init
    } = fetchOptions || {};

    let querySerializer =
      typeof globalQuerySerializer === "function"
        ? globalQuerySerializer
        : createQuerySerializer(globalQuerySerializer);
    if (requestQuerySerializer) {
      querySerializer =
        typeof requestQuerySerializer === "function"
          ? requestQuerySerializer
          : createQuerySerializer({
              ...(typeof globalQuerySerializer === "object"
                ? globalQuerySerializer
                : {}),
              ...requestQuerySerializer,
            });
    }

    // URL
    const finalURL = createFinalURL(url, {
      baseUrl,
      params,
      querySerializer,
    });
    const finalHeaders = mergeHeaders(
      DEFAULT_HEADERS,
      clientOptions?.headers,
      headers,
      params.header,
    );

    // fetch!
    /** @type {RequestInit} */
    const requestInit = {
      redirect: "follow",
      ...baseOptions,
      ...init,
      headers: finalHeaders,
    };

    if (requestBody) {
      requestInit.body = bodySerializer(requestBody);
    }
    // remove `Content-Type` if serialized body is FormData; browser will correctly set Content-Type & boundary expression
    if (requestInit.body instanceof FormData) {
      finalHeaders.delete("Content-Type");
    }

    const response = await fetch(finalURL, requestInit);

    // handle empty content
    // note: we return `{}` because we want user truthy checks for `.data` or `.error` to succeed
    if (
      response.status === 204 ||
      response.headers.get("Content-Length") === "0"
    ) {
      return response.ok ? { data: {}, response } : { error: {}, response };
    }

    // parse response (falling back to .text() when necessary)
    if (response.ok) {
      // if "stream", skip parsing entirely
      if (parseAs === "stream") {
        // fix for bun: bun consumes response.body, therefore clone before accessing
        // TODO: test this?
        return { data: response.clone().body, response };
      }
      const cloned = response.clone();
      return {
        data:
          typeof cloned[parseAs] === "function"
            ? await cloned[parseAs]()
            : await cloned.text(),
        response,
      };
    }

    // handle errors (always parse as .json() or .text())
    let error = {};
    try {
      error = await response.clone().json();
    } catch {
      error = await response.clone().text();
    }
    return { error, response };
  }

  return {
    /** Call a GET endpoint */
    async GET(url, init) {
      return coreFetch(url, { ...init, method: "GET" });
    },
    /** Call a PUT endpoint */
    async PUT(url, init) {
      return coreFetch(url, { ...init, method: "PUT" });
    },
    /** Call a POST endpoint */
    async POST(url, init) {
      return coreFetch(url, { ...init, method: "POST" });
    },
    /** Call a DELETE endpoint */
    async DELETE(url, init) {
      return coreFetch(url, { ...init, method: "DELETE" });
    },
    /** Call a OPTIONS endpoint */
    async OPTIONS(url, init) {
      return coreFetch(url, { ...init, method: "OPTIONS" });
    },
    /** Call a HEAD endpoint */
    async HEAD(url, init) {
      return coreFetch(url, { ...init, method: "HEAD" });
    },
    /** Call a PATCH endpoint */
    async PATCH(url, init) {
      return coreFetch(url, { ...init, method: "PATCH" });
    },
    /** Call a TRACE endpoint */
    async TRACE(url, init) {
      return coreFetch(url, { ...init, method: "TRACE" });
    },
  };
}

// utils

/**
 * Serialize primitive param values
 * @type {import("./index.js").serializePrimitiveParam}
 */
export function serializePrimitiveParam(name, value, options) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    throw new Error(
      `Deeply-nested arrays/objects aren’t supported. Provide your own \`querySerializer()\` to handle these.`,
    );
  }
  return `${name}=${options?.allowReserved === true ? value : encodeURIComponent(value)}`;
}

/**
 * Serialize object param (shallow only)
 * @type {import("./index.js").serializeObjectParam}
 */
export function serializeObjectParam(name, value, options) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const values = [];
  const joiner =
    {
      simple: ",",
      label: ".",
      matrix: ";",
    }[options.style] || "&";

  // explode: false
  if (options.style !== "deepObject" && options.explode === false) {
    for (const k in value) {
      values.push(
        k,
        options.allowReserved === true
          ? value[k]
          : encodeURIComponent(value[k]),
      );
    }
    const final = values.join(","); // note: values are always joined by comma in explode: false (but joiner can prefix)
    switch (options.style) {
      case "form": {
        return `${name}=${final}`;
      }
      case "label": {
        return `.${final}`;
      }
      case "matrix": {
        return `;${name}=${final}`;
      }
      default: {
        return final;
      }
    }
  }

  // explode: true
  for (const k in value) {
    const finalName = options.style === "deepObject" ? `${name}[${k}]` : k;
    values.push(serializePrimitiveParam(finalName, value[k], options));
  }
  const final = values.join(joiner);
  return options.style === "label" || options.style === "matrix"
    ? `${joiner}${final}`
    : final;
}

/**
 * Serialize array param (shallow only)
 * @type {import("./index.js").serializeArrayParam}
 */
export function serializeArrayParam(name, value, options) {
  if (!Array.isArray(value)) {
    return "";
  }

  // explode: false
  if (options.explode === false) {
    const joiner =
      { form: ",", spaceDelimited: "%20", pipeDelimited: "|" }[options.style] ||
      ","; // note: for arrays, joiners vary wildly based on style + explode behavior
    const final = (
      options.allowReserved === true
        ? value
        : value.map((v) => encodeURIComponent(v))
    ).join(joiner);
    switch (options.style) {
      case "simple": {
        return final;
      }
      case "label": {
        return `.${final}`;
      }
      case "matrix": {
        return `;${name}=${final}`;
      }
      case "spaceDelimited":
      case "pipeDelimited":
      default: {
        return `${name}=${final}`;
      }
    }
  }

  // explode: true
  const joiner = { simple: ",", label: ".", matrix: ";" }[options.style] || "&";
  const values = [];
  for (const v of value) {
    if (options.style === "simple" || options.style === "label") {
      values.push(options.allowReserved === true ? v : encodeURIComponent(v));
    } else {
      values.push(serializePrimitiveParam(name, v, options));
    }
  }
  return options.style === "label" || options.style === "matrix"
    ? `${joiner}${values.join(joiner)}`
    : values.join(joiner);
}

/**
 * Serialize query params to string
 * @type {import("./index.js").createQuerySerializer}
 */
export function createQuerySerializer(options) {
  return function querySerializer(queryParams) {
    const search = [];
    if (queryParams && typeof queryParams === "object") {
      for (const name in queryParams) {
        if (queryParams[name] === undefined || queryParams[name] === null) {
          continue;
        }
        if (Array.isArray(queryParams[name])) {
          search.push(
            serializeArrayParam(name, queryParams[name], {
              style: "form",
              explode: true,
              ...options?.array,
              allowReserved: options?.allowReserved || false,
            }),
          );
          continue;
        }
        if (typeof queryParams[name] === "object") {
          search.push(
            serializeObjectParam(name, queryParams[name], {
              style: "deepObject",
              explode: true,
              ...options?.object,
              allowReserved: options?.allowReserved || false,
            }),
          );
          continue;
        }
        search.push(serializePrimitiveParam(name, queryParams[name], options));
      }
    }
    return search.join("&");
  };
}

/**
 * Handle different OpenAPI 3.x serialization styles
 * @type {import("./index.js").defaultPathSerializer}
 * @see https://swagger.io/docs/specification/serialization/#path
 */
export function defaultPathSerializer(pathname, pathParams) {
  const matches = pathname.match(PATH_PARAM_RE);
  if (!matches || !matches.length) {
    return undefined;
  }
  let nextURL = pathname;
  for (const match of matches) {
    let paramName = match.substring(1, match.length - 1);
    let explode = false;
    let style = "simple";
    if (paramName.endsWith("*")) {
      explode = true;
      paramName = paramName.substring(0, paramName.length - 1);
    }
    if (paramName.startsWith(".")) {
      style = "label";
      paramName = paramName.substring(1);
    } else if (paramName.startsWith(";")) {
      style = "matrix";
      paramName = paramName.substring(1);
    }
    if (
      !pathParams ||
      pathParams[paramName] === undefined ||
      pathParams[paramName] === null
    ) {
      continue;
    }
    if (Array.isArray(pathParams[paramName])) {
      nextURL = nextURL.replace(
        match,
        serializeArrayParam(paramName, pathParams[paramName], {
          style,
          explode,
        }),
      );
      continue;
    }
    if (typeof pathParams[paramName] === "object") {
      nextURL = nextURL.replace(
        match,
        serializeObjectParam(paramName, pathParams[paramName], {
          style,
          explode,
        }),
      );
      continue;
    }
    if (style === "matrix") {
      nextURL = nextURL.replace(
        match,
        `;${serializePrimitiveParam(paramName, pathParams[paramName])}`,
      );
      continue;
    }
    nextURL = nextURL.replace(
      match,
      style === "label" ? `.${pathParams[paramName]}` : pathParams[paramName],
    );
    continue;
  }
  return nextURL;
}

/**
 * Serialize body object to string
 * @type {import("./index.js").defaultBodySerializer}
 */
export function defaultBodySerializer(body) {
  return JSON.stringify(body);
}

/**
 * Construct URL string from baseUrl and handle path and query params
 * @type {import("./index.js").createFinalURL}
 */
export function createFinalURL(pathname, options) {
  let finalURL = `${options.baseUrl}${pathname}`;
  if (options.params?.path) {
    finalURL = defaultPathSerializer(finalURL, options.params.path);
  }
  const search = options
    .querySerializer(options.params.query ?? {})
    .replace(LEADING_QUESTION_RE, "");
  if (search) {
    finalURL += `?${search}`;
  }
  return finalURL;
}

/**
 * Merge headers a and b, with b taking priority
 * @type {import("./index.js").mergeHeaders}
 */
export function mergeHeaders(...allHeaders) {
  const headers = new Headers();
  for (const headerSet of allHeaders) {
    if (!headerSet || typeof headerSet !== "object") {
      continue;
    }
    const iterator =
      headerSet instanceof Headers
        ? headerSet.entries()
        : Object.entries(headerSet);
    for (const [k, v] of iterator) {
      if (v === null) {
        headers.delete(k);
      } else if (v !== undefined) {
        headers.set(k, v);
      }
    }
  }
  return headers;
}
