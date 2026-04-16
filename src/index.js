import "dotenv/config";
import { parseArgs, runScrape } from "./scrape.js";

async function main() {
  const result = await runScrape(parseArgs(process.argv.slice(2)));

  console.log("");
  console.log(`Completed. Exported ${result.summary.exportedRecords} records.`);
  console.log(`JSON: ${result.output.jsonPath}`);
  console.log(`CSV:  ${result.output.csvPath}`);
  console.log(`Summary: ${result.output.summaryPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
