import { searchState, fetchDetail } from "./client.js";
import { writeOutputs } from "./export.js";
import { STATES } from "./constants.js";
import { ensureDatabase, failScrapeRun, saveAuctions, startScrapeRun, completeScrapeRun, autoPipelineLargeCities } from "./db.js";
import { mergeAuction, parseDetailPage, parseSearchResults } from "./parsers.js";
import { sleep } from "./utils.js";

export function parseArgs(argv) {
  const options = {
    states: STATES.map((state) => state.code),
    limit: null,
    delayMs: 350
  };

  for (const arg of argv) {
    if (arg.startsWith("--states=")) {
      options.states = arg
        .slice("--states=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number.parseInt(arg.slice("--limit=".length), 10);
    } else if (arg.startsWith("--delay-ms=")) {
      options.delayMs = Number.parseInt(arg.slice("--delay-ms=".length), 10);
    }
  }

  return options;
}

export async function runScrape(rawOptions = {}) {
  const requestedStates =
    Array.isArray(rawOptions.states) && rawOptions.states.length > 0
      ? rawOptions.states
      : STATES.map((state) => state.code);
  const options = {
    states: requestedStates,
    limit: rawOptions.limit ?? null,
    delayMs: rawOptions.delayMs ?? 350
  };
  const selectedStates = STATES.filter((state) => options.states.includes(state.code));

  if (selectedStates.length === 0) {
    throw new Error("No valid states selected. Use --states=ni,nw,...");
  }

  await ensureDatabase();
  const run = await startScrapeRun({
    selectedStates: selectedStates.map((state) => state.code),
    options
  });

  try {
    const allSummaries = [];

    for (const state of selectedStates) {
      console.log(`Searching ${state.name} (${state.code})...`);
      const html = await searchState(state.code);
      const records = parseSearchResults(html, state.code);
      console.log(`  Found ${records.length} summary records.`);
      allSummaries.push(...records);
      await sleep(options.delayMs);
    }

    const dedupedSummaries = Array.from(
      new Map(
        allSummaries.map((record) => {
          const key = record.zvgId
            ? `zvg:${record.zvgId}`
            : `fallback:${record.landCode}:${record.aktenzeichen}`;
          return [key, record];
        })
      ).values()
    );

    const targetSummaries =
      options.limit === null ? dedupedSummaries : dedupedSummaries.slice(0, options.limit);

    const results = [];
    let detailSuccess = 0;
    let detailFailures = 0;

    for (const summary of targetSummaries) {
      if (!summary.detailUrl) {
        results.push(mergeAuction(summary, null));
        continue;
      }

      try {
        console.log(`Fetching detail ${summary.aktenzeichen}...`);
        const detailHtml = await fetchDetail(summary.detailUrl);
        const detail = parseDetailPage(detailHtml, summary.detailUrl);
        results.push(mergeAuction(summary, detail));
        detailSuccess += 1;
      } catch (error) {
        detailFailures += 1;
        console.warn(`  Detail failed for ${summary.aktenzeichen}: ${error.message}`);
        results.push(mergeAuction(summary, null));
      }

      await sleep(options.delayMs);
    }

    const objectTypeCounts = {};
    for (const r of results) {
      const t = r.objectType ?? "Unbekannt";
      objectTypeCounts[t] = (objectTypeCounts[t] || 0) + 1;
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      runId: run.runId,
      selectedStates: selectedStates.map((state) => state.code),
      summaryRecords: allSummaries.length,
      dedupedRecords: dedupedSummaries.length,
      exportedRecords: results.length,
      detailSuccess,
      detailFailures,
      objectTypeCounts
    };

    const output = await writeOutputs(results, summary);
    await saveAuctions({ runId: run.runId, records: results, scrapedAt: summary.generatedAt });
    const autoPipeline = await autoPipelineLargeCities({ runId: run.runId });
    summary.autoPipeline = { added: autoPipeline.added, items: autoPipeline.items };
    await completeScrapeRun({ runId: run.runId, summary });

    return {
      runId: run.runId,
      output,
      summary,
      results
    };
  } catch (error) {
    await failScrapeRun({ runId: run.runId, error });
    throw error;
  }
}
