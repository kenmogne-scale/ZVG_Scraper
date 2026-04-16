const rowsEl = document.querySelector("#rows");
const searchEl = document.querySelector("#search");
const stageFilterEl = document.querySelector("#stage-filter");
const priorityFilterEl = document.querySelector("#priority-filter");
const resultCountEl = document.querySelector("#result-count");
const tableContextEl = document.querySelector("#table-context");
const metricTotalEl = document.querySelector("#metric-total");
const metricReviewEl = document.querySelector("#metric-review");
const metricBidEl = document.querySelector("#metric-bid");
const detailModalEl = document.querySelector("#detail-modal");
const detailBackdropEl = document.querySelector("#detail-backdrop");
const detailCloseEl = document.querySelector("#detail-close");
const detailContentEl = document.querySelector("#detail-content");
const paginationInfoEl = document.querySelector("#pagination-info");
const prevPageEl = document.querySelector("#prev-page");
const nextPageEl = document.querySelector("#next-page");

let pipeline = [];
let pagination = { page: 1, pageSize: 10, totalItems: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false };

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function eur(value) {
  if (typeof value !== "number") return "-";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

function decimal(value, digits = 2) {
  if (typeof value !== "number") return "-";
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(value);
}

function stageLabel(stage) {
  return { shortlist: "Shortlist", in_pruefung: "In Pruefung", gebot_geplant: "Gebot geplant", verworfen: "Verworfen", gekauft: "Gekauft" }[stage] ?? stage ?? "-";
}

function priorityLabel(p) {
  return { high: "Hoch", medium: "Mittel", low: "Niedrig" }[p] ?? p ?? "-";
}

function decisionLabel(decision) {
  return { open: "Offen", watch: "Beobachten", go: "Go", no_go: "No-Go" }[decision] ?? "Offen";
}

function areaValue(item) {
  const extracted = item.analysis?.screening?.extracted ?? {};
  return extracted.totalAreaSqm ?? extracted.livingAreaSqm ?? null;
}

function pricePerSqmValue(item) {
  const finance = item.analysis?.finance ?? {};
  return finance.pricePerTotalSqm ?? finance.pricePerLivingSqm ?? null;
}

function formatAuctionDate(item) {
  const iso = item.auctionDateIso;
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
    }
  }
  return item.auctionDateText ?? "-";
}

function renderDocuments(docs) {
  if (!docs?.length) return '<span class="small">Keine Dokumente vorhanden.</span>';
  return docs.map((doc) => {
    const href = doc.url ? `/api/documents?url=${encodeURIComponent(doc.url)}` : "#";
    const tagLabel = escapeHtml(doc.category ?? doc.label ?? doc.name ?? "Dokument");
    const fileName = escapeHtml(doc.name ?? doc.label ?? "Dokument");
    const sizeText = doc.sizeText ? `<span class="small">${escapeHtml(doc.sizeText)}</span>` : "";
    return `<div class="modal-doc-item"><a class="doc-tag" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${tagLabel}</a><a class="modal-doc-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${fileName}</a>${sizeText}</div>`;
  }).join("");
}

function renderKpiCards(item) {
  const screening = item.analysis?.screening ?? {};
  const finance = item.analysis?.finance ?? {};
  const extracted = screening.extracted ?? {};

  const cards = [
    { label: "Wohnflaeche", value: extracted.livingAreaSqm != null ? `${decimal(extracted.livingAreaSqm)} qm` : "-", emphasis: extracted.livingAreaSqm != null },
    { label: "Gewerbeflaeche", value: extracted.commercialAreaSqm != null ? `${decimal(extracted.commercialAreaSqm)} qm` : "-" },
    { label: "Nutzflaeche", value: extracted.usableAreaSqm != null ? `${decimal(extracted.usableAreaSqm)} qm` : "-" },
    { label: "Gesamtflaeche", value: extracted.totalAreaSqm != null ? `${decimal(extracted.totalAreaSqm)} qm` : "-" },
    { label: "Preis / Wohn-qm", value: finance.pricePerLivingSqm != null ? `${eur(finance.pricePerLivingSqm)}/qm` : "-", emphasis: finance.pricePerLivingSqm != null },
    { label: "Preis / Gesamt-qm", value: finance.pricePerTotalSqm != null ? `${eur(finance.pricePerTotalSqm)}/qm` : "-" },
    { label: "Monatsmiete", value: finance.monthlyRentEur != null ? eur(finance.monthlyRentEur) : "-" },
    { label: "Miete / qm", value: finance.rentPerLivingSqm != null ? `${eur(finance.rentPerLivingSqm)}/qm` : "-" }
  ];

  return `
    <div class="kpi-grid">
      ${cards.map((card) => `
        <div class="kpi-card ${card.emphasis ? "kpi-card--emphasis" : ""}">
          <span class="kpi-label">${escapeHtml(card.label)}</span>
          <strong class="kpi-value">${escapeHtml(card.value)}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAnalysisNotes(item) {
  const notes = item.analysis?.screening?.notes ?? [];
  if (!notes.length) {
    return '<p class="small">Noch keine automatische KPI-Analyse ausgefuehrt.</p>';
  }

  return `<div class="note-stack">${notes.map((note) => `<div class="note-chip">${escapeHtml(note)}</div>`).join("")}</div>`;
}

function renderSourceSummary(item) {
  const sources = item.analysis?.screening?.sources ?? {};
  const rows = [
    ["Wohnflaeche", sources.livingAreaSqm],
    ["Gesamtflaeche", sources.totalAreaSqm],
    ["Gewerbeflaeche", sources.commercialAreaSqm],
    ["Miete", sources.monthlyRentEur || sources.rentPerSqm]
  ].filter(([, value]) => value);

  if (!rows.length) {
    return '<p class="small">Noch keine Quellenhinweise verfuegbar.</p>';
  }

  return `<div class="source-list">${rows.map(([label, value]) => `<div class="source-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>`;
}

function renderMetrics() {
  metricTotalEl.textContent = new Intl.NumberFormat("de-DE").format(pagination.totalItems);
  metricReviewEl.textContent = new Intl.NumberFormat("de-DE").format(pipeline.filter((i) => i.pipeline?.stage === "in_pruefung").length);
  metricBidEl.textContent = new Intl.NumberFormat("de-DE").format(pipeline.filter((i) => i.pipeline?.stage === "gebot_geplant").length);
}

function renderResultCount(count) {
  resultCountEl.textContent = `${count} ${count === 1 ? "Deal" : "Deals"}`;
}

function applyFilters() {
  const query = searchEl.value.trim().toLowerCase();
  const stage = stageFilterEl.value;
  const priority = priorityFilterEl.value;

  const matching = pipeline.filter((item) => {
    if (stage && item.pipeline?.stage !== stage) return false;
    if (priority && item.pipeline?.priority !== priority) return false;
    if (!query) return true;

    const haystack = [item.aktenzeichen, item.objectType, item.address?.full, item.address?.city, item.address?.state, item.courtContext, item.pipeline?.thesis].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  });

  const contextParts = [`Ab heute | ${new Intl.NumberFormat("de-DE").format(pagination.totalItems)} relevante Deals gesamt`];
  if (query) contextParts.push(`Suche: "${searchEl.value.trim()}"`);
  if (stage) contextParts.push(`Status: ${stageLabel(stage)}`);
  if (priority) contextParts.push(`Prioritaet: ${priorityLabel(priority)}`);
  tableContextEl.textContent = contextParts.join(" | ");

  renderTable(matching);
}

function renderTable(items) {
  if (!items.length) {
    rowsEl.innerHTML = '<tr class="empty-row"><td colspan="8">Keine Pipeline-Objekte auf dieser Seite gefunden.</td></tr>';
    renderResultCount(0);
    return;
  }

  renderResultCount(items.length);
  rowsEl.innerHTML = items.map((item) => {
    const addr = item.address ?? {};
    const totalArea = areaValue(item);
    const pricePerSqm = pricePerSqmValue(item);
    return `
      <tr data-auction-key="${escapeHtml(item.auctionKey ?? "")}">
        <td>${addr.state ? `<span class="pill">${escapeHtml(addr.state)}</span>` : '<span class="small">-</span>'}</td>
        <td><span class="row-title">${escapeHtml(addr.street ?? item.locationText ?? "-")}</span></td>
        <td>
          ${escapeHtml(addr.city ?? "-")}
          ${item.cityData?.population ? `<div class="small">${new Intl.NumberFormat("de-DE").format(item.cityData.population)} EW</div>` : ""}
        </td>
        <td>${escapeHtml(item.objectType ?? "-")}</td>
        <td>${escapeHtml(eur(item.valuationAmountEur))}</td>
        <td>${totalArea != null ? escapeHtml(`${decimal(totalArea)} qm`) : '<span class="small">-</span>'}</td>
        <td>${pricePerSqm != null ? `<span class="row-title">${escapeHtml(`${eur(pricePerSqm)}/qm`)}</span>` : '<span class="small">-</span>'}</td>
        <td>${escapeHtml(formatAuctionDate(item))}</td>
      </tr>
    `;
  }).join("");
}

function renderPagination() {
  paginationInfoEl.textContent = `Seite ${pagination.page} von ${pagination.totalPages} | ${new Intl.NumberFormat("de-DE").format(pagination.totalItems)} kommende Deals`;
  prevPageEl.disabled = !pagination.hasPreviousPage;
  nextPageEl.disabled = !pagination.hasNextPage;
}

function renderDetailModal(item) {
  const addr = item.address ?? {};
  const location = [addr.street, [addr.postalCode, addr.city].filter(Boolean).join(" "), addr.district].filter(Boolean).join(", ");
  const ps = item.pipeline ?? {};
  const analysis = item.analysis ?? {};

  detailContentEl.innerHTML = `
    <div class="detail-shell">
      <section class="detail-main">
        <div class="detail-hero">
          <div class="detail-hero-copy">
            <div class="hero-meta-row">
              <span class="pill">${escapeHtml(addr.state ?? item.landCode?.toUpperCase() ?? "-")}</span>
              <span class="pill ${ps.stage ? `pill--${ps.stage}` : ""}">${escapeHtml(stageLabel(ps.stage))}</span>
              <span class="pill ${ps.priority === "high" ? "pill--high" : ""}">${escapeHtml(priorityLabel(ps.priority))}</span>
            </div>
            <h3 id="detail-title">${escapeHtml(item.objectType ?? "Objekt")}</h3>
            <p class="detail-address">${escapeHtml(location || item.locationText || "-")}</p>
            <div class="hero-facts">
              <div class="hero-fact"><span>Aktenzeichen</span><strong>${escapeHtml(item.aktenzeichen ?? "-")}</strong></div>
              <div class="hero-fact"><span>Termin</span><strong>${escapeHtml(item.auctionDateText ?? "-")}</strong></div>
              <div class="hero-fact"><span>Wert</span><strong>${escapeHtml(eur(item.valuationAmountEur))}</strong></div>
            </div>
          </div>
          <div class="detail-hero-actions">
            <button type="button" id="run-analysis-button" class="button-primary">Analyse aktualisieren</button>
            ${item.detailUrl ? `<a class="button-secondary" href="/api/detail?url=${encodeURIComponent(item.detailUrl)}" target="_blank" rel="noreferrer">Originalansicht</a>` : ""}
          </div>
        </div>

        <div class="detail-section detail-section--highlight">
          <div class="section-headline">
            <div>
              <span class="section-kicker">Investment Snapshot</span>
              <h4>Schnelle KPI-Sicht</h4>
            </div>
          </div>
          ${renderKpiCards(item)}
          ${renderAnalysisNotes(item)}
        </div>

        <div class="detail-grid-two">
          <div class="detail-section">
            <div class="section-headline">
              <div>
                <span class="section-kicker">Objekt</span>
                <h4>Beschreibung</h4>
              </div>
            </div>
            <p class="modal-description">${escapeHtml(item.description ?? "-")}</p>
          </div>

          <div class="detail-section">
            <div class="section-headline">
              <div>
                <span class="section-kicker">Pruefung</span>
                <h4>Quellen der KPI-Analyse</h4>
              </div>
            </div>
            ${renderSourceSummary(item)}
          </div>
        </div>

        <div class="detail-section">
          <div class="section-headline">
            <div>
              <span class="section-kicker">Unterlagen</span>
              <h4>Dokumente und Anhaenge</h4>
            </div>
          </div>
          <div class="modal-doc-list">${renderDocuments(item.documents)}</div>
        </div>
      </section>

      <aside class="detail-sidebar">
        <div class="detail-section detail-section--sticky">
          <div class="section-headline">
            <div>
              <span class="section-kicker">Decision</span>
              <h4>Analyse und Bewertung</h4>
            </div>
          </div>

          <div class="summary-stack">
            <div class="summary-item"><span>Entscheidung</span><strong>${escapeHtml(decisionLabel(analysis.decision))}</strong></div>
            <div class="summary-item"><span>Lage-Score</span><strong>${escapeHtml(analysis.locationScore ?? "-")}</strong></div>
            <div class="summary-item"><span>Asset-Score</span><strong>${escapeHtml(analysis.assetScore ?? "-")}</strong></div>
            <div class="summary-item"><span>Gericht</span><strong>${escapeHtml(item.courtContext ?? "-")}</strong></div>
            <div class="summary-item"><span>Verfahrensart</span><strong>${escapeHtml(item.procedureType ?? "-")}</strong></div>
            <div class="summary-item"><span>Einwohner</span><strong>${item.cityData?.population ? new Intl.NumberFormat("de-DE").format(item.cityData.population) : "-"}</strong></div>
          </div>

          <form class="form-grid" id="analysis-form">
            <div class="form-row form-row--stack">
              <label class="form-field">
                <span>Strategie-Fit</span>
                <input name="strategyFit" value="${escapeHtml(analysis.strategyFit ?? "")}" />
              </label>
              <label class="form-field">
                <span>Decision</span>
                <select name="decision">
                  <option value="open" ${analysis.decision === "open" ? "selected" : ""}>Offen</option>
                  <option value="watch" ${analysis.decision === "watch" ? "selected" : ""}>Beobachten</option>
                  <option value="go" ${analysis.decision === "go" ? "selected" : ""}>Go</option>
                  <option value="no_go" ${analysis.decision === "no_go" ? "selected" : ""}>No-Go</option>
                </select>
              </label>
            </div>
            <div class="form-row">
              <label class="form-field"><span>Lage-Score</span><input name="locationScore" type="number" min="1" max="10" value="${escapeHtml(analysis.locationScore ?? "")}" /></label>
              <label class="form-field"><span>Asset-Score</span><input name="assetScore" type="number" min="1" max="10" value="${escapeHtml(analysis.assetScore ?? "")}" /></label>
            </div>
            <label class="form-field">
              <span>Notizen</span>
              <textarea name="notes" rows="5">${escapeHtml(analysis.notes ?? "")}</textarea>
            </label>
            <button type="submit" class="button-primary">Analyse speichern</button>
          </form>
        </div>

        <details class="detail-section detail-section--collapsed">
          <summary>
            <span>
              <span class="section-kicker">Sekundaer</span>
              <strong>Pipeline bearbeiten</strong>
            </span>
            <span class="summary-hint">Nur wenn noetig</span>
          </summary>
          <form class="form-grid" id="pipeline-form">
            <input type="hidden" name="auctionKey" value="${escapeHtml(item.auctionKey)}" />
            <div class="form-row form-row--stack">
              <label class="form-field">
                <span>Status</span>
                <select name="stage">
                  <option value="shortlist" ${ps.stage === "shortlist" ? "selected" : ""}>Shortlist</option>
                  <option value="in_pruefung" ${ps.stage === "in_pruefung" ? "selected" : ""}>In Pruefung</option>
                  <option value="gebot_geplant" ${ps.stage === "gebot_geplant" ? "selected" : ""}>Gebot geplant</option>
                  <option value="verworfen" ${ps.stage === "verworfen" ? "selected" : ""}>Verworfen</option>
                  <option value="gekauft" ${ps.stage === "gekauft" ? "selected" : ""}>Gekauft</option>
                </select>
              </label>
              <label class="form-field">
                <span>Prioritaet</span>
                <select name="priority">
                  <option value="high" ${ps.priority === "high" ? "selected" : ""}>Hoch</option>
                  <option value="medium" ${ps.priority === "medium" ? "selected" : ""}>Mittel</option>
                  <option value="low" ${ps.priority === "low" ? "selected" : ""}>Niedrig</option>
                </select>
              </label>
            </div>
            <label class="form-field">
              <span>Investment-These</span>
              <textarea name="thesis" rows="2">${escapeHtml(ps.thesis ?? "")}</textarea>
            </label>
            <label class="form-field">
              <span>Naechster Schritt</span>
              <textarea name="nextStep" rows="2">${escapeHtml(ps.nextStep ?? "")}</textarea>
            </label>
            <label class="form-field">
              <span>Zielgebot (EUR)</span>
              <input name="targetBidEur" type="number" step="1000" min="0" value="${escapeHtml(ps.targetBidEur ?? "")}" />
            </label>
            <button type="submit" class="button-secondary button-secondary--solid">Pipeline speichern</button>
          </form>
        </details>
      </aside>
    </div>
  `;

  detailModalEl.hidden = false;
  document.body.classList.add("modal-open");
}

function closeDetailModal() {
  detailModalEl.hidden = true;
  detailContentEl.innerHTML = "";
  document.body.classList.remove("modal-open");
}

async function reload(page = 1) {
  const res = await fetch(`/api/pipeline?page=${page}&pageSize=10&scope=upcoming`);
  const payload = await res.json();
  pipeline = payload.items ?? [];
  pagination = payload.pagination ?? pagination;
  renderMetrics();
  renderPagination();
  applyFilters();
}

rowsEl.addEventListener("click", (event) => {
  const row = event.target.closest("[data-auction-key]");
  if (!row) return;
  const item = pipeline.find((i) => i.auctionKey === row.dataset.auctionKey);
  if (item) renderDetailModal(item);
});

detailContentEl.addEventListener("click", async (event) => {
  const button = event.target.closest("#run-analysis-button");
  if (!button) return;

  const pipelineForm = detailContentEl.querySelector("#pipeline-form");
  const auctionKey = pipelineForm ? new FormData(pipelineForm).get("auctionKey") : null;
  if (!auctionKey) return;

  button.disabled = true;
  button.textContent = "Analysiere...";

  try {
    const res = await fetch(`/api/analysis/${encodeURIComponent(auctionKey)}/run`, {
      method: "POST"
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error ?? "Analyse fehlgeschlagen");
    }

    const index = pipeline.findIndex((entry) => entry.auctionKey === auctionKey);
    if (index >= 0) {
      pipeline[index] = payload;
    }
    renderDetailModal(payload);
  } catch (error) {
    window.alert(error.message);
    button.disabled = false;
    button.textContent = "Analyse aktualisieren";
  }
});

detailContentEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (event.target.id === "pipeline-form") {
      const fd = new FormData(event.target);
      await fetch("/api/pipeline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auctionKey: fd.get("auctionKey"),
          stage: fd.get("stage"),
          priority: fd.get("priority"),
          thesis: fd.get("thesis") || null,
          nextStep: fd.get("nextStep") || null,
          targetBidEur: fd.get("targetBidEur") ? Number(fd.get("targetBidEur")) : null
        })
      });
      closeDetailModal();
      await reload(pagination.page);
      return;
    }

    if (event.target.id === "analysis-form") {
      const pipelineForm = detailContentEl.querySelector("#pipeline-form");
      const auctionKey = pipelineForm ? new FormData(pipelineForm).get("auctionKey") : null;
      if (!auctionKey) return;

      const current = pipeline.find((entry) => entry.auctionKey === auctionKey);
      const fd = new FormData(event.target);
      await fetch(`/api/analysis/${encodeURIComponent(auctionKey)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategyFit: fd.get("strategyFit") || null,
          locationScore: fd.get("locationScore") ? Number(fd.get("locationScore")) : null,
          assetScore: fd.get("assetScore") ? Number(fd.get("assetScore")) : null,
          executionScore: current?.analysis?.executionScore ?? null,
          screening: current?.analysis?.screening ?? {},
          finance: current?.analysis?.finance ?? {},
          dueDiligence: current?.analysis?.dueDiligence ?? {},
          notes: fd.get("notes") || null,
          decision: fd.get("decision") || "open"
        })
      });
      closeDetailModal();
      await reload(pagination.page);
    }
  } catch (error) {
    window.alert(error.message);
  }
});

detailCloseEl.addEventListener("click", closeDetailModal);
detailBackdropEl.addEventListener("click", closeDetailModal);
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !detailModalEl.hidden) closeDetailModal(); });

searchEl.addEventListener("input", applyFilters);
stageFilterEl.addEventListener("change", applyFilters);
priorityFilterEl.addEventListener("change", applyFilters);
prevPageEl?.addEventListener("click", () => {
  if (pagination.hasPreviousPage) {
    reload(pagination.page - 1).catch((error) => {
      rowsEl.innerHTML = `<tr class="empty-row"><td colspan="8">${escapeHtml(error.message)}</td></tr>`;
    });
  }
});
nextPageEl?.addEventListener("click", () => {
  if (pagination.hasNextPage) {
    reload(pagination.page + 1).catch((error) => {
      rowsEl.innerHTML = `<tr class="empty-row"><td colspan="8">${escapeHtml(error.message)}</td></tr>`;
    });
  }
});

reload().catch((error) => {
  rowsEl.innerHTML = `<tr class="empty-row"><td colspan="8">${escapeHtml(error.message)}</td></tr>`;
});

