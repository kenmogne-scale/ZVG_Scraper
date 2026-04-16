import { load } from "cheerio";
import { BASE_URL, STATES } from "./constants.js";
import {
  decodeHtml,
  extractFirstNumber,
  normalizeWhitespace,
  parseAddress,
  parseGermanDate
} from "./utils.js";

const STATE_NAME_BY_CODE = Object.fromEntries(STATES.map((s) => [s.code, s.name]));

function classifyDocument(doc) {
  const name = (doc.name ?? "").toLowerCase();
  const label = (doc.label ?? "").toLowerCase();
  const combined = `${label} ${name}`;

  if (/gutachten|wertgutachten|verkehrswertgutachten|bewertung/i.test(combined)) {
    return "Gutachten";
  }
  if (/expos[eé]|objekt\s*beschreibung|objekt\s*info/i.test(combined)) {
    return "Expose";
  }
  if (/foto|photo|bild|bild\s*er|image|aufnahme/i.test(combined)) {
    return "Foto";
  }
  if (/bekanntmachung|amtliche|beschluss|anordnung/i.test(combined)) {
    return "Bekanntmachung";
  }
  if (/grundbuch|grundriss|lageplan|flurkarte|karte/i.test(combined)) {
    return "Grundbuch/Plan";
  }
  return "Sonstiges";
}

function parseHrefParams(href = "") {
  const absolute = new URL(href, BASE_URL);
  return {
    url: absolute.toString(),
    zvgId: absolute.searchParams.get("zvg_id"),
    landCode: absolute.searchParams.get("land_abk")
  };
}

function normalizeAktenzeichen(value = "") {
  return normalizeWhitespace(value)
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*K\s*/g, " K ");
}

function parseListBlock(blockHtml, fallbackStateCode) {
  const $ = load(`<table>${blockHtml}</table>`, { decodeEntities: false });
  const rows = $("tr").toArray();
  if (rows.length === 0) {
    return null;
  }

  const firstRow = $(rows[0]);
  const firstCells = firstRow.find("td");
  const detailAnchor = firstRow.find('a[href*="button=showZvg"]').first();
  const detailHref = detailAnchor.attr("href") ?? null;
  const detailMeta = detailHref ? parseHrefParams(detailHref) : {};
  const aktenzeichen = normalizeAktenzeichen(
    decodeHtml(detailAnchor.length ? detailAnchor.text() : firstCells.eq(1).text()).replace(
      /\(Detailansicht\)/i,
      ""
    )
  );
  const lastUpdate = normalizeWhitespace(
    decodeHtml(firstCells.last().text()).replace(/[()]/g, "")
  );

  const summaryFields = {};
  const documents = [];

  for (const row of rows.slice(1)) {
    const cells = $(row).find("td");
    if (cells.length < 2) {
      continue;
    }

    const label = normalizeWhitespace(decodeHtml(cells.eq(0).text()).replace(/:$/, ""));
    const valueCell = cells.eq(1);
    const value = normalizeWhitespace(decodeHtml(valueCell.html() ?? valueCell.text()));

    const attachmentLink = $(row).find('a[href*="button=showAnhang"]').first();
    if (attachmentLink.length) {
      const href = attachmentLink.attr("href");
      const sizeText = normalizeWhitespace(decodeHtml($(row).text()))
        .replace(/^.*?:\s*/, "")
        .replace(normalizeWhitespace(decodeHtml(attachmentLink.text())), "")
        .trim();

      const doc = {
        label: label || "Anhang",
        name: normalizeWhitespace(decodeHtml(attachmentLink.text())),
        url: href ? new URL(href.trim(), BASE_URL).toString() : null,
        sizeText: sizeText || null
      };
      doc.category = classifyDocument(doc);
      documents.push(doc);
      continue;
    }

    if (label) {
      summaryFields[label] = value;
    }
  }

  const locationText = summaryFields["Objekt/Lage"] ?? null;
  const locationParts = locationText
    ? locationText.split(":").map((part) => normalizeWhitespace(part))
    : [];
  const objectHeading = locationParts[0] ?? null;
  const landCode = detailMeta.landCode ?? fallbackStateCode;
  const address = parseAddress(locationParts.slice(1).join(":"));
  address.state = STATE_NAME_BY_CODE[landCode] ?? null;
  const objectType = objectHeading ? normalizeWhitespace(objectHeading.split(",")[0]) : null;

  return {
    zvgId: detailMeta.zvgId ?? null,
    landCode,
    detailUrl: detailMeta.url ?? null,
    detailAvailable: Boolean(detailMeta.url),
    aktenzeichen,
    lastUpdateText: lastUpdate || null,
    courtText: summaryFields["Amtsgericht"] ?? null,
    objectType,
    locationText,
    address,
    valuationText: summaryFields["Verkehrswert in €"] ?? summaryFields["Verkehrswert in â¬"] ?? null,
    valuationAmountEur: extractFirstNumber(
      summaryFields["Verkehrswert in €"] ?? summaryFields["Verkehrswert in â¬"] ?? ""
    ),
    auctionDateText: summaryFields["Termin"] ?? null,
    auctionDateIso: parseGermanDate(summaryFields["Termin"] ?? ""),
    documents,
    summaryFields
  };
}

export function parseSearchResults(html, fallbackStateCode) {
  if (/keine\s+termine\s+gefunden/i.test(html)) {
    return [];
  }

  return html
    .split(/<!--Aktenzeichen-+-->/i)
    .slice(1)
    .map((block) => block.split(/<tr><td\s+colspan=3><hr><\/td><\/tr>/i)[0])
    .map((block) => parseListBlock(block, fallbackStateCode))
    .filter(Boolean);
}

export function parseDetailPage(html, detailUrl) {
  const $ = load(html, { decodeEntities: false });
  const detailTable = $("#anzeige");
  if (!detailTable.length) {
    throw new Error(`Detail table not found for ${detailUrl}`);
  }

  const meta = parseHrefParams(detailUrl);
  const rows = detailTable.find("tr").toArray();
  const details = {};
  const documents = [];

  const firstRowCells = $(rows[0]).find("td");
  const aktenzeichen = normalizeWhitespace(decodeHtml(firstRowCells.eq(0).html() ?? ""));
  const normalizedAktenzeichen = normalizeAktenzeichen(aktenzeichen);
  const lastUpdateText = normalizeWhitespace(
    decodeHtml(firstRowCells.eq(1).text()).replace(/[()]/g, "")
  );
  const courtContext = normalizeWhitespace(decodeHtml($("#micronavi ul").text()));

  for (const row of rows.slice(1)) {
    const cells = $(row).find("td");
    if (cells.length < 2) {
      continue;
    }

    const label = normalizeWhitespace(decodeHtml(cells.eq(0).text()).replace(/:$/, ""));
    const valueCell = cells.eq(1);
    const attachmentLink = $(row).find('a[href*="button=showAnhang"]').first();

    if (attachmentLink.length) {
      const href = attachmentLink.attr("href");
      const sizeText = normalizeWhitespace(decodeHtml($(row).text()))
        .replace(/^.*?:\s*/, "")
        .replace(normalizeWhitespace(decodeHtml(attachmentLink.text())), "")
        .trim();

      const doc = {
        label: label || "Anhang",
        name: normalizeWhitespace(decodeHtml(attachmentLink.text())),
        url: href ? new URL(href.trim(), BASE_URL).toString() : null,
        sizeText: sizeText || null
      };
      doc.category = classifyDocument(doc);
      documents.push(doc);
      continue;
    }

    if (!label) {
      continue;
    }

    details[label] = normalizeWhitespace(decodeHtml(valueCell.html() ?? valueCell.text()));
  }

  const locationText = details["Objekt/Lage"] ?? null;
  const locationParts = locationText
    ? locationText.split(":").map((part) => normalizeWhitespace(part))
    : [];
  const objectHeading = locationParts[0] ?? null;
  const address = parseAddress(locationParts.slice(1).join(":"));
  address.state = STATE_NAME_BY_CODE[meta.landCode] ?? null;
  const geoLink = detailTable.find('a[href*="maps.google"]').attr("href");

  return {
    zvgId: meta.zvgId,
    landCode: meta.landCode,
    detailUrl,
    aktenzeichen: normalizedAktenzeichen,
    lastUpdateText: lastUpdateText || null,
    courtContext: courtContext || null,
    procedureType: details["Art der Versteigerung"] ?? null,
    landRegister: details["Grundbuch"] ?? null,
    objectType: objectHeading ? normalizeWhitespace(objectHeading.split(",")[0]) : null,
    locationText,
    address,
    description: details["Beschreibung"] ?? null,
    valuationText: details["Verkehrswert in €"] ?? details["Verkehrswert in â¬"] ?? null,
    valuationAmountEur: extractFirstNumber(
      details["Verkehrswert in €"] ?? details["Verkehrswert in â¬"] ?? ""
    ),
    auctionDateText: details["Termin"] ?? null,
    auctionDateIso: parseGermanDate(details["Termin"] ?? ""),
    auctionLocation: details["Ort der Versteigerung"] ?? null,
    geoUrl: geoLink ? new URL(geoLink.trim(), BASE_URL).toString() : null,
    documents,
    detailFields: details
  };
}

export function mergeAuction(summary, detail) {
  const mergedDocuments = [...(summary.documents ?? []), ...(detail?.documents ?? [])];
  const dedupedDocuments = [];
  const seen = new Set();

  for (const document of mergedDocuments) {
        const key = document.url ?? `${document.name}|${document.label}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    dedupedDocuments.push(document);
  }

  return {
    zvgId: detail?.zvgId ?? summary.zvgId,
    landCode: detail?.landCode ?? summary.landCode,
    detailAvailable: summary.detailAvailable,
    detailUrl: detail?.detailUrl ?? summary.detailUrl,
    aktenzeichen: detail?.aktenzeichen ?? summary.aktenzeichen,
    lastUpdateText: detail?.lastUpdateText ?? summary.lastUpdateText,
    courtContext: detail?.courtContext ?? summary.courtText,
    procedureType: detail?.procedureType ?? null,
    landRegister: detail?.landRegister ?? null,
    objectType: detail?.objectType ?? summary.objectType,
    locationText: detail?.locationText ?? summary.locationText,
    address: detail?.address ?? summary.address,
    description: detail?.description ?? null,
    valuationText: detail?.valuationText ?? summary.valuationText,
    valuationAmountEur: detail?.valuationAmountEur ?? summary.valuationAmountEur,
    auctionDateText: detail?.auctionDateText ?? summary.auctionDateText,
    auctionDateIso: detail?.auctionDateIso ?? summary.auctionDateIso,
    auctionLocation: detail?.auctionLocation ?? null,
    geoUrl: detail?.geoUrl ?? null,
    documents: dedupedDocuments,
    summaryFields: summary.summaryFields,
    detailFields: detail?.detailFields ?? null
  };
}
