import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const BATCH_SIZE = 500;

function normalizeCity(name) {
  return name
    .replace(/,\s*(Stadt|Landeshauptstadt|Freie und Hansestadt|Hansestadt|Universitätsstadt|Bundesstadt).*$/i, "")
    .trim()
    .toLowerCase();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = String(value).replace(/\s+/g, "").replace(/\./g, "").replace(",", ".");
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

async function main() {
  const filePath = path.resolve(process.cwd(), "cities.xlsx");
  console.log(`Reading ${filePath}...`);

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  // Skip header rows (first 2 rows: title + column headers)
  const dataRows = rows.slice(2).filter((row) => row[0] && row[2]);

  console.log(`Found ${dataRows.length} cities in Excel.`);

  const cities = dataRows.map((row) => {
    const rawName = String(row[2]).trim();
    return {
      regional_key: String(row[1]).trim() || null,
      name: rawName,
      name_normalized: normalizeCity(rawName),
      postal_code: String(row[3]).trim() || null,
      area_km2: parseNumber(row[4]),
      population: parseNumber(row[5]),
      population_male: parseNumber(row[6]),
      population_female: parseNumber(row[7]),
      density_per_km2: parseNumber(row[8])
    };
  });

  console.log(`Parsed ${cities.length} cities. Uploading to Supabase...`);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Clear existing data
  const { error: deleteError } = await supabase.from("cities").delete().neq("id", 0);
  if (deleteError) {
    console.error("Delete failed:", deleteError.message);
  }

  // Insert in batches
  let inserted = 0;
  for (let i = 0; i < cities.length; i += BATCH_SIZE) {
    const batch = cities.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("cities").insert(batch);
    if (error) {
      console.error(`Batch ${i}-${i + batch.length} failed:`, error.message);
      continue;
    }
    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${cities.length}`);
  }

  // Verify
  const { count } = await supabase.from("cities").select("*", { count: "exact", head: true });
  console.log(`\nDone! ${count} cities in Supabase.`);

  // Show top 10
  const { data: top } = await supabase
    .from("cities")
    .select("name, postal_code, population, density_per_km2")
    .order("population", { ascending: false })
    .limit(10);

  console.log("\nTop 10 Staedte:");
  for (const c of top) {
    console.log(`  ${c.name} (PLZ ${c.postal_code}) - ${c.population?.toLocaleString("de-DE")} Einwohner, ${c.density_per_km2}/km²`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
