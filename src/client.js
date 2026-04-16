import iconv from "iconv-lite";
import { BASE_URL } from "./constants.js";
import { repairMojibake } from "./utils.js";

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function buildSearchForm(stateCode, { objectTypeIds = null } = {}) {
  const body = new URLSearchParams();
  body.set("order_by", "2");
  body.set("land_abk", stateCode);
  body.set("ger_id", "0");
  body.set("ger_name", "");

  for (const name of [
    "az1",
    "az2",
    "az3",
    "az4",
    "art",
    "obj",
    "str",
    "hnr",
    "plz",
    "ort",
    "ortsteil",
    "vtermin",
    "btermin"
  ]) {
    body.set(name, "");
  }

  if (objectTypeIds && objectTypeIds.length > 0) {
    for (const objectTypeId of objectTypeIds) {
      body.append("obj_arr[]", objectTypeId);
    }
  }

  body.set("button", "Suchen");
  return body;
}

function requestHeaders(initHeaders = {}) {
  return {
    "user-agent": "ScaleInvestScraper/0.1 (+internal use)",
    ...initHeaders
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(statusCode) {
  return RETRYABLE_STATUS_CODES.has(statusCode);
}

async function fetchWithRetry(url, init = {}, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 800;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: requestHeaders(init.headers)
      });

      if (!response.ok) {
        if (attempt < maxAttempts && shouldRetryStatus(response.status)) {
          await sleep(retryDelayMs * attempt);
          continue;
        }

        throw new Error(`Request failed with ${response.status} for ${url}`);
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }

      await sleep(retryDelayMs * attempt);
    }
  }

  throw lastError ?? new Error(`Request failed for ${url}`);
}

export async function fetchDecoded(url, init = {}, options = {}) {
  const response = await fetchWithRetry(url, init, options);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const charsetMatch = contentType.match(/charset=([^;]+)/i);
  const charset = charsetMatch?.[1]?.trim().toLowerCase() ?? "utf-8";
  const normalizedCharset =
    charset === "iso-8859-1" || charset === "latin1" || charset === "windows-1252"
      ? "latin1"
      : "utf8";

  return repairMojibake(iconv.decode(buffer, normalizedCharset));
}

export async function searchState(stateCode, { objectTypeIds = null } = {}) {
  const body = buildSearchForm(stateCode, { objectTypeIds });
  return fetchDecoded(`${BASE_URL}?button=Suchen&all=1`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
}

export async function fetchDetail(detailUrl) {
  return fetchDecoded(detailUrl, {
    headers: {
      referer: `${BASE_URL}?button=Suchen`
    }
  });
}

export async function fetchBinary(url, init = {}, options = {}) {
  const response = await fetchWithRetry(url, init, options);

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    contentDisposition: response.headers.get("content-disposition"),
    contentLength: response.headers.get("content-length")
  };
}
