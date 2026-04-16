import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { buildAuctionKey, repairMojibake, slugTimestamp } from "./utils.js";
import { analyzeAuctionWithKpiFallback } from "./ai-kpi-analysis.js";

let supabase;

function getClient() {
  if (supabase) {
    return supabase;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Set them in .env or environment."
    );
  }

  supabase = createClient(url, key);
  return supabase;
}

function json(value) {
  return value ?? null;
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function getTodayStartIso() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
}

function paginateItems(items, { page = 1, pageSize = 10 } = {}) {
  const normalizedPage = Math.max(1, Number.parseInt(String(page), 10) || 1);
  const normalizedPageSize = Math.max(1, Math.min(100, Number.parseInt(String(pageSize), 10) || 10));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
  const safePage = Math.min(normalizedPage, totalPages);
  const start = (safePage - 1) * normalizedPageSize;
  const pagedItems = items.slice(start, start + normalizedPageSize);

  return {
    items: pagedItems,
    pagination: {
      page: safePage,
      pageSize: normalizedPageSize,
      totalItems,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1
    }
  };
}

async function nextRunId() {
  const base = slugTimestamp();
  const client = getClient();

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const runId = attempt === 0 ? base : `${base}-${String(attempt).padStart(3, "0")}`;
    const { data } = await client
      .from("scrape_runs")
      .select("run_id")
      .eq("run_id", runId)
      .limit(1);

    if (!data || data.length === 0) {
      return runId;
    }
  }

  throw new Error("Unable to allocate unique run_id");
}

function sanitizeValue(value) {
  if (typeof value === "string") {
    return repairMojibake(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeValue(entry)])
    );
  }

  return value;
}

export async function ensureDatabase() {
  getClient();
  return { dbPath: process.env.SUPABASE_URL };
}

export function getDatabaseInfo() {
  return { dbPath: process.env.SUPABASE_URL };
}

export async function startScrapeRun({ selectedStates, options }) {
  const client = getClient();
  const runId = await nextRunId();
  const startedAt = new Date().toISOString();

  const { error } = await client.from("scrape_runs").insert({
    run_id: runId,
    started_at: startedAt,
    status: "running",
    selected_states_json: selectedStates,
    options_json: options
  });

  if (error) {
    throw new Error(`startScrapeRun failed: ${error.message}`);
  }

  return { runId, startedAt };
}

export async function completeScrapeRun({ runId, summary }) {
  const client = getClient();
  const { error } = await client
    .from("scrape_runs")
    .update({
      completed_at: new Date().toISOString(),
      status: "completed",
      summary_json: summary,
      error_message: null
    })
    .eq("run_id", runId);

  if (error) {
    throw new Error(`completeScrapeRun failed: ${error.message}`);
  }
}

export async function failScrapeRun({ runId, error: runError }) {
  const client = getClient();
  const { error } = await client
    .from("scrape_runs")
    .update({
      completed_at: new Date().toISOString(),
      status: "failed",
      error_message: runError.message
    })
    .eq("run_id", runId);

  if (error) {
    throw new Error(`failScrapeRun failed: ${error.message}`);
  }
}

export async function saveAuctions({ runId, records, scrapedAt = new Date().toISOString() }) {
  const client = getClient();

  for (const record of records) {
    const cleanRecord = sanitizeValue(record);
    const auctionKey = buildAuctionKey(cleanRecord);
    const payload = { ...cleanRecord, auctionKey };
    const sourceHash = stableHash(payload);

    const { data: existing } = await client
      .from("auctions")
      .select("source_hash, first_seen_run_id, first_seen_at")
      .eq("auction_key", auctionKey)
      .limit(1)
      .single();

    const changed = existing ? existing.source_hash !== sourceHash : true;

    const { error: auctionError } = await client.from("auctions").upsert(
      {
        auction_key: auctionKey,
        zvg_id: cleanRecord.zvgId ?? null,
        land_code: cleanRecord.landCode ?? null,
        aktenzeichen: cleanRecord.aktenzeichen ?? null,
        detail_available: cleanRecord.detailAvailable ? true : false,
        detail_url: cleanRecord.detailUrl ?? null,
        last_update_text: cleanRecord.lastUpdateText ?? null,
        court_context: cleanRecord.courtContext ?? null,
        procedure_type: cleanRecord.procedureType ?? null,
        land_register: cleanRecord.landRegister ?? null,
        object_type: cleanRecord.objectType ?? null,
        location_text: cleanRecord.locationText ?? null,
        address_full: cleanRecord.address?.full ?? null,
        street: cleanRecord.address?.street ?? null,
        postal_code: cleanRecord.address?.postalCode ?? null,
        city: cleanRecord.address?.city ?? null,
        district: cleanRecord.address?.district ?? null,
        state: cleanRecord.address?.state ?? null,
        description: cleanRecord.description ?? null,
        valuation_text: cleanRecord.valuationText ?? null,
        valuation_amount_eur: cleanRecord.valuationAmountEur ?? null,
        auction_date_text: cleanRecord.auctionDateText ?? null,
        auction_date_iso: cleanRecord.auctionDateIso ?? null,
        auction_location: cleanRecord.auctionLocation ?? null,
        geo_url: cleanRecord.geoUrl ?? null,
        summary_fields_json: json(cleanRecord.summaryFields),
        detail_fields_json: json(cleanRecord.detailFields),
        documents_json: json(cleanRecord.documents ?? []),
        first_seen_run_id: existing?.first_seen_run_id ?? runId,
        last_seen_run_id: runId,
        first_seen_at: existing?.first_seen_at ?? scrapedAt,
        last_seen_at: scrapedAt,
        last_scraped_at: scrapedAt,
        source_hash: sourceHash
      },
      { onConflict: "auction_key" }
    );

    if (auctionError) {
      throw new Error(`saveAuctions upsert failed: ${auctionError.message}`);
    }

    const { error: historyError } = await client.from("auction_history").insert({
      run_id: runId,
      auction_key: auctionKey,
      payload_json: payload,
      source_hash: sourceHash,
      changed,
      created_at: scrapedAt
    });

    if (historyError) {
      throw new Error(`saveAuctions history failed: ${historyError.message}`);
    }

    for (const document of cleanRecord.documents ?? []) {
      const documentKey = stableHash({
        auctionKey,
        name: document.name ?? null,
        label: document.label ?? null,
        url: document.url ?? null
      });

      const { data: existingDoc } = await client
        .from("auction_documents")
        .select("first_seen_run_id, first_seen_at")
        .eq("document_key", documentKey)
        .limit(1)
        .single();

      const { error: docError } = await client.from("auction_documents").upsert(
        {
          document_key: documentKey,
          auction_key: auctionKey,
          name: document.name ?? null,
          label: document.label ?? null,
          category: document.category ?? null,
          url: document.url ?? null,
          size_text: document.sizeText ?? null,
          first_seen_run_id: existingDoc?.first_seen_run_id ?? runId,
          last_seen_run_id: runId,
          first_seen_at: existingDoc?.first_seen_at ?? scrapedAt,
          last_seen_at: scrapedAt
        },
        { onConflict: "document_key" }
      );

      if (docError) {
        throw new Error(`saveAuctions document upsert failed: ${docError.message}`);
      }
    }
  }
}

export async function listAuctions({ page = 1, pageSize = 10, scope = "upcoming" } = {}) {
  const client = getClient();

  const query = client
    .from("auctions")
    .select(`
      *,
      pipeline_items (*),
      auction_analysis (*)
    `)
    .order("auction_date_iso", { ascending: true, nullsFirst: false })
    .order("aktenzeichen", { ascending: true });

  if (scope === "upcoming") {
    query.gte("auction_date_iso", getTodayStartIso());
  }

  const { data: auctions, error } = await query;

  if (error) {
    throw new Error(`listAuctions failed: ${error.message}`);
  }

  const documentsByAuction = await getDocumentsByAuction(client);
  const citiesLookup = await loadCitiesLookup(client);
  const hydrated = auctions.map((row) => hydrateAuctionRow(row, documentsByAuction, citiesLookup));

  return paginateItems(hydrated, { page, pageSize });
}

export async function getLatestRun() {
  const client = getClient();
  const { data: row, error } = await client
    .from("scrape_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code === "PGRST116") {
    return null;
  }

  if (error) {
    throw new Error(`getLatestRun failed: ${error.message}`);
  }

  if (!row) {
    return null;
  }

  return {
    runId: row.run_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    selectedStates: row.selected_states_json,
    options: row.options_json,
    summary: row.summary_json,
    errorMessage: row.error_message
  };
}

async function getDocumentsByAuction(client) {
  const { data: documents, error } = await client
    .from("auction_documents")
    .select("document_key, auction_key, name, label, category, url, size_text")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`getDocumentsByAuction failed: ${error.message}`);
  }

  const documentsByAuction = new Map();
  for (const document of documents) {
    const items = documentsByAuction.get(document.auction_key) ?? [];
    items.push({
      documentKey: document.document_key,
      name: document.name,
      label: document.label,
      category: document.category,
      url: document.url,
      sizeText: document.size_text
    });
    documentsByAuction.set(document.auction_key, items);
  }

  return documentsByAuction;
}

async function loadCitiesLookup(client) {
  const { data: cities, error } = await client
    .from("cities")
    .select("name, name_normalized, postal_code, population, density_per_km2, area_km2");

  if (error) {
    console.warn("Could not load cities:", error.message);
    return new Map();
  }

  const lookup = new Map();
  for (const city of cities) {
    lookup.set(city.name_normalized, city);
  }
  return lookup;
}

function matchCity(auctionCity, citiesLookup) {
  if (!auctionCity || citiesLookup.size === 0) return null;

  const normalized = auctionCity.trim().toLowerCase();

  if (citiesLookup.has(normalized)) return citiesLookup.get(normalized);

  for (const [key, city] of citiesLookup) {
    if (key === normalized || key.startsWith(normalized)) return city;
  }

  return null;
}

function hydrateAuctionRow(row, documentsByAuction, citiesLookup = new Map()) {
  const pipeline = Array.isArray(row.pipeline_items)
    ? (row.pipeline_items[0] ?? null)
    : (row.pipeline_items ?? null);
  const analysis = Array.isArray(row.auction_analysis)
    ? (row.auction_analysis[0] ?? null)
    : (row.auction_analysis ?? null);

  return {
    auctionKey: row.auction_key,
    zvgId: row.zvg_id,
    landCode: row.land_code,
    aktenzeichen: row.aktenzeichen,
    detailAvailable: Boolean(row.detail_available),
    detailUrl: row.detail_url,
    lastUpdateText: row.last_update_text,
    courtContext: row.court_context,
    procedureType: row.procedure_type,
    landRegister: row.land_register,
    objectType: row.object_type,
    locationText: row.location_text,
    address: {
      full: row.address_full,
      street: row.street,
      postalCode: row.postal_code,
      city: row.city,
      district: row.district,
      state: row.state
    },
    description: row.description,
    valuationText: row.valuation_text,
    valuationAmountEur: row.valuation_amount_eur,
    auctionDateText: row.auction_date_text,
    auctionDateIso: row.auction_date_iso,
    auctionLocation: row.auction_location,
    geoUrl: row.geo_url,
    documents: documentsByAuction.get(row.auction_key) ?? row.documents_json ?? [],
    summaryFields: row.summary_fields_json ?? null,
    detailFields: row.detail_fields_json ?? null,
    firstSeenRunId: row.first_seen_run_id,
    lastSeenRunId: row.last_seen_run_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastScrapedAt: row.last_scraped_at,
    pipeline: pipeline
      ? {
          stage: pipeline.stage,
          priority: pipeline.priority,
          source: pipeline.source,
          thesis: pipeline.thesis,
          nextStep: pipeline.next_step,
          targetBidEur: pipeline.target_bid_eur,
          createdAt: pipeline.created_at,
          updatedAt: pipeline.updated_at
        }
      : null,
    analysis: analysis
      ? {
          strategyFit: analysis.strategy_fit,
          locationScore: analysis.location_score,
          assetScore: analysis.asset_score,
          executionScore: analysis.execution_score,
          screening: analysis.screening_json ?? {},
          finance: analysis.finance_json ?? {},
          dueDiligence: analysis.due_diligence_json ?? {},
          notes: analysis.notes,
          decision: analysis.decision,
          updatedAt: analysis.updated_at
        }
      : null,
    cityData: (() => {
      const match = matchCity(row.city, citiesLookup);
      if (!match) return null;
      return {
        name: match.name,
        population: match.population,
        densityPerKm2: match.density_per_km2,
        areaKm2: match.area_km2
      };
    })()
  };
}

export async function listPipelineItems({ page = 1, pageSize = 10, scope = "upcoming" } = {}) {
  const client = getClient();

  const { data: pipelineKeys, error: pipelineError } = await client
    .from("pipeline_items")
    .select("auction_key");

  if (pipelineError) {
    throw new Error(`listPipelineItems failed: ${pipelineError.message}`);
  }

  if (!pipelineKeys || pipelineKeys.length === 0) {
    return paginateItems([], { page, pageSize });
  }

  const keys = pipelineKeys.map((row) => row.auction_key);
  const query = client
    .from("auctions")
    .select(`
      *,
      pipeline_items (*),
      auction_analysis (*)
    `)
    .in("auction_key", keys)
    .order("auction_date_iso", { ascending: true, nullsFirst: false })
    .order("aktenzeichen", { ascending: true });

  if (scope === "upcoming") {
    query.gte("auction_date_iso", getTodayStartIso());
  }

  const { data: auctions, error } = await query;

  if (error) {
    throw new Error(`listPipelineItems auctions failed: ${error.message}`);
  }

  const documentsByAuction = await getDocumentsByAuction(client);
  const citiesLookup = await loadCitiesLookup(client);

  const stageOrder = { in_pruefung: 0, shortlist: 1, gebot_geplant: 2, verworfen: 3, gekauft: 4 };
  const priorityOrder = { high: 0, medium: 1, low: 2 };

  const hydrated = auctions.map((row) => hydrateAuctionRow(row, documentsByAuction, citiesLookup));
  hydrated.sort((a, b) => {
    const sa = stageOrder[a.pipeline?.stage] ?? 5;
    const sb = stageOrder[b.pipeline?.stage] ?? 5;
    if (sa !== sb) return sa - sb;

    const pa = priorityOrder[a.pipeline?.priority] ?? 3;
    const pb = priorityOrder[b.pipeline?.priority] ?? 3;
    if (pa !== pb) return pa - pb;

    if (a.auctionDateIso !== b.auctionDateIso) {
      if (!a.auctionDateIso) return 1;
      if (!b.auctionDateIso) return -1;
      return a.auctionDateIso.localeCompare(b.auctionDateIso);
    }

    return (a.aktenzeichen ?? "").localeCompare(b.aktenzeichen ?? "");
  });

  return paginateItems(hydrated, { page, pageSize });
}

export async function getAuctionByKey(auctionKey) {
  const client = getClient();

  const { data: row, error } = await client
    .from("auctions")
    .select(`
      *,
      pipeline_items (*),
      auction_analysis (*)
    `)
    .eq("auction_key", auctionKey)
    .limit(1)
    .single();

  if (error && error.code === "PGRST116") {
    return null;
  }

  if (error) {
    throw new Error(`getAuctionByKey failed: ${error.message}`);
  }

  if (!row) {
    return null;
  }

  const documentsByAuction = await getDocumentsByAuction(client);
  const citiesLookup = await loadCitiesLookup(client);
  return hydrateAuctionRow(row, documentsByAuction, citiesLookup);
}

export async function upsertPipelineItem({
  auctionKey,
  stage = "shortlist",
  priority = "medium",
  source = "manual",
  thesis = null,
  nextStep = null,
  targetBidEur = null
}) {
  const client = getClient();

  const { data: exists } = await client
    .from("auctions")
    .select("auction_key")
    .eq("auction_key", auctionKey)
    .limit(1)
    .single();

  if (!exists) {
    throw new Error(`Unknown auction_key: ${auctionKey}`);
  }

  const now = new Date().toISOString();

  const { error } = await client.from("pipeline_items").upsert(
    {
      auction_key: auctionKey,
      stage,
      priority,
      source,
      thesis,
      next_step: nextStep,
      target_bid_eur: targetBidEur,
      created_at: now,
      updated_at: now
    },
    { onConflict: "auction_key" }
  );

  if (error) {
    throw new Error(`upsertPipelineItem failed: ${error.message}`);
  }

  return getAuctionByKey(auctionKey);
}

export async function updateAuctionAnalysis({
  auctionKey,
  strategyFit = null,
  locationScore = null,
  assetScore = null,
  executionScore = null,
  screening = {},
  finance = {},
  dueDiligence = {},
  notes = null,
  decision = "open"
}) {
  const client = getClient();

  const { data: exists } = await client
    .from("auctions")
    .select("auction_key")
    .eq("auction_key", auctionKey)
    .limit(1)
    .single();

  if (!exists) {
    throw new Error(`Unknown auction_key: ${auctionKey}`);
  }

  const now = new Date().toISOString();

  const { error } = await client.from("auction_analysis").upsert(
    {
      auction_key: auctionKey,
      strategy_fit: strategyFit,
      location_score: locationScore,
      asset_score: assetScore,
      execution_score: executionScore,
      screening_json: screening ?? {},
      finance_json: finance ?? {},
      due_diligence_json: dueDiligence ?? {},
      notes,
      decision,
      updated_at: now
    },
    { onConflict: "auction_key" }
  );

  if (error) {
    throw new Error(`updateAuctionAnalysis failed: ${error.message}`);
  }

  return getAuctionByKey(auctionKey);
}

export async function runAutomatedAnalysis(auctionKey) {
  const auction = await getAuctionByKey(auctionKey);

  if (!auction) {
    throw new Error(`Unknown auction_key: ${auctionKey}`);
  }

  const automated = await analyzeAuctionWithKpiFallback(auction);
  const existingAnalysis = auction.analysis ?? {};
  const autoNotes = automated.summary.notes.join(" ");
  const preservedNotes = typeof existingAnalysis.notes === "string" ? existingAnalysis.notes.trim() : "";
  const mergedNotes = [preservedNotes];

  if (autoNotes && !preservedNotes.includes(autoNotes)) {
    mergedNotes.push(autoNotes);
  }

  return updateAuctionAnalysis({
    auctionKey,
    strategyFit: existingAnalysis.strategyFit ?? null,
    locationScore: existingAnalysis.locationScore ?? null,
    assetScore: existingAnalysis.assetScore ?? null,
    executionScore: existingAnalysis.executionScore ?? null,
    screening: {
      ...(existingAnalysis.screening ?? {}),
      ...automated.screening,
      automatedAt: new Date().toISOString()
    },
    finance: {
      ...(existingAnalysis.finance ?? {}),
      ...automated.finance
    },
    dueDiligence: {
      ...(existingAnalysis.dueDiligence ?? {}),
      ...automated.dueDiligence
    },
    notes: mergedNotes.filter(Boolean).join("\n\n") || null,
    decision: existingAnalysis.decision ?? "open"
  });
}

const AUTO_PIPELINE_MIN_POPULATION = 150_000;

export async function autoPipelineLargeCities({ runId }) {
  const client = getClient();
  const citiesLookup = await loadCitiesLookup(client);

  const { data: auctions, error } = await client
    .from("auctions")
    .select("auction_key, city");

  if (error) {
    console.warn("autoPipelineLargeCities query failed:", error.message);
    return { added: 0, items: [] };
  }

  const { data: existingPipeline } = await client
    .from("pipeline_items")
    .select("auction_key");

  const pipelineKeys = new Set((existingPipeline ?? []).map((r) => r.auction_key));

  const now = new Date().toISOString();
  const added = [];

  for (const auction of auctions) {
    if (pipelineKeys.has(auction.auction_key)) continue;

    const city = matchCity(auction.city, citiesLookup);
    if (!city || !city.population || city.population < AUTO_PIPELINE_MIN_POPULATION) continue;

    const { error: insertError } = await client.from("pipeline_items").upsert(
      {
        auction_key: auction.auction_key,
        stage: "shortlist",
        priority: "high",
        source: "auto-city-filter",
        thesis: `Stadt ${city.name} mit ${city.population.toLocaleString("de-DE")} Einwohnern`,
        next_step: null,
        target_bid_eur: null,
        created_at: now,
        updated_at: now
      },
      { onConflict: "auction_key" }
    );

    if (!insertError) {
      try {
        await runAutomatedAnalysis(auction.auction_key);
      } catch (analysisError) {
        console.warn(`Auto analysis failed for ${auction.auction_key}: ${analysisError.message}`);
      }

      added.push({ auctionKey: auction.auction_key, city: city.name, population: city.population });
    }
  }

  if (added.length > 0) {
    console.log(`Auto-Pipeline: ${added.length} Objekte in Staedten >150.000 Einwohner hinzugefuegt:`);
    for (const item of added) {
      console.log(`  - ${item.auctionKey} (${item.city}, ${item.population.toLocaleString("de-DE")} EW)`);
    }
  }

  return { added: added.length, items: added };
}




