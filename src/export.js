import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { csvEscape, slugTimestamp } from "./utils.js";

const CSV_COLUMNS = [
  "zvg_id",
  "land_code",
  "aktenzeichen",
  "object_type",
  "street",
  "postal_code",
  "city",
  "district",
  "location_text",
  "description",
  "procedure_type",
  "land_register",
  "valuation_amount_eur",
  "valuation_text",
  "auction_date_iso",
  "auction_date_text",
  "auction_location",
  "last_update_text",
  "court_context",
  "detail_url",
  "geo_url",
  "detail_available",
  "documents_json",
  "summary_fields_json",
  "detail_fields_json"
];

function toCsvRow(record) {
  const row = {
    zvg_id: record.zvgId,
    land_code: record.landCode,
    aktenzeichen: record.aktenzeichen,
    object_type: record.objectType,
    street: record.address?.street ?? null,
    postal_code: record.address?.postalCode ?? null,
    city: record.address?.city ?? null,
    district: record.address?.district ?? null,
    location_text: record.locationText,
    description: record.description,
    procedure_type: record.procedureType,
    land_register: record.landRegister,
    valuation_amount_eur: record.valuationAmountEur,
    valuation_text: record.valuationText,
    auction_date_iso: record.auctionDateIso,
    auction_date_text: record.auctionDateText,
    auction_location: record.auctionLocation,
    last_update_text: record.lastUpdateText,
    court_context: record.courtContext,
    detail_url: record.detailUrl,
    geo_url: record.geoUrl,
    detail_available: record.detailAvailable,
    documents_json: record.documents,
    summary_fields_json: record.summaryFields,
    detail_fields_json: record.detailFields
  };

  return CSV_COLUMNS.map((column) => csvEscape(row[column])).join(",");
}

export async function writeOutputs(records, summary) {
  const runId = slugTimestamp();
  const outputDir = path.join(process.cwd(), "data", runId);
  await mkdir(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, "auctions.json");
  const csvPath = path.join(outputDir, "auctions.csv");
  const summaryPath = path.join(outputDir, "summary.json");
  const latestJsonPath = path.join(process.cwd(), "data", "latest.json");
  const latestCsvPath = path.join(process.cwd(), "data", "latest.csv");
  const latestSummaryPath = path.join(process.cwd(), "data", "latest-summary.json");

  const csv = [CSV_COLUMNS.join(","), ...records.map(toCsvRow)].join("\n");

  await Promise.all([
    writeFile(jsonPath, JSON.stringify(records, null, 2), "utf8"),
    writeFile(csvPath, `${csv}\n`, "utf8"),
    writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8"),
    writeFile(latestJsonPath, JSON.stringify(records, null, 2), "utf8"),
    writeFile(latestCsvPath, `${csv}\n`, "utf8"),
    writeFile(latestSummaryPath, JSON.stringify(summary, null, 2), "utf8")
  ]);

  return {
    runId,
    outputDir,
    jsonPath,
    csvPath,
    summaryPath
  };
}
