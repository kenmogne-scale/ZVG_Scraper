const collator = new Intl.Collator("de-DE", { numeric: true, sensitivity: "base" });

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalise(value) {
  return String(value ?? "").trim().toLowerCase();
}

function valueLabel(value) {
  if (value == null || value === "") return "-";
  return String(value);
}

function compareValues(a, b, type) {
  if (type === "number") {
    const av = typeof a === "number" ? a : Number.NaN;
    const bv = typeof b === "number" ? b : Number.NaN;
    if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
    if (Number.isNaN(av)) return 1;
    if (Number.isNaN(bv)) return -1;
    return av - bv;
  }

  if (type === "date") {
    const av = a ? new Date(a).getTime() : Number.NaN;
    const bv = b ? new Date(b).getTime() : Number.NaN;
    if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
    if (Number.isNaN(av)) return 1;
    if (Number.isNaN(bv)) return -1;
    return av - bv;
  }

  return collator.compare(valueLabel(a), valueLabel(b));
}

function injectStyles() {
  /* Styles are now in design.css — no inline injection needed */
}

export function createExcelTable({
  table,
  rows,
  columns,
  data = [],
  renderRow,
  emptyRow,
  onRender,
  storageKey
}) {
  injectStyles();

  const tableEl = typeof table === "string" ? document.querySelector(table) : table;
  const rowsEl = typeof rows === "string" ? document.querySelector(rows) : rows;
  const wrapEl = tableEl?.closest(".table-wrap");
  const state = {
    data,
    filteredData: data,
    filters: {},
    sort: null,
    activeMenu: null
  };

  tableEl?.classList.add("excel-table");
  wrapEl?.classList.add("excel-table-wrap");

  function columnValue(item, column) {
    return column.value ? column.value(item) : item[column.key];
  }

  function displayValue(item, column) {
    if (column.filterLabel) return column.filterLabel(item);
    const value = columnValue(item, column);
    return valueLabel(value);
  }

  function renderHeader() {
    const thead = tableEl.querySelector("thead") ?? tableEl.createTHead();
    thead.innerHTML = `
      <tr>
        ${columns.map((column) => {
          const active = state.filters[column.key]?.selected?.size || state.sort?.key === column.key;
          const sortState = state.sort?.key === column.key ? state.sort.direction : "";
          const sortType = column.type === "number" || column.type === "date" ? "numeric" : "alpha";
          return `
            <th>
              <button class="excel-th-button ${active ? "is-active" : ""}" type="button" data-column-key="${escapeHtml(column.key)}" title="${escapeHtml(column.label)} filtern">
                <span class="excel-th-label">${escapeHtml(column.label)}</span>
                <span class="excel-th-icon" data-sort="${escapeHtml(sortState)}" data-sort-type="${sortType}"></span>
              </button>
            </th>
          `;
        }).join("")}
      </tr>
    `;
  }

  function distinctOptions(column) {
    const values = new Map();
    for (const item of state.filteredData) {
      const raw = displayValue(item, column);
      const key = normalise(raw);
      if (!values.has(key)) values.set(key, raw);
    }
    return [...values.values()].sort((a, b) => collator.compare(a, b));
  }

  function closeMenu() {
    if (state.activeMenu) {
      state.activeMenu.remove();
      state.activeMenu = null;
    }
  }

  function openMenu(button, column) {
    closeMenu();

    const selected = new Set(state.filters[column.key]?.selected ?? []);
    const options = distinctOptions(column);
    const menu = document.createElement("div");
    const ascLabel = column.type === "number" ? "Niedrig → Hoch" : column.type === "date" ? "Aelteste zuerst" : "A bis Z";
    const descLabel = column.type === "number" ? "Hoch → Niedrig" : column.type === "date" ? "Neueste zuerst" : "Z bis A";
    menu.className = "excel-filter-menu";
    menu.innerHTML = `
      <div class="excel-filter-head">
        <span>${escapeHtml(column.label)}</span>
        <button class="excel-filter-close" type="button" data-action="close" aria-label="Schliessen">x</button>
      </div>
      <div class="excel-filter-body">
        <div class="excel-sort-row">
          <button class="excel-sort-action" type="button" data-action="sort-asc">${escapeHtml(ascLabel)}</button>
          <button class="excel-sort-action" type="button" data-action="sort-desc">${escapeHtml(descLabel)}</button>
        </div>
        <input class="excel-filter-search" type="search" placeholder="Werte suchen" />
        <label class="excel-filter-option">
          <input type="checkbox" data-action="toggle-all" checked />
          <span>Alle auswaehlen</span>
        </label>
        <div class="excel-filter-options">
          ${options.map((option) => {
            const checked = !selected.size || selected.has(normalise(option));
            return `
              <label class="excel-filter-option" data-option-row>
                <input type="checkbox" value="${escapeHtml(normalise(option))}" ${checked ? "checked" : ""} />
                <span title="${escapeHtml(option)}">${escapeHtml(option)}</span>
              </label>
            `;
          }).join("")}
        </div>
        <div class="excel-filter-actions">
          <button class="excel-filter-action" type="button" data-action="clear">Zuruecksetzen</button>
          <button class="excel-filter-action is-primary" type="button" data-action="apply">Anwenden</button>
        </div>
      </div>
    `;

    document.body.append(menu);
    const rect = button.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 12);
    menu.style.left = `${Math.max(12, left)}px`;
    menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 12)}px`;
    state.activeMenu = menu;

    const optionInputs = () => [...menu.querySelectorAll(".excel-filter-options input")];
    const searchInput = menu.querySelector(".excel-filter-search");
    const toggleAll = menu.querySelector("[data-action='toggle-all']");

    menu.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      if (action === "close") {
        closeMenu();
        return;
      }

      if (action === "sort-asc" || action === "sort-desc") {
        state.sort = { key: column.key, direction: action === "sort-asc" ? "asc" : "desc" };
        closeMenu();
        render();
        return;
      }

      if (action === "toggle-all") {
        const checked = event.target.checked;
        for (const input of optionInputs()) input.checked = checked;
        return;
      }

      if (action === "clear") {
        delete state.filters[column.key];
        if (state.sort?.key === column.key) state.sort = null;
        closeMenu();
        render();
        return;
      }

      if (action === "apply") {
        const inputs = optionInputs();
        const checked = inputs.filter((input) => input.checked).map((input) => input.value);
        if (checked.length === inputs.length) {
          delete state.filters[column.key];
        } else {
          state.filters[column.key] = { selected: new Set(checked) };
        }
        closeMenu();
        render();
      }
    });

    searchInput.addEventListener("input", () => {
      const query = normalise(searchInput.value);
      for (const row of menu.querySelectorAll("[data-option-row]")) {
        row.hidden = query && !normalise(row.textContent).includes(query);
      }
    });

    toggleAll.addEventListener("change", () => {
      for (const input of optionInputs()) input.checked = toggleAll.checked;
    });
  }

  function applyColumnFilters(items) {
    return items.filter((item) =>
      columns.every((column) => {
        const selected = state.filters[column.key]?.selected;
        if (!selected?.size) return true;
        return selected.has(normalise(displayValue(item, column)));
      })
    );
  }

  function sortItems(items) {
    if (!state.sort) return items;
    const column = columns.find((entry) => entry.key === state.sort.key);
    if (!column) return items;
    const direction = state.sort.direction === "asc" ? 1 : -1;
    return [...items].sort((a, b) => direction * compareValues(columnValue(a, column), columnValue(b, column), column.type));
  }

  function render() {
    const columnFiltered = applyColumnFilters(state.filteredData);
    const rendered = sortItems(columnFiltered);

    renderHeader();
    rowsEl.innerHTML = rendered.length
      ? rendered.map(renderRow).join("")
      : emptyRow(columns.length);

    if (storageKey) {
      sessionStorage.setItem(storageKey, JSON.stringify({
        filters: Object.fromEntries(Object.entries(state.filters).map(([key, value]) => [key, [...value.selected]])),
        sort: state.sort
      }));
    }

    onRender?.(rendered, {
      baseCount: state.filteredData.length,
      activeFilterCount: Object.keys(state.filters).length,
      sort: state.sort
    });
  }

  function restore() {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
      state.sort = saved.sort ?? null;
      state.filters = Object.fromEntries(
        Object.entries(saved.filters ?? {}).map(([key, values]) => [key, { selected: new Set(values) }])
      );
    } catch {
      state.sort = null;
      state.filters = {};
    }
  }

  tableEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-column-key]");
    if (!button) return;
    const column = columns.find((entry) => entry.key === button.dataset.columnKey);
    if (column) openMenu(button, column);
  });

  document.addEventListener("click", (event) => {
    if (!state.activeMenu) return;
    if (event.target.closest(".excel-filter-menu") || event.target.closest("[data-column-key]")) return;
    closeMenu();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  restore();
  renderHeader();

  return {
    apply(items) {
      state.filteredData = items ?? [];
      render();
    },
    setData(items) {
      state.data = items ?? [];
      state.filteredData = state.data;
      render();
    },
    clearColumnFilters() {
      state.filters = {};
      state.sort = null;
      render();
    }
  };
}
