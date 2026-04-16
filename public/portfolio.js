const rowsEl = document.querySelector("#rows");
const resultCountEl = document.querySelector("#result-count");
const metricTotalEl = document.querySelector("#metric-total");
const metricValueEl = document.querySelector("#metric-value");
const metricBidsEl = document.querySelector("#metric-bids");
const detailModalEl = document.querySelector("#detail-modal");
const detailBackdropEl = document.querySelector("#detail-backdrop");
const detailCloseEl = document.querySelector("#detail-close");
const detailContentEl = document.querySelector("#detail-content");

let portfolio = [];

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

function renderMetrics() {
  metricTotalEl.textContent = String(portfolio.length);

  const totalValue = portfolio.reduce((sum, i) => sum + (i.valuationAmountEur ?? 0), 0);
  metricValueEl.textContent = totalValue > 0 ? eur(totalValue) : "-";

  const totalBids = portfolio.reduce((sum, i) => sum + (i.pipeline?.targetBidEur ?? 0), 0);
  metricBidsEl.textContent = totalBids > 0 ? eur(totalBids) : "-";
}

function renderTable() {
  resultCountEl.textContent = `${portfolio.length} ${portfolio.length === 1 ? "Objekt" : "Objekte"}`;

  if (!portfolio.length) {
    rowsEl.innerHTML = '<tr class="empty-row"><td colspan="7">Noch keine Objekte im Portfolio. Setze Deals in der Pipeline auf "Gekauft".</td></tr>';
    return;
  }

  rowsEl.innerHTML = portfolio.map((item) => {
    const addr = item.address ?? {};
    return `
      <tr data-auction-key="${escapeHtml(item.auctionKey ?? "")}">
        <td><span class="pill">Gekauft</span></td>
        <td>${addr.state ? `<span class="pill" style="background:rgba(21,21,21,0.05);color:rgba(21,21,21,0.72);">${escapeHtml(addr.state)}</span>` : '<span class="small">-</span>'}</td>
        <td><span class="row-title">${escapeHtml(addr.street ?? item.locationText ?? "-")}</span></td>
        <td>
          ${escapeHtml(addr.city ?? "-")}
          ${item.cityData?.population ? `<div class="small">${new Intl.NumberFormat("de-DE").format(item.cityData.population)} EW</div>` : ""}
        </td>
        <td>${escapeHtml(item.objectType ?? "-")}</td>
        <td>${escapeHtml(eur(item.valuationAmountEur))}</td>
        <td>${escapeHtml(eur(item.pipeline?.targetBidEur))}</td>
      </tr>
    `;
  }).join("");
}

function renderDetailModal(item) {
  const addr = item.address ?? {};
  const location = [addr.street, [addr.postalCode, addr.city].filter(Boolean).join(" "), addr.district].filter(Boolean).join(", ");
  const ps = item.pipeline ?? {};

  detailContentEl.innerHTML = `
    <div class="modal-headline">
      <div>
        <p class="modal-kicker">${escapeHtml(addr.state ?? item.landCode?.toUpperCase() ?? "")}</p>
        <h3 id="detail-title">${escapeHtml(item.objectType ?? "Objekt")}</h3>
        <p class="small">${escapeHtml(item.aktenzeichen ?? "-")}</p>
      </div>
    </div>

    <div class="modal-grid">
      <div class="modal-card"><strong>Adresse</strong><p>${escapeHtml(location || "-")}</p></div>
      <div class="modal-card"><strong>Einwohner</strong><p>${item.cityData?.population ? new Intl.NumberFormat("de-DE").format(item.cityData.population) : "-"}</p></div>
      <div class="modal-card"><strong>Verkehrswert</strong><p>${escapeHtml(eur(item.valuationAmountEur))}</p></div>
      <div class="modal-card"><strong>Zielgebot</strong><p>${escapeHtml(eur(ps.targetBidEur))}</p></div>
    </div>

    <div class="modal-section">
      <strong>Investment-These</strong>
      <p>${escapeHtml(ps.thesis ?? "Keine Investment-These hinterlegt.")}</p>
    </div>

    <div class="modal-section">
      <strong>Beschreibung</strong>
      <p>${escapeHtml(item.description ?? "-")}</p>
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

rowsEl.addEventListener("click", (event) => {
  const row = event.target.closest("[data-auction-key]");
  if (!row) return;
  const item = portfolio.find((i) => i.auctionKey === row.dataset.auctionKey);
  if (item) renderDetailModal(item);
});

detailCloseEl.addEventListener("click", closeDetailModal);
detailBackdropEl.addEventListener("click", closeDetailModal);
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !detailModalEl.hidden) closeDetailModal(); });

fetch("/api/portfolio")
  .then((res) => res.json())
  .then((items) => {
    portfolio = items;
    renderMetrics();
    renderTable();
  })
  .catch((error) => {
    rowsEl.innerHTML = `<tr class="empty-row"><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  });
