function toNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw)
    .replace(/\u00a0/g, " ")
    .replace(/\u20ac/g, "")
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function round(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function addMetric(metrics, key, entry) {
  if (!entry || typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
    return;
  }

  const next = {
    value: round(entry.value),
    source: entry.source ?? null,
    label: entry.label ?? null
  };

  const current = metrics[key];
  if (!current || next.value > current.value) {
    metrics[key] = next;
  }
}

function sumMatches(matches) {
  if (!matches.length) return null;
  const total = matches.reduce((sum, match) => sum + match.value, 0);
  const sources = matches.map((match) => match.source).filter(Boolean);
  return {
    value: round(total),
    source: sources.length ? sources.join(" + ") : null
  };
}

function normalizeExtractionText(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\u00e4/g, "ae")
    .replace(/\u00f6/g, "oe")
    .replace(/\u00fc/g, "ue")
    .replace(/\u00c4/g, "ae")
    .replace(/\u00d6/g, "oe")
    .replace(/\u00dc/g, "ue")
    .replace(/\u00df/g, "ss")
    .replace(/\u00b2/g, "2")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/m\s*2/g, " qm ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function collectTextParts(auction) {
  const parts = [];
  const seen = new Set();

  function pushPart(source, text) {
    if (typeof text !== "string" || !text.trim()) {
      return;
    }

    const normalizedText = text.trim().replace(/\s+/g, " ");
    const key = normalizeExtractionText(normalizedText);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    parts.push({ source, text: normalizedText, normalizedText: key });
  }

  pushPart("Beschreibung", auction.description);

  const detailFields = auction.detailFields ?? {};
  for (const [key, value] of Object.entries(detailFields)) {
    pushPart(`Detailfeld: ${key}`, value);
  }

  const summaryFields = auction.summaryFields ?? {};
  for (const [key, value] of Object.entries(summaryFields)) {
    pushPart(`Summary: ${key}`, value);
  }

  pushPart("Objektart", auction.objectType);

  return parts;
}

function extractAreasFromText(parts) {
  const metrics = {};
  const livingAreaParts = [];

  for (const part of parts) {
    const text = part.normalizedText ?? normalizeExtractionText(part.text ?? "");
    const matches = text.matchAll(/(\d{1,5}(?:[.,]\d{1,2})?)\s*qm/gi);

    for (const match of matches) {
      const value = toNumber(match[1]);
      if (!value) continue;

      const index = match.index ?? 0;
      const before = text.slice(Math.max(0, index - 48), index);
      const after = text.slice(index + match[0].length, index + match[0].length + 48);
      const context = `${before} ${after}`;

      let key = null;
      let label = null;

      if (/grundstueck/.test(context)) {
        key = "plotAreaSqm";
        label = "Grundstueck";
      } else if (/gewerbe/.test(context)) {
        key = "commercialAreaSqm";
        label = "Gewerbeflaeche";
      } else if (/nutzflaeche|nutz/.test(context)) {
        key = "usableAreaSqm";
        label = "Nutzflaeche";
      } else if (/gesamtflaeche|gesamtwohn|gesamtnutz|gesamt/.test(context)) {
        key = "totalAreaSqm";
        label = "Gesamtflaeche";
      } else if (/wohnfl|wfl\.?|\bwf\b|wohnung|appartement|wohnraum|schlafraum|balkon|groesse|grose/.test(context)) {
        key = "livingAreaSqm";
        label = "Wohnflaeche";
      }

      if (!key && /\bwf\b|wohnfl|wfl\.?/.test(text)) {
        key = "livingAreaSqm";
        label = "Wohnflaeche";
      }

      if (
        !key &&
        /beschreibung|detailfeld/.test((part.source ?? "").toLowerCase()) &&
        /wohnung|appartement|penthouse|eigentumswohnung/.test(text)
      ) {
        key = "livingAreaSqm";
        label = "Wohnflaeche";
      }

      if (!key) continue;

      const entry = { value, source: part.source, label };
      addMetric(metrics, key, entry);
      if (key === "livingAreaSqm") {
        livingAreaParts.push(entry);
      }
    }
  }

  const livingFromUnits = sumMatches(
    livingAreaParts.filter((entry) => {
      const source = (entry.source ?? "").toLowerCase();
      return source.includes("beschreibung") || source.includes("detailfeld");
    })
  );

  if (livingFromUnits && (!metrics.livingAreaSqm || livingFromUnits.value > metrics.livingAreaSqm.value)) {
    metrics.livingAreaSqm = {
      value: livingFromUnits.value,
      source: livingFromUnits.source,
      label: "Wohnflaeche"
    };
  }

  const derivedTotal = round(
    (metrics.livingAreaSqm?.value ?? 0) +
      (metrics.commercialAreaSqm?.value ?? 0) +
      (metrics.usableAreaSqm?.value ?? 0)
  );

  if (derivedTotal && (!metrics.totalAreaSqm || derivedTotal > metrics.totalAreaSqm.value)) {
    metrics.totalAreaSqm = {
      value: derivedTotal,
      source: [
        metrics.livingAreaSqm ? "Wohnflaeche" : null,
        metrics.commercialAreaSqm ? "Gewerbeflaeche" : null,
        metrics.usableAreaSqm ? "Nutzflaeche" : null
      ]
        .filter(Boolean)
        .join(" + "),
      label: "Gesamtflaeche"
    };
  }

  return metrics;
}

function extractRentMetrics(parts) {
  const metrics = {};
  const monthlyRentMatches = [];

  const monthlyRentRegexes = [
    /(?:miete|kaltmiete|nettokaltmiete|ist-miete|jahresnettokaltmiete(?:\s*\/\s*12)?)(?:\s*(?:ca\.?|rd\.?|rund|gesamt|insgesamt))?\s*[:=]?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*\u20ac/gi,
    /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*\u20ac\s*(?:miete|kaltmiete|nettokaltmiete)/gi
  ];

  const annualRentRegexes = [
    /(?:jahresmiete|jahresnettokaltmiete|jahresrohertrag)(?:\s*(?:ca\.?|rd\.?|rund|gesamt|insgesamt))?\s*[:=]?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*\u20ac/gi,
    /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*\u20ac\s*(?:jahresmiete|jahresnettokaltmiete|jahresrohertrag)/gi
  ];

  const rentPerSqmRegexes = [
    /(?:miete|kaltmiete|nettokaltmiete)(?:\s*\/\s*qm|\s+je\s+qm|\s+pro\s+qm)?\s*[:=]?\s*(\d{1,3}(?:,\d{1,2})?)\s*\u20ac\s*\/\s*m(?:\u00b2|2)?/gi,
    /(\d{1,3}(?:,\d{1,2})?)\s*\u20ac\s*\/\s*m(?:\u00b2|2)?(?:\s*(?:miete|kaltmiete|nettokaltmiete))?/gi
  ];

  for (const part of parts) {
    for (const regex of monthlyRentRegexes) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(part.text)) !== null) {
        const value = toNumber(match[1]);
        if (!value) continue;
        monthlyRentMatches.push({ value, source: part.source });
      }
    }

    for (const regex of annualRentRegexes) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(part.text)) !== null) {
        const value = toNumber(match[1]);
        if (!value) continue;
        monthlyRentMatches.push({ value: value / 12, source: `${part.source} (aus Jahresmiete)` });
      }
    }

    for (const regex of rentPerSqmRegexes) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(part.text)) !== null) {
        const value = toNumber(match[1]);
        if (!value) continue;
        addMetric(metrics, "rentPerSqm", { value, source: part.source, label: "Miete/qm" });
      }
    }
  }

  const summedMonthlyRent = sumMatches(monthlyRentMatches);
  if (summedMonthlyRent) {
    metrics.monthlyRentEur = {
      value: summedMonthlyRent.value,
      source: summedMonthlyRent.source,
      label: "Monatsmiete"
    };
  }

  return metrics;
}

function metricValue(metrics, key) {
  return metrics[key]?.value ?? null;
}

export function analyzeAuctionKpis(auction) {
  const textParts = collectTextParts(auction);
  const areaMetrics = extractAreasFromText(textParts);
  const rentMetrics = extractRentMetrics(textParts);
  const valuationAmountEur = auction.valuationAmountEur ?? null;

  const livingAreaSqm = metricValue(areaMetrics, "livingAreaSqm");
  const commercialAreaSqm = metricValue(areaMetrics, "commercialAreaSqm");
  const usableAreaSqm = metricValue(areaMetrics, "usableAreaSqm");
  const totalAreaSqm = metricValue(areaMetrics, "totalAreaSqm");
  const plotAreaSqm = metricValue(areaMetrics, "plotAreaSqm");
  const monthlyRentEur = metricValue(rentMetrics, "monthlyRentEur");

  const calculated = {
    pricePerLivingSqm: valuationAmountEur && livingAreaSqm ? round(valuationAmountEur / livingAreaSqm) : null,
    pricePerTotalSqm: valuationAmountEur && totalAreaSqm ? round(valuationAmountEur / totalAreaSqm) : null,
    rentPerLivingSqm:
      metricValue(rentMetrics, "rentPerSqm") ??
      (monthlyRentEur && livingAreaSqm ? round(monthlyRentEur / livingAreaSqm) : null),
    grossAnnualRentEur: monthlyRentEur ? round(monthlyRentEur * 12) : null,
    grossYieldPct:
      monthlyRentEur && valuationAmountEur
        ? round(((monthlyRentEur * 12) / valuationAmountEur) * 100)
        : null
  };

  const extracted = {
    livingAreaSqm,
    commercialAreaSqm,
    usableAreaSqm,
    totalAreaSqm,
    plotAreaSqm,
    monthlyRentEur
  };

  const sources = {};
  for (const [key, value] of Object.entries({ ...areaMetrics, ...rentMetrics })) {
    if (value?.source) {
      sources[key] = value.source;
    }
  }

  const notes = [];
  if (!livingAreaSqm && !totalAreaSqm) {
    notes.push("Keine eindeutige Flaechenangabe in Beschreibung/Detailfeldern erkannt.");
  }
  if (!monthlyRentEur && !metricValue(rentMetrics, "rentPerSqm")) {
    notes.push("Keine Mietangabe erkannt.");
  }

  return {
    screening: {
      extracted,
      sources,
      textSources: textParts.map((part) => part.source),
      notes
    },
    finance: {
      valuationAmountEur,
      monthlyRentEur,
      ...calculated
    },
    dueDiligence: {
      documentCount: auction.documents?.length ?? 0,
      hasDocuments: Boolean(auction.documents?.length),
      documentNames: (auction.documents ?? []).map((doc) => doc.name ?? doc.label).filter(Boolean)
    },
    summary: {
      hasAreaData: Boolean(livingAreaSqm || totalAreaSqm || commercialAreaSqm || usableAreaSqm),
      hasRentData: Boolean(monthlyRentEur || calculated.rentPerLivingSqm),
      notes
    }
  };
}
