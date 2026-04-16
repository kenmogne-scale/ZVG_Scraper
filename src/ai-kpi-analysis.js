import { analyzeAuctionKpis } from "./deal-analysis-clean.js";

const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const KPI_KEYS = [
  "livingAreaSqm",
  "commercialAreaSqm",
  "usableAreaSqm",
  "totalAreaSqm",
  "plotAreaSqm",
  "monthlyRentEur"
];

function round(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(normalized) ? round(normalized) : null;
}

function hasGeminiConfig() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function missingKpiKeys(extracted = {}) {
  return KPI_KEYS.filter((key) => extracted[key] == null);
}

function buildAuctionContext(auction) {
  const detailFields = Object.entries(auction.detailFields ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const summaryFields = Object.entries(auction.summaryFields ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const documents = (auction.documents ?? [])
    .map((doc) => [doc.name, doc.label, doc.category].filter(Boolean).join(" | "))
    .filter(Boolean)
    .join("\n");

  return [
    `Objektart: ${auction.objectType ?? "-"}`,
    `Adresse: ${auction.address?.full ?? auction.locationText ?? "-"}`,
    `Beschreibung:\n${auction.description ?? "-"}`,
    `Summary-Felder:\n${summaryFields || "-"}`,
    `Detail-Felder:\n${detailFields || "-"}`,
    `Dokumente:\n${documents || "-"}`
  ].join("\n\n");
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini response did not contain JSON");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function sanitizeAiPayload(payload = {}) {
  const extracted = {};
  for (const key of KPI_KEYS) {
    extracted[key] = toNullableNumber(payload[key]);
  }

  if (extracted.monthlyRentEur == null) {
    const annualRentEur = toNullableNumber(payload.annualRentEur);
    if (annualRentEur != null) {
      extracted.monthlyRentEur = round(annualRentEur / 12);
    }
  }

  const sources = {};
  const rawSources = payload.sources ?? {};
  for (const key of KPI_KEYS) {
    const value = rawSources[key];
    if (value && extracted[key] != null) {
      sources[key] = `KI: ${String(value).trim()}`;
    }
  }

  const confidence = {};
  const rawConfidence = payload.confidence ?? {};
  for (const key of KPI_KEYS) {
    const value = toNullableNumber(rawConfidence[key]);
    if (value != null && extracted[key] != null) {
      confidence[key] = Math.max(0, Math.min(1, value));
    }
  }

  return {
    extracted,
    sources,
    confidence
  };
}

async function requestGeminiKpis(auction, missingKeys) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const prompt = [
    "Du extrahierst nur rohe Immobilien-KPIs aus deutschem ZVG-Text.",
    "Liefere ausschliesslich JSON.",
    "Erfinde keine Werte. Wenn etwas nicht klar genannt ist, gib null zurueck.",
    "Gesucht sind nur diese Felder:",
    missingKeys.join(", "),
    "Optional darfst du annualRentEur zur Umrechnung angeben.",
    '{"livingAreaSqm":null,"commercialAreaSqm":null,"usableAreaSqm":null,"totalAreaSqm":null,"plotAreaSqm":null,"monthlyRentEur":null,"annualRentEur":null,"sources":{},"confidence":{}}',
    "",
    "Kontext:",
    buildAuctionContext(auction)
  ].join("\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(DEFAULT_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json"
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ]
      })
    }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${message}`);
  }

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Gemini response was empty");
  }

  return sanitizeAiPayload(extractJson(text));
}

function mergeExtracted(parserExtracted = {}, aiExtracted = {}) {
  const merged = { ...parserExtracted };
  for (const key of KPI_KEYS) {
    if (merged[key] == null && aiExtracted[key] != null) {
      merged[key] = aiExtracted[key];
    }
  }
  return merged;
}

function mergeSources(parserSources = {}, aiSources = {}, mergedExtracted = {}) {
  const merged = { ...parserSources };
  for (const key of KPI_KEYS) {
    if (!merged[key] && mergedExtracted[key] != null && aiSources[key]) {
      merged[key] = aiSources[key];
    }
  }
  return merged;
}

function buildFinance(valuationAmountEur, extracted, parserFinance = {}) {
  const livingAreaSqm = extracted.livingAreaSqm;
  const totalAreaSqm = extracted.totalAreaSqm;
  const monthlyRentEur = extracted.monthlyRentEur;

  return {
    ...parserFinance,
    valuationAmountEur,
    monthlyRentEur,
    pricePerLivingSqm:
      valuationAmountEur && livingAreaSqm ? round(valuationAmountEur / livingAreaSqm) : null,
    pricePerTotalSqm:
      valuationAmountEur && totalAreaSqm ? round(valuationAmountEur / totalAreaSqm) : null,
    rentPerLivingSqm:
      monthlyRentEur && livingAreaSqm ? round(monthlyRentEur / livingAreaSqm) : null,
    grossAnnualRentEur: monthlyRentEur ? round(monthlyRentEur * 12) : null,
    grossYieldPct:
      monthlyRentEur && valuationAmountEur
        ? round(((monthlyRentEur * 12) / valuationAmountEur) * 100)
        : null
  };
}

export async function analyzeAuctionWithKpiFallback(auction) {
  const parserAnalysis = analyzeAuctionKpis(auction);
  const parserExtracted = parserAnalysis.screening?.extracted ?? {};
  const missingKeys = missingKpiKeys(parserExtracted);

  if (!missingKeys.length || !hasGeminiConfig()) {
    return parserAnalysis;
  }

  try {
    const ai = await requestGeminiKpis(auction, missingKeys);
    const mergedExtracted = mergeExtracted(parserExtracted, ai.extracted);
    const mergedSources = mergeSources(
      parserAnalysis.screening?.sources ?? {},
      ai.sources,
      mergedExtracted
    );
    const aiFilledKeys = KPI_KEYS.filter(
      (key) => parserExtracted[key] == null && mergedExtracted[key] != null
    );
    const notes = [...(parserAnalysis.screening?.notes ?? [])];

    if (aiFilledKeys.length) {
      notes.push(`KI hat fehlende KPIs ergaenzt: ${aiFilledKeys.join(", ")}`);
    }

    return {
      ...parserAnalysis,
      screening: {
        ...(parserAnalysis.screening ?? {}),
        extracted: mergedExtracted,
        sources: mergedSources,
        confidence: {
          ...(parserAnalysis.screening?.confidence ?? {}),
          ...ai.confidence
        },
        ai: {
          provider: "gemini",
          model: DEFAULT_GEMINI_MODEL,
          filledKeys: aiFilledKeys,
          attemptedAt: new Date().toISOString()
        },
        notes
      },
      finance: buildFinance(
        auction.valuationAmountEur ?? null,
        mergedExtracted,
        parserAnalysis.finance ?? {}
      ),
      summary: {
        ...(parserAnalysis.summary ?? {}),
        hasAreaData: Boolean(
          mergedExtracted.livingAreaSqm ||
            mergedExtracted.totalAreaSqm ||
            mergedExtracted.commercialAreaSqm ||
            mergedExtracted.usableAreaSqm
        ),
        hasRentData: Boolean(mergedExtracted.monthlyRentEur)
      }
    };
  } catch (error) {
    const notes = [...(parserAnalysis.screening?.notes ?? [])];
    notes.push(`KI-KPI-Extraktion fehlgeschlagen: ${error.message}`);

    return {
      ...parserAnalysis,
      screening: {
        ...(parserAnalysis.screening ?? {}),
        ai: {
          provider: "gemini",
          model: DEFAULT_GEMINI_MODEL,
          attemptedAt: new Date().toISOString(),
          error: error.message
        },
        notes
      }
    };
  }
}
