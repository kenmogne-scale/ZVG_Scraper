import he from "he";

const MONTHS = {
  januar: "01",
  februar: "02",
  maerz: "03",
  märz: "03",
  april: "04",
  mai: "05",
  juni: "06",
  juli: "07",
  august: "08",
  september: "09",
  oktober: "10",
  november: "11",
  dezember: "12"
};

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mojibakeScore(value) {
  const matches = String(value ?? "").match(/Ã.|Â.|â.|¤|�/g);
  return matches ? matches.length : 0;
}

export function repairMojibake(value = "") {
  const input = String(value ?? "");
  if (!/[ÃÂâ�]/.test(input)) {
    return input;
  }

  try {
    const repaired = Buffer.from(input, "latin1").toString("utf8");
    return mojibakeScore(repaired) < mojibakeScore(input) ? repaired : input;
  } catch {
    return input;
  }
}

export function normalizeWhitespace(value) {
  return repairMojibake(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtml(value = "") {
  return normalizeWhitespace(
    he
      .decode(value)
      .replace(/\u00a0/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

export function extractFirstNumber(value = "") {
  const totalMatch = value.match(/Gesamtwert:\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  const match = totalMatch ?? value.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
  if (!match) {
    return null;
  }

  return Number.parseFloat(match[1].replace(/\./g, "").replace(",", "."));
}

export function slugTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "_" + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("-");
}

export function parseGermanDate(value = "") {
  const cleaned = normalizeWhitespace(value);
  const match = cleaned.match(/(\d{1,2})\.\s+([A-Za-zÄÖÜäöü]+)\s+(\d{4})(?:,\s+(\d{2}:\d{2}))?/u);
  if (!match) {
    return null;
  }

  const [, day, rawMonth, year, time = "00:00"] = match;
  const month = MONTHS[rawMonth.toLowerCase()];
  if (!month) {
    return null;
  }

  return `${year}-${month}-${String(day).padStart(2, "0")}T${time}:00`;
}

export function parseAddress(value = "") {
  const cleaned = normalizeWhitespace(value);
  const parts = cleaned.split(",").map((part) => normalizeWhitespace(part)).filter(Boolean);
  if (parts.length === 0) {
    return {
      full: cleaned,
      street: null,
      postalCode: null,
      city: null,
      district: null
    };
  }

  const street = parts[0] ?? null;
  let postalCode = null;
  let city = null;
  let district = null;

  if (parts[1]) {
    const match = parts[1].match(/^(\d{5})\s+(.+)$/);
    if (match) {
      postalCode = match[1];
      city = match[2];
    } else {
      city = parts[1];
    }
  }

  if (parts[2]) {
    district = parts.slice(2).join(", ");
  }

  return {
    full: cleaned,
    street,
    postalCode,
    city,
    district
  };
}

export function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }

  return stringValue;
}

export function buildAuctionKey(record) {
  return record.zvgId
    ? `zvg:${record.zvgId}`
    : `fallback:${record.landCode}:${record.aktenzeichen}`;
}
