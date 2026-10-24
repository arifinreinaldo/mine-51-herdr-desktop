// The SQLite inspector page: pick a running app on an adb device, pick one of
// the databases it holds open, pull a local copy, browse and query it. Write
// mode edits the copy; Push to device copies it back over the app's database.
// Errors show inline (`#error-notices` does not exist on this page). Every
// name, path and cell comes from the device, so the page sets text with
// `textContent` and never uses `innerHTML`.

import "./style.css";
import { PAGE_ROWS, baseName, rowRange, tableSql } from "./android/dbFormat";
import { parseMirrorToolsParams } from "./android/mirrorToolsParams";
import { errorMessage } from "./appApi";
import {
  androidAppDatabases,
  androidDbQuery,
  androidPullDatabase,
  androidPushDatabase,
  androidRunningApps,
  type QueryPage,
} from "./flutter/flutterApi";
import { applySavedTheme } from "./themes/savedTheme";
import { openConfirmPopover } from "./ui/confirmPopover";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, icon?: string): HTMLButtonElement {
  const btn = el("button", className);
  btn.type = "button";
  if (icon) btn.append(el("i", `codicon codicon-${icon}`));
  if (text) btn.append(el("span", undefined, text));
  return btn;
}

/** A picker with a leading icon; the select keeps its own aria-label. */
function field(icon: string, select: HTMLSelectElement): HTMLElement {
  const wrap = el("label", "db-field");
  wrap.append(el("i", `codicon codicon-${icon}`), select);
  return wrap;
}

/** A column is numeric when every non-NULL cell on the page parses as a number. */
function numericColumns(page: QueryPage): boolean[] {
  return page.columns.map((_, i) => {
    let seen = false;
    for (const row of page.rows) {
      const value = row[i];
      if (value === null) continue;
      if (value.trim() === "" || !Number.isFinite(Number(value))) return false;
      seen = true;
    }
    return seen;
  });
}

function fillSelect(
  select: HTMLSelectElement,
  placeholder: string,
  values: string[],
  selected: string | null,
  label = (value: string) => value,
): void {
  select.replaceChildren();
  const first = el("option", undefined, placeholder);
  first.value = "";
  select.append(first);
  for (const value of values) {
    const option = el("option", undefined, label(value));
    option.value = value;
    select.append(option);
  }
  select.value = selected ?? "";
}

async function main(): Promise<void> {
  const root = document.getElementById("db-root");
  if (!root) return;
  const params = parseMirrorToolsParams(location.search);
  if (!params) {
    root.textContent = "Invalid inspector parameters";
    return;
  }
  const id = params.deviceId;
  await applySavedTheme();
  document.title = "SQLite — " + params.deviceName;

  let apps: string[] = [];
  let app: string | null = null;
  let dbs: string[] = [];
  let dbPath: string | null = null;
  let tables: string[] = [];
  let sql = "";
  let offset = 0;
  let hasMore = false;
  let busy = false;
  let pulledText = "";
  // shortcut: closing the window drops unpushed edits without a confirm. onCloseRequested needs a new
  // capabilities/db-inspector.json granting core:event:allow-listen and core:window:allow-destroy; add it if users lose edits.
  let dirty = false;

  const appSelect = el("select", "db-select");
  appSelect.setAttribute("aria-label", "App");
  const dbSelect = el("select", "db-select db-select--wide");
  dbSelect.setAttribute("aria-label", "Database");
  const refreshBtn = button("btn db-btn", "Refresh", "refresh");
  refreshBtn.title = "Pull the database again";
  const pushBtn = button("btn db-btn", "Push to device", "cloud-upload");
  pushBtn.title = "Copy the edited database back over the app's database";
  const dirtyBadge = el("span", "db-dirty", "Not pushed");
  const status = el("span", "db-status");
  status.setAttribute("aria-live", "polite");
  const progress = el("div", "db-progress");
  progress.setAttribute("aria-hidden", "true");
  const bar = el("div", "db-bar");
  bar.append(field("device-mobile", appSelect), field("database", dbSelect), refreshBtn, pushBtn, dirtyBadge, status, progress);

  const errorText = el("span", "db-error__text");
  const errorBar = el("div", "db-error");
  errorBar.setAttribute("role", "alert");
  errorBar.append(el("i", "codicon codicon-error"), errorText);
  errorBar.hidden = true;

  const tableCount = el("span", "db-side__count");
  const sideHead = el("div", "db-side__head");
  sideHead.append(el("span", undefined, "Tables"), tableCount);
  const filterInput = el("input", "db-filter");
  filterInput.type = "text";
  filterInput.spellcheck = false;
  filterInput.placeholder = "Filter tables";
  filterInput.setAttribute("aria-label", "Filter tables");
  const tableList = el("ul", "db-tables");
  tableList.setAttribute("aria-label", "Tables");
  const side = el("nav", "db-side");
  side.append(sideHead, filterInput, tableList);

  const sqlBox = el("textarea", "db-sql");
  sqlBox.spellcheck = false;
  sqlBox.rows = 1;
  sqlBox.setAttribute("aria-label", "SQL");
  sqlBox.placeholder = "SELECT * FROM … (Ctrl+Enter to run)";
  const runBtn = button("btn btn--primary db-btn", "Run", "play");
  runBtn.title = "Run the statement (Ctrl+Enter)";
  const writeBox = el("input");
  writeBox.type = "checkbox";
  const writeToggle = el("label", "db-write");
  writeToggle.title = "Also run statements that change the local copy. Push to device sends the copy to the phone";
  writeToggle.append(writeBox, el("span", undefined, "Write mode"));
  const query = el("div", "db-query");
  query.append(sqlBox, writeToggle, runBtn);

  const resultTable = el("table", "db-result");
  const emptyText = el("p", "db-empty");
  const grid = el("div", "db-grid");
  grid.append(resultTable, emptyText);

  const prevBtn = button("icon-btn db-page-btn", "", "chevron-left");
  prevBtn.title = "Previous page";
  prevBtn.setAttribute("aria-label", "Previous page");
  const range = el("span", "db-range");
  const nextBtn = button("icon-btn db-page-btn", "", "chevron-right");
  nextBtn.title = "Next page";
  nextBtn.setAttribute("aria-label", "Next page");
  const pager = el("div", "db-pager");
  pager.append(range, prevBtn, nextBtn);

  const work = el("div", "db-work");
  work.append(query, grid, pager);
  const mainEl = el("div", "db-main");
  mainEl.append(side, work);
  root.append(bar, errorBar, mainEl);

  function setStatus(text: string, isError = false, title = ""): void {
    if (isError) {
      errorText.textContent = text;
      errorBar.hidden = false;
      return;
    }
    errorBar.hidden = true;
    status.textContent = text;
    status.title = title;
  }

  /** The grid's placeholder: the next thing to do, or why it is empty. */
  function renderEmpty(): void {
    // `rows` counts the header row too.
    let text = "";
    if (resultTable.rows.length > 1) text = "";
    else if (resultTable.rows.length === 1) text = "No rows";
    else if (!app) text = "Choose a running app to see the databases it has open";
    else if (!dbPath) text = "Choose a database to pull a local copy";
    else if (tables.length > 0 || sql === "") text = "Choose a table, or write a query and press Run";
    emptyText.textContent = text;
    emptyText.hidden = text === "";
  }

  function renderControls(): void {
    appSelect.disabled = busy;
    dbSelect.disabled = busy || !app;
    refreshBtn.disabled = busy;
    runBtn.disabled = busy || !dbPath || sqlBox.value.trim() === "";
    prevBtn.disabled = busy || offset === 0 || sql === "";
    nextBtn.disabled = busy || !hasMore;
    prevBtn.hidden = nextBtn.hidden = offset === 0 && !hasMore;
    pushBtn.disabled = busy || !dirty;
    dirtyBadge.hidden = !dirty;
    // state wins: a cancelled or superseded discard confirm leaves a select on the new value
    appSelect.value = app ?? "";
    dbSelect.value = dbPath ?? "";
    dbSelect.title = dbPath ?? "";
    pager.hidden = sql === "" || resultTable.rows.length === 0;
    progress.classList.toggle("is-busy", busy);
    renderEmpty();
    for (const btn of Array.from(tableList.querySelectorAll("button"))) btn.disabled = busy;
  }

  /** Grows the SQL box with its text; the CSS max-height caps it at 8 lines. */
  function fitSql(): void {
    sqlBox.style.height = "auto";
    sqlBox.style.height = `${sqlBox.scrollHeight + 2}px`; // + the two 1px borders (border-box)
  }

  function renderTables(): void {
    tableList.replaceChildren();
    const filter = filterInput.value.trim().toLowerCase();
    const shown = tables.filter((name) => name.toLowerCase().includes(filter));
    tableCount.textContent = tables.length === 0 ? "" : filter ? `${shown.length} / ${tables.length}` : String(tables.length);
    filterInput.hidden = tables.length === 0;
    for (const name of shown) {
      const item = el("li");
      const btn = button(sql === tableSql(name) ? "db-table is-active" : "db-table", name, "table");
      btn.title = name;
      btn.disabled = busy;
      btn.addEventListener("click", () =>
        run(() => {
          sqlBox.value = tableSql(name);
          fitSql();
          return showPage(0, sqlBox.value);
        }),
      );
      item.append(btn);
      tableList.append(item);
    }
  }

  function renderGrid(page: QueryPage | null): void {
    resultTable.replaceChildren();
    if (page) {
      const numeric = numericColumns(page);
      const head = el("tr");
      page.columns.forEach((column, i) => {
        const th = el("th", numeric[i] ? "db-num" : undefined, column);
        th.title = column;
        head.append(th);
      });
      const thead = el("thead");
      thead.append(head);
      resultTable.append(thead);
      const body = el("tbody");
      for (const row of page.rows) {
        const tr = el("tr");
        row.forEach((value, i) => {
          const td = el("td", value === null ? "db-null" : numeric[i] ? "db-num" : undefined, value ?? "NULL");
          td.title = value ?? "NULL";
          tr.append(td);
        });
        body.append(tr);
      }
      resultTable.append(body);
    }
    renderEmpty();
  }

  async function run(task: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    renderControls();
    try {
      await task();
    } catch (err) {
      setStatus(errorMessage(err), true);
    } finally {
      busy = false;
      renderControls();
    }
  }

  /** Runs `statement` from row `off`. Only a read becomes `sql`: Refresh and the pager re-run `sql`, and a write must not run twice. */
  async function showPage(off: number, statement = sql): Promise<void> {
    const page = await androidDbQuery(id, app!, dbPath!, statement, off, writeBox.checked);
    sql = page.wrote ? "" : statement;
    if (page.wrote) dirty = true;
    offset = off;
    hasMore = page.hasMore;
    renderGrid(page);
    range.textContent = rowRange(off, page.rows.length, page.hasMore);
    renderTables();
    setStatus(pulledText, false, status.title);
  }

  /** Forget the pulled database: its tables, the view and the grid. */
  function resetDb(): void {
    dbPath = null;
    dirty = false;
    filterInput.value = "";
    tables = [];
    sql = "";
    offset = 0;
    hasMore = false;
    renderTables();
    renderGrid(null);
    range.textContent = "";
  }

  function refresh(): Promise<void> {
    return run(async () => {
      setStatus("Loading apps…");
      apps = await androidRunningApps(id);
      if (app && !apps.includes(app)) apps = [...apps, app];
      fillSelect(appSelect, apps.length === 0 ? "No running apps" : "Choose an app", apps, app);
      if (!app) {
        setStatus(apps.length === 0 ? "No running apps. Start the app on the phone, then press Refresh" : "");
        return;
      }
      setStatus("Finding open databases…");
      dbs = await androidAppDatabases(id, app);
      if (dbPath && !dbs.includes(dbPath)) resetDb();
      fillSelect(dbSelect, dbs.length === 0 ? "No open databases" : "Choose a database", dbs, dbPath, baseName);
      if (!dbPath) {
        setStatus(dbs.length === 0 ? "No open SQLite databases right now. Use the app, then press Refresh" : "");
        return;
      }
      setStatus(`Pulling ${dbPath}…`);
      dirty = false; // the pull replaces the copy, or deletes it when it fails
      const pulled = await androidPullDatabase(id, app, dbPath);
      tables = pulled.tables;
      renderTables();
      pulledText = "Pulled " + new Date().toLocaleTimeString();
      setStatus(pulledText, false, pulled.path);
      if (sql !== "") await showPage(offset);
    });
  }

  /** Runs `proceed` now, or after a "Discard changes" confirm while the copy has unpushed edits. */
  const confirmDiscard = (anchor: HTMLElement, proceed: () => void): void => {
    if (!dirty) {
      proceed();
      return;
    }
    openConfirmPopover(root, anchor, {
      titlePrefix: "Discard changes to ",
      titleName: baseName(dbPath ?? ""),
      titleSuffix: "?",
      detail: "Your edits to the local copy are not pushed to the device.",
      confirmLabel: "Discard changes",
      onConfirm: () => {
        // a keyboard path can start a task while the popover is open; run() would drop the reload
        if (busy) renderControls();
        else proceed();
      },
      onCancel: () => {
        renderControls();
        anchor.focus();
      },
    });
  };

  appSelect.addEventListener("change", () => {
    const chosen = appSelect.value || null;
    confirmDiscard(appSelect, () => {
      app = chosen;
      resetDb();
      dbs = [];
      fillSelect(dbSelect, "Choose a database", dbs, null);
      void refresh();
    });
  });
  dbSelect.addEventListener("change", () => {
    const chosen = dbSelect.value || null;
    confirmDiscard(dbSelect, () => {
      resetDb();
      dbPath = chosen;
      void refresh();
    });
  });
  refreshBtn.addEventListener("click", () => confirmDiscard(refreshBtn, () => void refresh()));
  pushBtn.addEventListener("click", () => {
    if (!app || !dbPath) return;
    const pkg = app;
    const db = dbPath;
    openConfirmPopover(root, pushBtn, {
      titlePrefix: "Push ",
      titleName: baseName(db),
      titleSuffix: ` to ${params.deviceName}?`,
      detail: `${pkg} will be force-stopped. Its current database is backed up first, then replaced. Changes the app made since the pull are overwritten; the backup keeps them.`,
      confirmLabel: "Push",
      onConfirm: () => {
        if (busy) return;
        void run(async () => {
          setStatus(`Pushing ${db}…`);
          const pushed = await androidPushDatabase(id, pkg, db);
          dirty = false;
          // showPage re-shows pulledText, so the push result lives there too
          pulledText = `Pushed ${new Date().toLocaleTimeString()} · backup saved`;
          setStatus(pulledText, false, pushed.backupPath);
        });
      },
      onCancel: () => {
        renderControls(); // this confirm may have replaced a discard confirm that never got its onCancel
        pushBtn.focus();
      },
    });
  });
  sqlBox.addEventListener("input", () => {
    fitSql();
    renderControls();
  });
  sqlBox.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!runBtn.disabled) runBtn.click();
    }
  });
  runBtn.addEventListener("click", () => run(() => showPage(0, sqlBox.value.trim())));
  filterInput.addEventListener("input", renderTables);
  filterInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || filterInput.value === "") return;
    filterInput.value = "";
    renderTables();
  });
  prevBtn.addEventListener("click", () => run(() => showPage(Math.max(0, offset - PAGE_ROWS))));
  nextBtn.addEventListener("click", () => run(() => showPage(offset + PAGE_ROWS)));

  fillSelect(dbSelect, "Choose an app first", [], null);
  renderControls();
  void refresh();
}

void main();
