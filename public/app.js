const rowsEl = document.querySelector("#rows");
const searchEl = document.querySelector("#search");
const typeEl = document.querySelector("#type");
const stateEl = document.querySelector("#state");
const scrapeButtonEl = document.querySelector("#scrape-button");
const scrapeStateEl = document.querySelector("#scrape-state");
const scrapeLimitEl = document.querySelector("#scrape-limit");
const scrapeStatusEl = document.querySelector("#scrape-status");
const statusBadgeEl = document.querySelector("#status-badge");
const resultCountEl = document.querySelector("#result-count");
const menuButtonEl = document.querySelector("#menu-button");
const controlDrawerEl = document.querySelector("#control-drawer");
const drawerCloseEl = document.querySelector("#drawer-close");
const drawerBackdropEl = document.querySelector("#drawer-backdrop");
const loadingOverlayEl = document.querySelector("#loading-overlay");
const tableContextEl = document.querySelector("#table-context");
const summaryTotalEl = document.querySelector("#summary-total");
const summaryStatesEl = document.querySelector("#summary-states");
const summaryUpdatedEl = document.querySelector("#summary-updated");
const detailModalEl = document.querySelector("#detail-modal");
const detailBackdropEl = document.querySelector("#detail-backdrop");
const detailCloseEl = document.querySelector("#detail-close");
const detailContentEl = document.querySelector("#detail-content");
const paginationEl = document.querySelector("#pagination");
const paginationInfoEl = document.querySelector("#pagination-info");
const prevPageEl = document.querySelector("#prev-page");
const nextPageEl = document.querySelector("#next-page");

let records = [];
let scrapeInFlight = false;
let pollTimer = null;
let pagination = { page: 1, pageSize: 10, totalItems: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false };
const DEFAULT_SCRAPE_DELAY_MS = 350;

function openDrawer() {
  controlDrawerEl.classList.add("is-open");
  controlDrawerEl.setAttribute("aria-hidden", "false");
  drawerBackdropEl.hidden = false;
  menuButtonEl.setAttribute("aria-expanded", "true");
}

function closeDrawer() {
  controlDrawerEl.classList.remove("is-open");
  controlDrawerEl.setAttribute("aria-hidden", "true");
  drawerBackdropEl.hidden = true;
  menuButtonEl.setAttribute("aria-expanded", "false");
}

function toggleDrawer() {
  if (controlDrawerEl.classList.contains("is-open")) {
    closeDrawer();
    return;
  }

  openDrawer();
}

function setLoadingState(isLoading) {
  loadingOverlayEl.hidden = !isLoading;
  loadingOverlayEl.setAttribute("aria-hidden", String(!isLoading));
  document.body.classList.toggle("loading", isLoading);

  if (isLoading) {
    closeDrawer();
    closeDetailModal();
  }
}

function eur(value) {
  if (typeof value !== "number") {
    return "n/a";
  }

  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(value);
}

function formatTimestamp(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date) + " Uhr";
}

function formatAuctionParts(item) {
  const rawText = item.auctionDateText ?? "";
  const isoValue = item.auctionDateIso;

  if (isoValue) {
    const date = new Date(isoValue);
    if (!Number.isNaN(date.getTime())) {
      return {
        date: new Intl.DateTimeFormat("de-DE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric"
        }).format(date),
        time: new Intl.DateTimeFormat("de-DE", {
          hour: "2-digit",
          minute: "2-digit"
        }).format(date),
        note: /aufgehoben/i.test(rawText) ? "Aufgehoben" : ""
      };
    }
  }

  const timeMatch = rawText.match(/(\d{1,2}:\d{2})\s*Uhr/i);
  return {
    date: rawText || "-",
    time: timeMatch ? `${timeMatch[1]} Uhr` : "",
    note: /aufgehoben/i.test(rawText) ? "Aufgehoben" : ""
  };
}

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function docTagClass(category) {
  const c = (category ?? "sonstiges").toLowerCase().replace(/[^a-z]/g, "");
  if (c.includes("gutachten")) return "doc-tag--gutachten";
  if (c.includes("expose")) return "doc-tag--expose";
  if (c.includes("foto")) return "doc-tag--foto";
  if (c.includes("bekanntmachung")) return "doc-tag--bekanntmachung";
  if (c.includes("grundbuch") || c.includes("plan")) return "doc-tag--grundbuch";
  return "doc-tag--sonstiges";
}

async function loadScrapeStates() {
  try {
    const res = await fetch("/api/states");
    const states = await res.json();
    scrapeStateEl.innerHTML = '<option value="">Alle Bundeslaender</option>';
    for (const s of states) {
      const option = document.createElement("option");
      option.value = s.code;
      option.textContent = s.name;
      scrapeStateEl.append(option);
    }
  } catch {
    scrapeStateEl.innerHTML = '<option value="">Alle Bundeslaender</option>';
  }
}

function fillStateFilter(items) {
  const currentValue = stateEl.value;
  const states = [...new Map(
    items
      .filter((item) => item.landCode)
      .map((item) => [item.landCode, item.address?.state ?? item.landCode.toUpperCase()])
  ).entries()].sort((a, b) => a[1].localeCompare(b[1], "de"));

  stateEl.innerHTML = '<option value="">Alle Bundeslaender</option>';
  for (const [stateCode, stateName] of states) {
    const option = document.createElement("option");
    option.value = stateCode;
    option.textContent = stateName;
    stateEl.append(option);
  }
  stateEl.value = currentValue;
}

function fillTypeFilter(items) {
  const currentValue = typeEl.value;
  const types = [...new Set(items.map((item) => item.objectType).filter(Boolean))].sort();
  typeEl.innerHTML = '<option value="">Alle Objektarten</option>';
  for (const type of types) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    typeEl.append(option);
  }
  typeEl.value = currentValue;
}

function renderResultCount(count) {
  resultCountEl.textContent = `${count} ${count === 1 ? "Objekt" : "Objekte"}`;
}

function renderOverview(items) {
  const total = pagination.totalItems;
  const states = new Set(items.map((item) => item.landCode).filter(Boolean)).size;

  summaryTotalEl.textContent = new Intl.NumberFormat("de-DE").format(total);
  summaryStatesEl.textContent = new Intl.NumberFormat("de-DE").format(states);
}

function renderDocuments(docs) {
  if (!docs?.length) {
    return '<span class="small">Keine Dokumente vorhanden.</span>';
  }

  return docs
    .map((doc) => {
      const href = doc.url ? `/api/documents?url=${encodeURIComponent(doc.url)}` : "#";
      const tagLabel = escapeHtml(doc.category ?? doc.label ?? doc.name ?? "Dokument");
      const tagCls = docTagClass(doc.category);
      const fileName = escapeHtml(doc.name ?? doc.label ?? "Dokument");
      const sizeText = doc.sizeText ? `<span class="small">${escapeHtml(doc.sizeText)}</span>` : "";
      return `
        <div class="modal-doc-item">
          <a class="doc-tag ${tagCls}" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${tagLabel}</a>
          <a class="modal-doc-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${fileName}</a>
          ${sizeText}
        </div>
      `;
    })
    .join("");
}

function renderDetailModal(item) {
  const addr = item.address ?? {};
  const location = [addr.street, [addr.postalCode, addr.city].filter(Boolean).join(" "), addr.district]
    .filter(Boolean)
    .join(", ");

  detailContentEl.innerHTML = `
    <div class="modal-headline">
      <div>
        <p class="modal-kicker">${escapeHtml(addr.state ?? item.landCode?.toUpperCase() ?? "")}</p>
        <h3 id="detail-title">${escapeHtml(item.objectType ?? "Objekt")}</h3>
        <p class="small">${escapeHtml(item.aktenzeichen ?? "-")}</p>
      </div>
      ${item.detailUrl ? `<a class="modal-link" href="/api/detail?url=${encodeURIComponent(item.detailUrl)}" target="_blank" rel="noreferrer">Originalansicht</a>` : ""}
    </div>

    <div class="modal-grid">
      <div class="modal-card">
        <strong>Objekt</strong>
        <p>${escapeHtml(item.objectType ?? "-")}</p>
      </div>
      <div class="modal-card">
        <strong>Adresse</strong>
        <p>${escapeHtml(location || item.locationText || "-")}</p>
      </div>
      <div class="modal-card">
        <strong>Bundesland</strong>
        <p>${escapeHtml(addr.state ?? item.landCode?.toUpperCase() ?? "-")}</p>
      </div>
      <div class="modal-card">
        <strong>Einwohner</strong>
        <p>${item.cityData?.population ? new Intl.NumberFormat("de-DE").format(item.cityData.population) : "-"}</p>
      </div>
      <div class="modal-card">
        <strong>Wert</strong>
        <p>${escapeHtml(eur(item.valuationAmountEur))}</p>
      </div>
      <div class="modal-card">
        <strong>Termin</strong>
        <p>${escapeHtml(item.auctionDateText ?? "-")}</p>
      </div>
      <div class="modal-card">
        <strong>Gericht</strong>
        <p>${escapeHtml(item.courtContext ?? "-")}</p>
      </div>
      <div class="modal-card">
        <strong>Verfahrensart</strong>
        <p>${escapeHtml(item.procedureType ?? "-")}</p>
      </div>
    </div>

    <div class="modal-section">
      <strong>Beschreibung</strong>
      <p class="modal-description">${escapeHtml(item.description ?? "-")}</p>
    </div>

    <div class="modal-section">
      <strong>Dokumente</strong>
      <div class="modal-doc-list">${renderDocuments(item.documents)}</div>
    </div>

    <div class="modal-section" style="margin-top:1.5rem;display:flex;gap:0.5rem;">
      ${item.pipeline
        ? `<button class="btn btn-secondary" disabled style="padding:0.6rem 1.2rem;border-radius:6px;cursor:default;opacity:0.7;">Bereits in Pipeline (${escapeHtml(item.pipeline.stage)})</button>`
        : `<button class="btn btn-primary" id="add-to-pipeline-btn" style="padding:0.6rem 1.2rem;border-radius:6px;background:#2563eb;color:#fff;border:none;cursor:pointer;font-weight:600;">Zur Pipeline hinzufuegen</button>`}
    </div>
  `;

  const addBtn = detailContentEl.querySelector("#add-to-pipeline-btn");
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      addBtn.disabled = true;
      addBtn.textContent = "Wird hinzugefuegt...";
      try {
        const res = await fetch("/api/pipeline", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ auctionKey: item.auctionKey, stage: "shortlist", priority: "medium", source: "manual" })
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Fehler beim Hinzufuegen");
        addBtn.textContent = "Zur Pipeline hinzugefuegt!";
        addBtn.style.background = "#6b7280";
        addBtn.style.cursor = "default";
        Object.assign(item, payload);
      } catch (err) {
        addBtn.disabled = false;
        addBtn.textContent = "Fehler - erneut versuchen";
        console.error(err);
      }
    });
  }

  detailModalEl.hidden = false;
  document.body.classList.add("modal-open");
}

function closeDetailModal() {
  detailModalEl.hidden = true;
  detailContentEl.innerHTML = "";
  document.body.classList.remove("modal-open");
}

function renderTable(items) {
  if (!items.length) {
    rowsEl.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">Keine passenden Eintraege auf dieser Seite gefunden.</td>
      </tr>
    `;
    renderResultCount(0);
    return;
  }

  renderResultCount(items.length);
  rowsEl.innerHTML = items
    .map((item) => {
      const auctionParts = formatAuctionParts(item);
      const objectName = escapeHtml(item.objectType ?? "Unbekannt");

      const addr = item.address ?? {};
      const stateName = addr.state ?? "";
      const streetLine = addr.street ?? item.locationText ?? "";

      return `
        <tr data-auction-key="${escapeHtml(item.auctionKey ?? "")}">
          <td>
            ${stateName ? `<span class="pill">${escapeHtml(stateName)}</span>` : '<span class="small">-</span>'}
          </td>
          <td>
            <span class="row-title">${escapeHtml(streetLine || "-")}</span>
          </td>
          <td>${escapeHtml(addr.postalCode ?? "-")}</td>
          <td>
            ${escapeHtml(addr.city ?? "-")}
            ${item.cityData?.population ? `<div class="small">${new Intl.NumberFormat("de-DE").format(item.cityData.population)} EW</div>` : ""}
          </td>
          <td>${objectName}</td>
          <td>${escapeHtml(eur(item.valuationAmountEur))}</td>
          <td>
            <div>${escapeHtml(auctionParts.date)}</div>
            ${auctionParts.time ? `<div class="small">${escapeHtml(auctionParts.time)}</div>` : ""}
            ${auctionParts.note ? `<div class="small">${escapeHtml(auctionParts.note)}</div>` : ""}
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderPagination() {
  if (!paginationEl) return;
  paginationInfoEl.textContent = `Seite ${pagination.page} von ${pagination.totalPages} | ${new Intl.NumberFormat("de-DE").format(pagination.totalItems)} kommende Deals`;
  prevPageEl.disabled = !pagination.hasPreviousPage;
  nextPageEl.disabled = !pagination.hasNextPage;
}

function renderStatus(payload) {
  const latestRun = payload?.latestRun;
  const scrape = payload?.scrape;

  if (scrape?.running) {
    statusBadgeEl.textContent = "Aktiv";
    statusBadgeEl.classList.remove("is-error");
    scrapeStatusEl.textContent = "Scrape laeuft gerade...";
    scrapeButtonEl.disabled = true;
    setLoadingState(true);
    startPolling();
    return;
  }

  statusBadgeEl.textContent = "Bereit";
  statusBadgeEl.classList.remove("is-error");
  scrapeButtonEl.disabled = false;
  setLoadingState(false);
  stopPolling();

  if (scrape?.error) {
    statusBadgeEl.textContent = "Fehler";
    statusBadgeEl.classList.add("is-error");
    scrapeStatusEl.textContent = `Letzter Fehler: ${scrape.error}`;
    return;
  }

  if (latestRun?.summary) {
    summaryUpdatedEl.textContent = formatTimestamp(latestRun.summary.generatedAt);
    scrapeStatusEl.textContent =
      `Letzter Lauf ${latestRun.summary.generatedAt}: ${latestRun.summary.exportedRecords} Datensaetze, ` +
      `${latestRun.summary.detailSuccess} Detailseiten erfolgreich.`;
    return;
  }

  summaryUpdatedEl.textContent = "-";
  scrapeStatusEl.textContent = "Noch keine Datenbanklaeufe vorhanden.";
}

function applyFilters() {
  const query = searchEl.value.trim().toLowerCase();
  const type = typeEl.value;
  const state = stateEl.value;

  const filtered = records.filter((item) => {
    if (type && item.objectType !== type) {
      return false;
    }

    if (state && item.landCode !== state) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = [
      item.aktenzeichen,
      item.objectType,
      item.locationText,
      item.address?.full,
      item.address?.state,
      item.courtContext,
      item.auctionLocation,
      item.description
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });

  const contextParts = [`Ab heute | ${new Intl.NumberFormat("de-DE").format(pagination.totalItems)} relevante Deals gesamt`];
  if (query) contextParts.push(`Suche: "${searchEl.value.trim()}"`);
  if (type) contextParts.push(`Objektart: ${type}`);
  if (state) {
    const stateLabel = stateEl.selectedOptions[0]?.textContent ?? state;
    contextParts.push(`Bundesland: ${stateLabel}`);
  }
  tableContextEl.textContent = contextParts.join(" | ");

  renderTable(filtered);
}

async function loadStatus() {
  const res = await fetch("/api/status");
  const payload = await res.json();
  renderStatus(payload);
  return payload;
}

async function loadAuctions(page = 1) {
  const res = await fetch(`/api/auctions?page=${page}&pageSize=10&scope=upcoming`);
  if (!res.ok) {
    rowsEl.innerHTML = `<tr><td colspan="7">Keine Daten gefunden. Bitte den Scraper starten.</td></tr>`;
    records = [];
    pagination = { page: 1, pageSize: 10, totalItems: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false };
    renderOverview(records);
    renderResultCount(0);
    renderPagination();
    return;
  }

  const payload = await res.json();
  records = payload.items ?? [];
  pagination = payload.pagination ?? pagination;
  renderOverview(records);
  fillStateFilter(records);
  fillTypeFilter(records);
  renderPagination();
  applyFilters();
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const payload = await (await fetch("/api/status")).json();
      renderStatus(payload);
      if (!payload.scrape?.running) {
        stopPolling();
        await loadAuctions(1);
      }
    } catch {
    }
  }, 3000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function startScrape() {
  if (scrapeInFlight) {
    return;
  }

  scrapeInFlight = true;
  scrapeButtonEl.disabled = true;
  scrapeStatusEl.textContent = "Scrape wird gestartet...";
  setLoadingState(true);

  const selectedState = scrapeStateEl.value.trim();
  const limit = scrapeLimitEl.value.trim();
  try {
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        states: selectedState ? [selectedState] : [],
        limit: limit ? Number.parseInt(limit, 10) : null,
        delayMs: DEFAULT_SCRAPE_DELAY_MS
      })
    });

    const payload = await res.json();

    if (res.status === 409) {
      scrapeStatusEl.textContent = "Ein Scrape laeuft bereits. Bitte warten.";
      startPolling();
      return;
    }

    if (!res.ok && res.status !== 202) {
      throw new Error(payload.error ?? "Scrape failed");
    }

    scrapeStatusEl.textContent = "Scrape laeuft im Hintergrund...";
    startPolling();
  } catch (error) {
    scrapeStatusEl.textContent = error.message;
    scrapeButtonEl.disabled = false;
    setLoadingState(false);
  } finally {
    scrapeInFlight = false;
  }
}

async function init() {
  await loadScrapeStates();
  await loadAuctions(1);
  await loadStatus();
}

searchEl.addEventListener("input", applyFilters);
typeEl.addEventListener("change", applyFilters);
stateEl.addEventListener("change", applyFilters);
prevPageEl?.addEventListener("click", () => {
  if (pagination.hasPreviousPage) {
    loadAuctions(pagination.page - 1).catch((error) => {
      rowsEl.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
    });
  }
});
nextPageEl?.addEventListener("click", () => {
  if (pagination.hasNextPage) {
    loadAuctions(pagination.page + 1).catch((error) => {
      rowsEl.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
    });
  }
});
rowsEl.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-auction-key]");
  if (!trigger) {
    return;
  }

  const auctionKey = trigger.dataset.auctionKey;
  const item = records.find((entry) => entry.auctionKey === auctionKey);
  if (item) {
    renderDetailModal(item);
  }
});
detailCloseEl.addEventListener("click", closeDetailModal);
detailBackdropEl.addEventListener("click", closeDetailModal);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !detailModalEl.hidden) {
    closeDetailModal();
    return;
  }

  if (event.key === "Escape" && controlDrawerEl.classList.contains("is-open")) {
    closeDrawer();
  }
});
menuButtonEl.addEventListener("click", toggleDrawer);
drawerCloseEl.addEventListener("click", closeDrawer);
drawerBackdropEl.addEventListener("click", closeDrawer);
scrapeButtonEl.addEventListener("click", () => {
  startScrape().catch((error) => {
    scrapeStatusEl.textContent = error.message;
    scrapeInFlight = false;
    scrapeButtonEl.disabled = false;
  });
});

init().catch((error) => {
  rowsEl.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
});


