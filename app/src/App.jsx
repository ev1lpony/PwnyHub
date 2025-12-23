import React, { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_ENGINE = "http://127.0.0.1:8787";
const LS_KEY = "pwnyhub_ui_v1";

// ---------- utils ----------
async function jfetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }
  return data;
}

function fmtMs(x) {
  const n = Number(x || 0);
  if (!Number.isFinite(n)) return "0";
  if (n < 10) return n.toFixed(1);
  return String(Math.round(n));
}

function fmtInt(x) {
  const n = Number(x || 0);
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n));
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function prefersDark() {
  try {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function riskStyle(score) {
  // score 0..100 => green(120) -> red(0)
  const s = clamp(Number(score || 0), 0, 100);
  const hue = 120 - s * 1.2;
  const dark = prefersDark();

  if (!dark) {
    return {
      backgroundColor: `hsl(${hue} 85% 90%)`,
      color: `hsl(${hue} 65% 22%)`,
      fontWeight: 900,
      borderRadius: 8,
      padding: "2px 8px",
      display: "inline-block",
      minWidth: 38,
      textAlign: "center",
      border: `1px solid hsl(${hue} 30% 75%)`,
    };
  }

  return {
    backgroundColor: `hsl(${hue} 55% 20%)`,
    color: `hsl(${hue} 65% 92%)`,
    fontWeight: 900,
    borderRadius: 8,
    padding: "2px 8px",
    display: "inline-block",
    minWidth: 38,
    textAlign: "center",
    border: `1px solid hsl(${hue} 35% 32%)`,
  };
}

function pillStyle(bg = "#222", fg = "#eee") {
  return {
    background: bg,
    color: fg,
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: 12,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid rgba(255,255,255,0.12)",
  };
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function useDebouncedValue(value, ms = 150) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

async function copyToClipboard(text) {
  const t = String(text ?? "");
  if (!t) return false;
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = t;
      el.setAttribute("readonly", "");
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

function downloadTextFile(filename, content, mime = "application/json") {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

function normalizeTopList(x) {
  if (!x) return [];
  if (Array.isArray(x)) {
    if (x.length && Array.isArray(x[0]) && x[0].length >= 2) return x;
    return x;
  }
  if (typeof x === "object") return Object.entries(x);
  return [];
}

function isMac() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

function parseLinesToList(text) {
  return String(text || "")
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function listToLines(list) {
  if (!Array.isArray(list)) return "";
  return list
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join("\n");
}

function safePrettyJson(obj) {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

// ---------- App ----------
export default function App() {
  // ----- persisted state -----
  const saved = useMemo(() => {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? safeJsonParse(raw) || {} : {};
  }, []);

  const [engineUrl, setEngineUrl] = useState(
    saved.engineUrl || import.meta?.env?.VITE_ENGINE_URL || DEFAULT_ENGINE
  );

  const [engineOk, setEngineOk] = useState(false);
  const [engineErr, setEngineErr] = useState("");
  const [engineLastOkAt, setEngineLastOkAt] = useState(saved.engineLastOkAt || 0);

  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(saved.projectId || "");
  const [file, setFile] = useState(null);

  const [summary, setSummary] = useState(null);
  const [actions, setActions] = useState([]);
  const [selectedActionKey, setSelectedActionKey] = useState(saved.selectedActionKey || "");

  const [busy, setBusy] = useState(false);
  const [busyActions, setBusyActions] = useState(false);
  const [msg, setMsg] = useState("");
  const [toast, setToast] = useState("");

  // Focus mode (CSS hooks already exist in your app.css)
  const [focusMode, setFocusMode] = useState(!!saved.focusMode);

  // Import knobs
  const [includeAssets, setIncludeAssets] = useState(!!saved.includeAssets);
  const [includeRisk, setIncludeRisk] = useState(saved.includeRisk !== false); // default true
  const [autoLoadOnProjectSelect, setAutoLoadOnProjectSelect] = useState(
    saved.autoLoadOnProjectSelect !== false
  );

  // Filters
  const [fHost, setFHost] = useState(saved.fHost || "");
  const [fMethod, setFMethod] = useState(saved.fMethod || "");
  const [fMime, setFMime] = useState(saved.fMime || "");
  const [q, setQ] = useState(saved.q || "");
  const qDebounced = useDebouncedValue(q, 160);

  // Extra filters (quality-of-life)
  const [onlyHasBody, setOnlyHasBody] = useState(!!saved.onlyHasBody);
  const [minCount, setMinCount] = useState(Number.isFinite(saved.minCount) ? saved.minCount : 0);
  const [minRisk, setMinRisk] = useState(Number.isFinite(saved.minRisk) ? saved.minRisk : 0);

  // Tag filters state
  const [tagFilterOpen, setTagFilterOpen] = useState(!!saved.tagFilterOpen);

  const [hideUncheckedTagsInPanel, setHideUncheckedTagsInPanel] = useState(
    saved.hideUncheckedTagsInPanel ?? true
  );

  const [excludedTags, setExcludedTags] = useState(() => {
    const raw = saved.excludedTags;
    if (Array.isArray(raw)) return raw.map(String);
    if (raw && typeof raw === "object") return Object.keys(raw).filter((k) => raw[k] === true);
    return [];
  });

  // Column visibility
  const defaultCols = {
    count: true,
    risk: true,
    method: true,
    host: true,
    path: true,
    mime: true,
    statuses: true,
    bytes: true,
    time: true,
    body: true,
  };
  const [cols, setCols] = useState({ ...defaultCols, ...(saved.cols || {}) });

  // Sorting: click headers (desc -> asc -> default)
  const [sortCol, setSortCol] = useState(saved.sortCol || ""); // "" means "default"
  const [sortDir, setSortDir] = useState(saved.sortDir || "desc"); // desc | asc

  const searchRef = useRef(null);
  const tableScrollRef = useRef(null);

  // ---------- Wizard / Project config gating ----------
  const [projectCfg, setProjectCfg] = useState(null);
  const [setupComplete, setSetupComplete] = useState(true); // pessimistic only after fetch
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardErr, setWizardErr] = useState("");
  const [wizardSaving, setWizardSaving] = useState(false);
  const [wizardDirty, setWizardDirty] = useState(false);

  const [wizAllowText, setWizAllowText] = useState("");
  const [wizDenyText, setWizDenyText] = useState("");
  const [wizQps, setWizQps] = useState("3");
  const [wizRoeText, setWizRoeText] = useState("{}");
  const [wizUseAdvanced, setWizUseAdvanced] = useState(true);

  function openWizardFromCfg(cfg, force = false) {
    if (!cfg?.project) return;
    if (!force && wizardOpen) return;
    const p = cfg.project;

    const allowLines =
      Array.isArray(p?.scope?.allow) ? p.scope.allow : Array.isArray(p?.scope_allow) ? p.scope_allow : [];
    const denyLines =
      Array.isArray(p?.scope?.deny) ? p.scope.deny : Array.isArray(p?.scope_deny) ? p.scope_deny : [];

    setWizAllowText(listToLines(allowLines));
    setWizDenyText(listToLines(denyLines));
    setWizQps(String(p?.qps ?? 3));
    setWizRoeText(String(p?.roe_json || safePrettyJson(p?.roe || {})));

    setWizardErr("");
    setWizardDirty(false);
    setWizardOpen(true);
  }

  // Persist UI state
  useEffect(() => {
    const payload = {
      engineUrl,
      engineLastOkAt,
      projectId,
      selectedActionKey,
      includeAssets,
      includeRisk,
      autoLoadOnProjectSelect,
      focusMode,
      fHost,
      fMethod,
      fMime,
      q,
      onlyHasBody,
      minCount,
      minRisk,
      sortCol,
      sortDir,
      cols,
      tagFilterOpen,
      hideUncheckedTagsInPanel,
      excludedTags,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  }, [
    engineUrl,
    engineLastOkAt,
    projectId,
    selectedActionKey,
    includeAssets,
    includeRisk,
    autoLoadOnProjectSelect,
    focusMode,
    fHost,
    fMethod,
    fMime,
    q,
    onlyHasBody,
    minCount,
    minRisk,
    sortCol,
    sortDir,
    cols,
    tagFilterOpen,
    hideUncheckedTagsInPanel,
    excludedTags,
  ]);

  // Toast auto-hide
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1400);
    return () => clearTimeout(t);
  }, [toast]);

  const selectedAction = useMemo(() => {
    return actions.find((a) => a.key === selectedActionKey) || null;
  }, [actions, selectedActionKey]);

  const hasRisk = useMemo(() => {
    return actions.some((a) => a && a.risk_score !== undefined && a.risk_score !== null);
  }, [actions]);

  // Build tag options from current actions (counts = how many actions contain that tag)
  const tagStats = useMemo(() => {
    const m = new Map();
    for (const a of actions) {
      const tags = Array.isArray(a?.risk_tags) ? a.risk_tags : [];
      for (const t of tags) {
        const key = String(t);
        m.set(key, (m.get(key) || 0) + 1);
      }
    }
    return m;
  }, [actions]);

  const tagOptions = useMemo(() => {
    const preferredOrder = [
      "out_of_scope",
      "third_party",
      "denylisted_host",
      "asset_like",
      "scope_unset",
      "authz_boundary",
      "writes",
      "destructive",
      "sensitive_path",
      "token_in_path",
      "id_in_path",
      "id_query",
      "redirect_param",
      "file_param",
      "query_injection_param",
      "5xx_seen",
      "slow",
      "large_resp",
      "very_large_resp",
      "api_like",
      "multi_signal",
      "high_frequency",
    ];

    const all = Array.from(tagStats.entries()).map(([tag, count]) => ({ tag, count }));
    const countMap = new Map(all.map((x) => [x.tag, x.count]));

    const ordered = [];
    for (const t of preferredOrder) {
      if (countMap.has(t)) ordered.push({ tag: t, count: countMap.get(t) });
    }

    const remaining = all
      .filter((x) => !preferredOrder.includes(x.tag))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

    return ordered.concat(remaining);
  }, [tagStats]);

  const excludedTagSet = useMemo(() => new Set((excludedTags || []).map(String)), [excludedTags]);

  function setShowTag(tag, show) {
    const t = String(tag);
    setExcludedTags((prev) => {
      const set = new Set((prev || []).map(String));
      if (show) set.delete(t);
      else set.add(t);
      return Array.from(set);
    });
  }

  function presetShowAllTags() {
    setExcludedTags([]);
    setToast("Tags: show all");
  }

  function presetHideNoiseTags() {
    const noise = ["out_of_scope", "third_party", "denylisted_host", "asset_like"];
    setExcludedTags(noise);
    setToast("Tags: hide noise");
  }

  // Tag filter panel (with "Hide unchecked tags" toggle)
const tagFilterPanel =
  setupComplete && tagFilterOpen ? (
    <div className="ph-card ph-tagPanel">
      <div className="ph-row" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="ph-small" style={{ fontWeight: 900, opacity: 0.85 }}>
          Tag filters
        </span>
        <span className="ph-small" style={{ opacity: 0.75 }}>
          Uncheck to hide actions that contain that tag.
        </span>

        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          <button className="ph-btn" onClick={presetShowAllTags} disabled={!actions.length}>
            Show all
          </button>
          <button className="ph-btn" onClick={presetHideNoiseTags} disabled={!actions.length}>
            Hide noise
          </button>

          <button
            className={`ph-btn ${hideUncheckedTagsInPanel ? "ph-btn-active" : ""}`}
            onClick={() => setHideUncheckedTagsInPanel((v) => !v)}
            disabled={!actions.length}
            title="Hide unchecked tags from this list (action filtering stays the same)"
          >
            {hideUncheckedTagsInPanel ? "Hide unchecked: ON" : "Hide unchecked: OFF"}
          </button>
        </span>
      </div>

      {!tagOptions.length ? (
        <div className="ph-small" style={{ opacity: 0.8, marginTop: 8 }}>
          No risk tags available yet. Load actions with <strong>include risk</strong>.
        </div>
      ) : (
        <div className="ph-row" style={{ marginTop: 8, alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          {(hideUncheckedTagsInPanel ? tagOptions.filter(({ tag }) => !excludedTagSet.has(tag)) : tagOptions)
            .slice(0, 80)
            .map(({ tag, count }) => {
              const show = !excludedTagSet.has(tag);
              return (
                <label
                  key={tag}
                  className={`ph-tagOpt ${show ? "" : "is-off"}`}
                  title={`Actions with tag: ${count}`}
                >
                  <input
                    type="checkbox"
                    checked={show}
                    onChange={(e) => setShowTag(tag, e.target.checked)}
                  />
                  <span className="ph-mono">{tag}</span>
                  <span style={{ opacity: 0.65 }}>({count})</span>
                </label>
              );
            })}
        </div>
      )}
    </div>
  ) : null;


  // Default ordering ("normal"):
  const defaultSort = useMemo(() => {
    return hasRisk ? { col: "risk", dir: "desc" } : { col: "count", dir: "desc" };
  }, [hasRisk]);

  function toggleSort(col) {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir("desc");
      return;
    }
    if (sortDir === "desc") {
      setSortDir("asc");
      return;
    }
    setSortCol("");
    setSortDir("desc");
  }

  function sortMark(col) {
    const activeCol = sortCol || defaultSort.col;
    const activeDir = sortCol ? sortDir : defaultSort.dir;
    if (activeCol !== col) return "";
    return activeDir === "desc" ? " ▼" : " ▲";
  }

  function activeSortExplain() {
    const activeCol = sortCol || defaultSort.col;
    const activeDir = sortCol ? sortDir : defaultSort.dir;
    const dir = activeDir === "desc" ? "desc" : "asc";
    return `Sorting: ${activeCol} ${dir}${sortCol ? "" : " (normal)"}`;
  }

  const hostOptions = useMemo(() => {
    const s = new Set(actions.map((a) => a.host).filter(Boolean));
    return Array.from(s).sort();
  }, [actions]);

  const methodOptions = useMemo(() => {
    const s = new Set(actions.map((a) => a.method).filter(Boolean));
    return Array.from(s).sort();
  }, [actions]);

  const mimeOptions = useMemo(() => {
    const s = new Set(actions.map((a) => a.top_mime).filter(Boolean));
    return Array.from(s).sort();
  }, [actions]);

  const filteredActions = useMemo(() => {
    const qq = qDebounced.trim().toLowerCase();

    let list = actions
      .filter((a) => {
        if (!excludedTagSet.size) return true;
        const tags = Array.isArray(a?.risk_tags) ? a.risk_tags : [];
        for (const t of tags) {
          if (excludedTagSet.has(String(t))) return false;
        }
        return true;
      })
      .filter((a) => (fHost ? a.host === fHost : true))
      .filter((a) => (fMethod ? a.method === fMethod : true))
      .filter((a) => (fMime ? a.top_mime === fMime : true))
      .filter((a) => (onlyHasBody ? !!a.has_body : true))
      .filter((a) => (minCount > 0 ? Number(a.count || 0) >= minCount : true))
      .filter((a) => (minRisk > 0 ? Number(a.risk_score || 0) >= minRisk : true))
      .filter((a) => {
        if (!qq) return true;
        return (
          (a.host || "").toLowerCase().includes(qq) ||
          (a.path_template || "").toLowerCase().includes(qq) ||
          (a.method || "").toLowerCase().includes(qq) ||
          (a.top_mime || "").toLowerCase().includes(qq) ||
          (a.key || "").toLowerCase().includes(qq) ||
          (Array.isArray(a.risk_tags) ? a.risk_tags.join(" ").toLowerCase().includes(qq) : false)
        );
      });

    const activeCol = sortCol || defaultSort.col;
    const activeDir = sortCol ? sortDir : defaultSort.dir;
    const dirMul = activeDir === "desc" ? 1 : -1;

    const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
    const str = (x) => String(x || "").toLowerCase();

    const getVal = (a) => {
      switch (activeCol) {
        case "risk":
          return num(a.risk_score);
        case "count":
          return num(a.count);
        case "time":
          return num(a.avg_time_ms);
        case "bytes":
          return num(a.avg_resp_bytes);
        case "body":
          return a.has_body ? 1 : 0;
        case "method":
          return str(a.method);
        case "host":
          return str(a.host);
        case "path":
          return str(a.path_template);
        case "mime":
          return str(a.top_mime);
        default:
          return num(a.count);
      }
    };

    const cmp = (A, B) => {
      const va = getVal(A);
      const vb = getVal(B);

      if (typeof va === "number" && typeof vb === "number") {
        const d = (vb - va) * dirMul;
        if (d !== 0) return d;

        const t1 = num(B.count) - num(A.count);
        if (t1 !== 0) return t1;
        return num(B.avg_time_ms) - num(A.avg_time_ms);
      }

      const d = String(vb).localeCompare(String(va)) * dirMul;
      if (d !== 0) return d;

      const t1 = num(B.count) - num(A.count);
      if (t1 !== 0) return t1;
      return num(B.avg_time_ms) - num(A.avg_time_ms);
    };

    list = list.slice().sort(cmp);
    return list.slice(0, 800);
  }, [
    actions,
    excludedTagSet,
    fHost,
    fMethod,
    fMime,
    qDebounced,
    sortCol,
    sortDir,
    defaultSort,
    onlyHasBody,
    minCount,
    minRisk,
  ]);

  // ---------- keyboard navigation ----------
  const [navIntent, setNavIntent] = useState("");
  useEffect(() => {
    if (!navIntent) return;
    setNavIntent("");
  }, [navIntent]);

  useEffect(() => {
    if (!navIntent) return;
    if (!filteredActions.length) return;

    const idx = filteredActions.findIndex((a) => a.key === selectedActionKey);
    const cur = idx >= 0 ? idx : 0;

    let next = cur;
    if (navIntent === "ArrowDown") next = Math.min(filteredActions.length - 1, cur + 1);
    if (navIntent === "ArrowUp") next = Math.max(0, cur - 1);

    const k = filteredActions[next]?.key || "";
    if (k) setSelectedActionKey(k);

    requestAnimationFrame(() => {
      const row = document.querySelector(`tr[data-rowkey="${CSS.escape(k)}"]`);
      row?.scrollIntoView({ block: "nearest" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navIntent, filteredActions]);

  // If filters change and selected row disappears, pick first visible row.
  useEffect(() => {
    if (!actions.length) return;
    if (!selectedActionKey) {
      setSelectedActionKey(filteredActions[0]?.key || "");
      return;
    }
    const stillVisible = filteredActions.some((a) => a.key === selectedActionKey);
    if (!stillVisible) setSelectedActionKey(filteredActions[0]?.key || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fHost,
    fMethod,
    fMime,
    qDebounced,
    actions.length,
    sortCol,
    sortDir,
    defaultSort,
    onlyHasBody,
    minCount,
    minRisk,
    excludedTagSet,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    function getSelected() {
      return actions.find((a) => a.key === selectedActionKey) || null;
    }

    function onKeyDown(e) {
      if (wizardOpen) return;

      const tag = (e.target?.tagName || "").toLowerCase();
      const isTyping =
        tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable;

      const k = e.key || "";
      const metaOrCtrl = (isMac() ? e.metaKey : e.ctrlKey) || false;

      if ((metaOrCtrl && k.toLowerCase() === "k") || (!isTyping && k === "/")) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (!isTyping && k.toLowerCase() === "f") {
        e.preventDefault();
        setFocusMode((v) => !v);
        setToast("Focus");
        return;
      }

      if (!isTyping && k.toLowerCase() === "e") {
        e.preventDefault();
        const payload = JSON.stringify(filteredActions, null, 2);
        const ok = downloadTextFile(`pwnyhub_actions_filtered_${Date.now()}.json`, payload);
        setToast(ok ? "Exported" : "Export failed");
        return;
      }

      if (isTyping) return;

      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        setNavIntent(k);
        return;
      }

      if (k === "Enter") {
        e.preventDefault();
        const el = document.getElementById("ph-details");
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      if (k.toLowerCase() === "c") {
        e.preventDefault();
        const a = getSelected();
        if (a?.key) copyToClipboard(a.key).then((ok) => setToast(ok ? "Copied key" : "Copy failed"));
        return;
      }

      if (k.toLowerCase() === "u") {
        e.preventDefault();
        const a = getSelected();
        const u = a?.sample_urls?.[0] || "";
        if (u) copyToClipboard(u).then((ok) => setToast(ok ? "Copied URL" : "Copy failed"));
        return;
      }

      if (k.toLowerCase() === "o") {
        e.preventDefault();
        const a = getSelected();
        const u = a?.sample_urls?.[0] || "";
        if (u) window.open(u, "_blank", "noopener,noreferrer");
        return;
      }

      if (k === "Escape") setSelectedActionKey("");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedActionKey, actions, filteredActions, wizardOpen]);

  // --- engine health poll ---
  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const data = await jfetch(`${engineUrl}/health`);
        if (!cancelled) {
          const ok = !!data?.ok;
          setEngineOk(ok);
          setEngineErr("");
          if (ok) setEngineLastOkAt(Date.now());
        }
      } catch (e) {
        if (!cancelled) {
          setEngineOk(false);
          setEngineErr(String(e?.message || e));
        }
      }
    }

    tick();
    const t = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [engineUrl]);

  // --- load projects when engine is OK ---
  useEffect(() => {
    if (!engineOk) return;
    (async () => {
      try {
        const data = await jfetch(`${engineUrl}/projects`);
        const list = Array.isArray(data) ? data : [];
        setProjects(list);
        if (!projectId && list.length > 0) setProjectId(String(list[0].id));
      } catch (e) {
        setMsg(`Failed to load projects: ${String(e?.message || e)}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineOk]);

  // --- fetch selected project config + auto-open wizard if not setup_complete ---
  useEffect(() => {
    if (!engineOk || !projectId) {
      setProjectCfg(null);
      setSetupComplete(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const cfg = await jfetch(`${engineUrl}/projects/${encodeURIComponent(projectId)}`);
        if (cancelled) return;

        setProjectCfg(cfg);
        const sc = !!cfg?.project?.setup_complete;
        setSetupComplete(sc);

        if (!sc) openWizardFromCfg(cfg, true);
      } catch (e) {
        if (cancelled) return;
        setProjectCfg(null);
        setSetupComplete(false);
        setWizardErr(`Failed to load project config: ${String(e?.message || e)}`);
        setWizardOpen(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineOk, projectId]);

  async function refreshSummary(pid) {
    const p = pid || projectId;
    if (!p) return;
    const data = await jfetch(`${engineUrl}/summary?project_id=${encodeURIComponent(p)}`);
    setSummary(data);
  }

  async function loadActions(pid) {
    const p = pid || projectId;
    if (!p) return;

    if (!setupComplete) {
      setMsg("Finish Setup (scope/ROE) first.");
      setToast("Setup required");
      setWizardOpen(true);
      return;
    }

    setBusyActions(true);
    try {
      const url = `${engineUrl}/actions?project_id=${encodeURIComponent(
        p
      )}&include_risk=${includeRisk ? "true" : "false"}`;
      const data = await jfetch(url);
      const list = Array.isArray(data?.actions) ? data.actions : [];
      setActions(list);
      setSelectedActionKey((prev) => prev || list[0]?.key || "");
      setMsg(`Loaded ${list.length} actions.`);
      setSortCol("");
      setSortDir("desc");
    } catch (e) {
      setMsg(`Failed to load actions: ${String(e?.message || e)}`);
    } finally {
      setBusyActions(false);
    }
  }

  async function createDemoProject() {
    setBusy(true);
    try {
      const body = {
        name: "demo",
        scope_allow: ["example.com", "localhost"],
        scope_deny: [],
        qps: 3.0,
      };

      const created = await jfetch(`${engineUrl}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const newList = await jfetch(`${engineUrl}/projects`);
      setProjects(newList);

      const pid = String(created?.id || created?.project?.id || newList?.[0]?.id || "");
      setProjectId(pid);
      setMsg("Created demo project.");

      if (pid && autoLoadOnProjectSelect) {
        await refreshSummary(pid);
        await loadActions(pid);
      }
    } catch (e) {
      setMsg(`Create demo project failed: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importHar() {
    if (!projectId) return setMsg("Pick a project first.");
    if (!setupComplete) {
      setMsg("Finish Setup (scope/ROE) first.");
      setToast("Setup required");
      setWizardOpen(true);
      return;
    }
    if (!file) return setMsg("Choose a HAR file first.");

    setBusy(true);
    try {
      const tryUpload = async (fieldName) => {
        const fd = new FormData();
        fd.append("project_id", projectId);
        fd.append(fieldName, file);
        fd.append("include_assets", includeAssets ? "true" : "false");
        return jfetch(`${engineUrl}/import/har`, { method: "POST", body: fd });
      };

      try {
        await tryUpload("har");
      } catch (e) {
        const m = String(e?.message || e);
        if (m.includes("422") || m.toLowerCase().includes("field required")) {
          await tryUpload("file");
        } else {
          throw e;
        }
      }

      setMsg("Imported HAR. Refreshing summary + actions...");
      await refreshSummary(projectId);
      await loadActions(projectId);
      setToast("Imported");
    } catch (e) {
      setMsg(`Import failed: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Auto-load on project change (optional)
  useEffect(() => {
    if (!engineOk) return;
    if (!projectId) return;
    if (!autoLoadOnProjectSelect) return;
    if (!setupComplete) return;

    (async () => {
      try {
        setSummary(null);
        setActions([]);
        setSelectedActionKey("");
        await refreshSummary(projectId);
        await loadActions(projectId);
      } catch (e) {
        setMsg(String(e?.message || e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, autoLoadOnProjectSelect, includeRisk, engineOk, setupComplete]);

  function resetUi() {
    setFHost("");
    setFMethod("");
    setFMime("");
    setQ("");
    setOnlyHasBody(false);
    setMinCount(0);
    setMinRisk(0);
    setSortCol("");
    setSortDir("desc");
    setCols(defaultCols);
    setExcludedTags([]);
    setHideUncheckedTagsInPanel(true);
    setToast("UI reset");
  }

  function toggleCol(k) {
    setCols((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  const summaryHosts = useMemo(() => normalizeTopList(summary?.hosts), [summary]);
  const summaryMimes = useMemo(() => normalizeTopList(summary?.mimes), [summary]);

  const scopeBadges = useMemo(() => {
    const tags = selectedAction?.risk_tags || [];
    const out = [];
    if (tags.includes("scope_unset")) out.push({ t: "scope_unset", bg: "#1f2230", fg: "#cfd7ff" });
    if (tags.includes("out_of_scope")) out.push({ t: "out_of_scope", bg: "#3b1f1f", fg: "#ffd2d2" });
    if (tags.includes("third_party")) out.push({ t: "third_party", bg: "#2f2a17", fg: "#ffe9a8" });
    if (tags.includes("denylisted_host")) out.push({ t: "denylisted", bg: "#2a0f2a", fg: "#ffd0ff" });
    if (tags.includes("asset_like")) out.push({ t: "asset_like", bg: "#1b2b33", fg: "#bfeaff" });
    if (tags.includes("authz_boundary")) out.push({ t: "authz_boundary", bg: "#1f2c1f", fg: "#c9ffd0" });
    if (tags.includes("token_in_path")) out.push({ t: "token_in_path", bg: "#2b1f33", fg: "#e8c7ff" });
    if (tags.includes("id_in_path")) out.push({ t: "id_in_path", bg: "#1f2230", fg: "#cfd7ff" });
    return out;
  }, [selectedAction]);

  const engineAgo = useMemo(() => {
    if (!engineLastOkAt) return "";
    const d = Math.max(0, Date.now() - engineLastOkAt);
    if (d < 1000 * 10) return "just now";
    if (d < 1000 * 60) return `${Math.round(d / 1000)}s ago`;
    return `${Math.round(d / 60000)}m ago`;
  }, [engineLastOkAt, engineOk]);

  const keyHint = useMemo(() => {
    const mod = isMac() ? "⌘" : "Ctrl";
    return `${mod}+K or / = search · ↑/↓ select · Enter details · c copy key · u copy url · o open url · f focus · e export`;
  }, []);

  function exportActions(list, label = "actions") {
    const payload = JSON.stringify(list || [], null, 2);
    const ok = downloadTextFile(`pwnyhub_${label}_${Date.now()}.json`, payload);
    setToast(ok ? "Exported" : "Export failed");
  }

  async function copyJson(obj, label = "Copied") {
    const payload = JSON.stringify(obj, null, 2);
    const ok = await copyToClipboard(payload);
    setToast(ok ? label : "Copy failed");
  }

  async function wizardLoadDefaultRoe() {
    setWizardErr("");
    const qpsNum = Number(wizQps || 3);
    const qpsSafe = Number.isFinite(qpsNum) && qpsNum > 0 ? qpsNum : 3;
    try {
      const data = await jfetch(`${engineUrl}/roe/default?qps=${encodeURIComponent(String(qpsSafe))}`);
      const roe = data?.roe ?? data ?? {};
      setWizRoeText(safePrettyJson(roe));
      setWizardDirty(true);
      setToast("Loaded defaults");
    } catch (e) {
      setWizardErr(`Failed to load defaults: ${String(e?.message || e)}`);
    }
  }

  async function wizardSave() {
    setWizardErr("");
    if (!projectId) {
      setWizardErr("No project selected.");
      return;
    }

    const allowList = parseLinesToList(wizAllowText);
    const denyList = parseLinesToList(wizDenyText);

    if (!allowList.length) {
      setWizardErr("Scope allowlist is required (at least 1 host / domain).");
      return;
    }

    const qpsNum = Number(wizQps || 3);
    if (!Number.isFinite(qpsNum) || qpsNum <= 0) {
      setWizardErr("QPS must be a positive number.");
      return;
    }

    let roeObj = null;
    try {
      roeObj = safeJsonParse(wizRoeText);
      if (roeObj === null) throw new Error("Invalid JSON");
    } catch {
      setWizardErr("ROE JSON is invalid. Fix it or click “Load defaults”.");
      return;
    }

    setWizardSaving(true);
    try {
      const payload = {
        scope_allow: allowList,
        scope_deny: denyList,
        qps: qpsNum,
        roe: roeObj,
      };

      const data = await jfetch(`${engineUrl}/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setProjectCfg(data);
      const sc = !!data?.project?.setup_complete;
      setSetupComplete(sc);

      try {
        const plist = await jfetch(`${engineUrl}/projects`);
        setProjects(Array.isArray(plist) ? plist : []);
      } catch {
        // ignore
      }

      setWizardOpen(false);
      setWizardDirty(false);
      setToast("Setup saved");

      if (autoLoadOnProjectSelect) {
        await refreshSummary(projectId);
        await loadActions(projectId);
      }
    } catch (e) {
      setWizardErr(`Save failed: ${String(e?.message || e)}`);
    } finally {
      setWizardSaving(false);
    }
  }

  const wizardCanClose = useMemo(() => {
    return !!setupComplete;
  }, [setupComplete]);

  const wizardOverlay = wizardOpen ? (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 9999,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: 18,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && wizardCanClose) setWizardOpen(false);
      }}
    >
      <div
        className="ph-card"
        style={{
          width: "min(980px, 96vw)",
          marginTop: 22,
          boxShadow: "0 16px 60px rgba(0,0,0,0.35)",
          padding: 14,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ph-h2" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          Setup Wizard
          {!setupComplete ? <span style={pillStyle("#2a2020", "#ffd2d2")}>Required</span> : null}
          <span style={{ marginLeft: "auto", opacity: 0.75 }} className="ph-small">
            Project: {projectCfg?.project?.name || `id=${projectId || "?"}`}
          </span>
        </div>

        <div className="ph-small" style={{ opacity: 0.85, marginBottom: 10 }}>
          Set <strong>scope</strong> and <strong>ROE</strong> first.
        </div>

        {wizardErr ? (
          <div className="ph-err" style={{ marginBottom: 10 }}>
            <div style={{ whiteSpace: "pre-wrap" }}>{wizardErr}</div>
          </div>
        ) : null}

        <div className="ph-row" style={{ gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 420px", minWidth: 320 }}>
            <div className="ph-h2" style={{ marginTop: 10 }}>
              Scope allowlist (required)
            </div>
            <div className="ph-small" style={{ opacity: 0.8, marginBottom: 6 }}>
              One per line. Examples: <span className="ph-mono">example.com</span>,{" "}
              <span className="ph-mono">*.example.com</span>
            </div>
            <textarea
              className="ph-input"
              style={{ width: "100%", minHeight: 140, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              value={wizAllowText}
              onChange={(e) => {
                setWizAllowText(e.target.value);
                setWizardDirty(true);
              }}
              placeholder={"example.com\napi.example.com\n*.dev.example.com"}
            />

            <div className="ph-h2" style={{ marginTop: 12 }}>
              Scope denylist (optional)
            </div>
            <div className="ph-small" style={{ opacity: 0.8, marginBottom: 6 }}>
              Deny always wins. One per line.
            </div>
            <textarea
              className="ph-input"
              style={{ width: "100%", minHeight: 90, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              value={wizDenyText}
              onChange={(e) => {
                setWizDenyText(e.target.value);
                setWizardDirty(true);
              }}
              placeholder={"cdn.example.com\n*.doubleclick.net"}
            />

            <div className="ph-row" style={{ marginTop: 12, alignItems: "center" }}>
              <span className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                QPS (global):
                <input
                  className="ph-input"
                  style={{ width: 120 }}
                  value={wizQps}
                  onChange={(e) => {
                    setWizQps(e.target.value);
                    setWizardDirty(true);
                  }}
                  inputMode="decimal"
                />
              </span>

              <button className="ph-btn" onClick={wizardLoadDefaultRoe} disabled={!engineOk || wizardSaving}>
                Load ROE defaults
              </button>

              <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={wizUseAdvanced}
                  onChange={(e) => {
                    setWizUseAdvanced(e.target.checked);
                    setWizardDirty(true);
                  }}
                />
                Advanced ROE JSON
              </label>
            </div>
          </div>

          <div style={{ flex: "1 1 420px", minWidth: 320 }}>
            <div className="ph-h2" style={{ marginTop: 10 }}>
              ROE (Rules of Engagement)
            </div>

            {wizUseAdvanced ? (
              <textarea
                className="ph-input"
                style={{ width: "100%", minHeight: 320, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                value={wizRoeText}
                onChange={(e) => {
                  setWizRoeText(e.target.value);
                  setWizardDirty(true);
                }}
                placeholder={'{\n  "version": 1,\n  "network": { "qps": 3 }\n}'}
              />
            ) : (
              <div className="ph-small" style={{ opacity: 0.85 }}>
                Turn on “Advanced ROE JSON” to edit directly.
              </div>
            )}

            <div className="ph-row" style={{ marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="ph-btn" onClick={wizardSave} disabled={!engineOk || wizardSaving}>
                {wizardSaving ? "Saving…" : "Finish setup"}
              </button>

              <button
                className="ph-btn"
                onClick={() => setWizardOpen(false)}
                disabled={!wizardCanClose || wizardSaving}
                title={!wizardCanClose ? "Setup is required before continuing" : "Close"}
              >
                Close
              </button>

              <button
                className="ph-btn"
                onClick={() => {
                  const allow = parseLinesToList(wizAllowText);
                  const deny = parseLinesToList(wizDenyText);
                  setToast(`allow:${allow.length} deny:${deny.length}`);
                }}
                disabled={wizardSaving}
                title="Quick sanity check"
              >
                Validate
              </button>

              {wizardDirty ? <span className="ph-small" style={{ opacity: 0.75 }}>Unsaved changes</span> : null}
            </div>
          </div>
        </div>

        <div className="ph-small" style={{ marginTop: 12, opacity: 0.75 }}>
          Tip: You can reopen this anytime via <strong>Settings</strong>.
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className={`ph-wrap${focusMode ? " focus" : ""}`}>
      {wizardOverlay}

      <h1 style={{ marginBottom: 6, display: "flex", alignItems: "baseline", gap: 12 }}>
        PwnyHub {toast ? <span style={pillStyle("#1d2b1d", "#c9ffd0")}>{toast}</span> : null}
      </h1>

      <div className="ph-sub">
        Standalone hub (Electron UI) + engine (FastAPI). MVP: HAR import → normalize → summarize → actions.
      </div>

      <div className="ph-card">
        {/* Top controls */}
        <div className="ph-topbar">
          <div className="ph-row" style={{ alignItems: "center" }}>
            <span className="ph-pill" title={engineOk ? `Last OK: ${engineAgo}` : "Engine down"}>
              <strong>Engine:</strong>{" "}
              <span className={engineOk ? "ok" : "down"}>{engineOk ? "OK" : "Down"}</span>{" "}
              {engineOk && engineAgo ? <span style={{ opacity: 0.7, marginLeft: 8 }}>{engineAgo}</span> : null}
            </span>

            <span className="ph-small">
              URL:{" "}
              <input className="ph-input" value={engineUrl} onChange={(e) => setEngineUrl(e.target.value)} style={{ width: 280 }} />
            </span>

            <button className="ph-btn" onClick={createDemoProject} disabled={!engineOk || busy}>
              Create demo project
            </button>

            <select
              className="ph-select"
              value={projectId}
              onChange={(e) => {
                const pid = e.target.value;
                setProjectId(pid);
                setSummary(null);
                setActions([]);
                setSelectedActionKey("");
                setMsg("");
              }}
              disabled={!engineOk}
              title="Select project"
            >
              <option value="">Select project…</option>
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name} (id={p.id}){p.setup_complete === false ? " • setup" : ""}
                </option>
              ))}
            </select>

            <button
              className="ph-btn"
              onClick={() => {
                if (!projectId) return setToast("Pick project");
                if (projectCfg?.project) openWizardFromCfg(projectCfg, true);
                else setWizardOpen(true);
              }}
              disabled={!engineOk || !projectId}
              title="Edit scope/ROE/QPS"
            >
              Settings
            </button>

            <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={autoLoadOnProjectSelect}
                onChange={(e) => setAutoLoadOnProjectSelect(e.target.checked)}
                disabled={!setupComplete}
                title={!setupComplete ? "Complete setup first" : ""}
              />
              Auto-load
            </label>

            <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={focusMode} onChange={(e) => setFocusMode(e.target.checked)} />
              Focus mode
            </label>

            <input
              className="ph-input"
              type="file"
              accept=".har,application/json"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              disabled={!engineOk || !setupComplete}
              title={!setupComplete ? "Complete setup first" : ""}
            />

            <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={includeAssets}
                onChange={(e) => setIncludeAssets(e.target.checked)}
                disabled={!setupComplete}
                title={!setupComplete ? "Complete setup first" : ""}
              />
              include assets
            </label>

            <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={includeRisk}
                onChange={(e) => setIncludeRisk(e.target.checked)}
                disabled={!setupComplete}
                title={!setupComplete ? "Complete setup first" : ""}
              />
              include risk
            </label>

            <button
              className="ph-btn"
              onClick={importHar}
              disabled={!engineOk || busy || !projectId || !file || !setupComplete}
              title={!setupComplete ? "Complete setup first" : "Import HAR into selected project"}
            >
              {busy ? "Working…" : "Import HAR"}
            </button>

            <button className="ph-btn" onClick={() => refreshSummary()} disabled={!engineOk || !projectId || busy} title="Refresh summary">
              Refresh summary
            </button>

            <button
              className="ph-btn"
              onClick={() => loadActions()}
              disabled={!engineOk || !projectId || busyActions || !setupComplete}
              title={!setupComplete ? "Complete setup first" : "Load actions"}
            >
              {busyActions ? "Loading…" : "Load actions"}
            </button>

            {!setupComplete && projectId ? (
              <span style={{ marginLeft: 10, ...pillStyle("#2a2020", "#ffd2d2") }}>Setup required</span>
            ) : null}
          </div>
        </div>

        {/* Errors / messages */}
        {!engineOk && engineErr ? (
          <div className="ph-err">
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Engine error</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{engineErr}</div>
          </div>
        ) : null}

        {msg ? <div className="ph-msg">{msg}</div> : null}

        <div className="ph-content">
          {/* Summary */}
          {summary ? (
            <div style={{ marginBottom: 16 }}>
              <div className="ph-h2" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                Summary
                <span style={pillStyle("#1c2430", "#cfe0ff")}>entries: {summary.entries ?? summary.entries_stored ?? "?"}</span>
              </div>

              {summaryHosts?.length ? (
                <>
                  <div className="ph-h2" style={{ marginTop: 14 }}>Top hosts</div>
                  <ul className="ph-list">
                    {summaryHosts.slice(0, 20).map(([k, v]) => (
                      <li key={k}><span className="ph-mono">{k}</span> — {v}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              {summaryMimes?.length ? (
                <>
                  <div className="ph-h2" style={{ marginTop: 14 }}>Top MIME types</div>
                  <ul className="ph-list">
                    {summaryMimes.slice(0, 20).map(([k, v]) => (
                      <li key={k}><span className="ph-mono">{k}</span> — {v}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}

          {/* Actions */}
          <div>
            <div className="ph-h2" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              Actions
              <span style={pillStyle("#1c2430", "#cfe0ff")}>showing {filteredActions.length} / {actions.length}</span>
              <span className="ph-small" style={{ opacity: 0.75 }}>{activeSortExplain()}</span>

              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                <button className="ph-btn" onClick={() => exportActions(actions, "actions_all")} disabled={!actions.length}>
                  Export all
                </button>
                <button className="ph-btn" onClick={() => exportActions(filteredActions, "actions_filtered")} disabled={!filteredActions.length}>
                  Export filtered
                </button>
                <button className="ph-btn" onClick={() => copyJson(filteredActions, "Copied filtered")} disabled={!filteredActions.length}>
                  Copy filtered JSON
                </button>
                <button className="ph-btn" onClick={() => (selectedAction ? copyJson(selectedAction, "Copied action") : setToast("No action"))} disabled={!selectedAction}>
                  Copy action JSON
                </button>
              </span>
            </div>

            {/* Filters */}
            <div className="ph-row" style={{ marginBottom: 10, alignItems: "center" }}>
              <select className="ph-select" value={fHost} onChange={(e) => setFHost(e.target.value)}>
                <option value="">All hosts</option>
                {hostOptions.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>

              <select className="ph-select" value={fMethod} onChange={(e) => setFMethod(e.target.value)}>
                <option value="">All methods</option>
                {methodOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>

              <select className="ph-select" value={fMime} onChange={(e) => setFMime(e.target.value)}>
                <option value="">All MIME</option>
                {mimeOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>

              <input
                ref={searchRef}
                className="ph-input"
                placeholder="Search host/path/mime/tags… (Ctrl/Cmd+K or /)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ width: 360 }}
                title={keyHint}
                disabled={!setupComplete}
              />

              <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={onlyHasBody} onChange={(e) => setOnlyHasBody(e.target.checked)} disabled={!setupComplete} />
                has body
              </label>

              <span className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                min count:
                <input
                  className="ph-input"
                  style={{ width: 88 }}
                  value={String(minCount)}
                  onChange={(e) => setMinCount(Math.max(0, parseInt(e.target.value || "0", 10) || 0))}
                  inputMode="numeric"
                  disabled={!setupComplete}
                />
              </span>

              {hasRisk ? (
                <span className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  min risk:
                  <input
                    className="ph-input"
                    style={{ width: 88 }}
                    value={String(minRisk)}
                    onChange={(e) => setMinRisk(Math.max(0, parseInt(e.target.value || "0", 10) || 0))}
                    inputMode="numeric"
                    disabled={!setupComplete}
                  />
                </span>
              ) : null}

              <button className="ph-btn" onClick={resetUi} disabled={!setupComplete}>Reset UI</button>

              <button
                className={`ph-btn ${excludedTagSet.size ? "ph-btn-active" : ""}`}
                onClick={() => setTagFilterOpen((v) => !v)}
                disabled={!setupComplete}
              >
                Tag filters{excludedTagSet.size ? ` (${excludedTagSet.size} hidden)` : ""}
              </button>

              <div className="ph-small" style={{ marginLeft: "auto", opacity: 0.75 }}>{keyHint}</div>
            </div>

            {tagFilterPanel}

            {/* Column toggles */}
            <div className="ph-row" style={{ marginBottom: 10, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span className="ph-small" style={{ fontWeight: 800, opacity: 0.75 }}>Columns:</span>

              {Object.keys(defaultCols).map((k) => {
                if (k === "risk" && !hasRisk) return null;
                return (
                  <label key={k} className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={!!cols[k]} onChange={() => toggleCol(k)} disabled={!setupComplete} />
                    {k}
                  </label>
                );
              })}

              {hasRisk ? (
                <span className="ph-small" style={{ marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <span style={{ opacity: 0.75, fontWeight: 800 }}>Risk legend:</span>
                  <span style={riskStyle(0)}>0</span>
                  <span style={riskStyle(35)}>35</span>
                  <span style={riskStyle(70)}>70</span>
                  <span style={riskStyle(100)}>100</span>
                </span>
              ) : null}
            </div>

            <div className="ph-small" style={{ marginBottom: 10, opacity: 0.8 }}>
              Sort tip: click a column header to sort (desc → asc → normal). Normal = {hasRisk ? "risk desc" : "count desc"}.
            </div>

            {!setupComplete ? (
              <div className="ph-small">Setup is required before actions view is enabled. Click <strong>Settings</strong>.</div>
            ) : actions.length === 0 ? (
              <div className="ph-small">No actions loaded yet. Import a HAR or click “Load actions”.</div>
            ) : (
              <div className="ph-grid">
                {/* Table */}
                <div className="ph-tableWrap">
                  <div className="ph-tableScroll" ref={tableScrollRef}>
                    <table className="ph-table">
                      <thead>
                        <tr>
                          {cols.count ? <th style={{ cursor: "pointer" }} onClick={() => toggleSort("count")}>Count{sortMark("count")}</th> : null}
                          {hasRisk && cols.risk ? <th style={{ cursor: "pointer" }} onClick={() => toggleSort("risk")}>Risk{sortMark("risk")}</th> : null}
                          {cols.method ? <th style={{ cursor: "pointer" }} onClick={() => toggleSort("method")}>Method{sortMark("method")}</th> : null}
                          {cols.host ? <th style={{ cursor: "pointer" }} onClick={() => toggleSort("host")}>Host{sortMark("host")}</th> : null}
                          {cols.path ? <th style={{ cursor: "pointer" }} onClick={() => toggleSort("path")}>Path template{sortMark("path")}</th> : null}
                          {cols.mime ? <th style={{ cursor: "pointer" }} onClick={() => toggleSort("mime")}>Top MIME{sortMark("mime")}</th> : null}
                          {cols.statuses ? <th>Statuses</th> : null}
                          {cols.bytes ? <th style={{ cursor: "pointer" }} onClick={() => toggleSort("bytes")}>Avg bytes{sortMark("bytes")}</th> : null}
                          {cols.time ? <th style={{ cursor: "pointer" }} onClick={() => toggleSort("time")}>Avg ms{sortMark("time")}</th> : null}
                          {cols.body ? <th style={{ cursor: "pointer" }} onClick={() => toggleSort("body")}>Body?{sortMark("body")}</th> : null}
                        </tr>
                      </thead>

                      <tbody>
                        {filteredActions.map((a) => {
                          const isSel = a.key === selectedActionKey;
                          const tags = Array.isArray(a.risk_tags) ? a.risk_tags : [];
                          const miniTag = tags.includes("scope_unset")
                            ? "scope_unset"
                            : tags.includes("out_of_scope")
                              ? "out_of_scope"
                              : tags.includes("third_party")
                                ? "third_party"
                                : tags.includes("denylisted_host")
                                  ? "denylisted"
                                  : "";

                          return (
                            <tr
                              key={a.key}
                              data-rowkey={a.key}
                              onClick={() => setSelectedActionKey(a.key)}
                              className={`ph-tr ${isSel ? "selected" : ""}`}
                              title={tags?.length ? `tags: ${tags.join(", ")}` : ""}
                            >
                              {cols.count ? <td>{a.count}</td> : null}

                              {hasRisk && cols.risk ? (
                                <td>
                                  <span style={riskStyle(a.risk_score)}>{fmtInt(a.risk_score)}</span>
                                  {miniTag ? <span style={{ marginLeft: 8, ...pillStyle("#2a2020", "#ffd2d2") }}>{miniTag}</span> : null}
                                </td>
                              ) : null}

                              {cols.method ? <td>{a.method}</td> : null}
                              {cols.host ? <td className="ph-mono">{a.host}</td> : null}
                              {cols.path ? <td className="ph-mono">{a.path_template}</td> : null}
                              {cols.mime ? <td className="ph-mono">{a.top_mime}</td> : null}

                              {cols.statuses ? (
                                <td>
                                  {(a.status_codes || []).slice(0, 6).join(", ")}
                                  {(a.status_codes || []).length > 6 ? "…" : ""}
                                </td>
                              ) : null}

                              {cols.bytes ? <td>{fmtInt(a.avg_resp_bytes)}</td> : null}
                              {cols.time ? <td>{fmtMs(a.avg_time_ms)}</td> : null}
                              {cols.body ? <td>{a.has_body ? "yes" : ""}</td> : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Details */}
                <div className="right" id="ph-details">
                  <div className="ph-h2" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    Details
                    {selectedAction?.risk_score !== undefined ? (
                      <span style={riskStyle(selectedAction.risk_score)}>{fmtInt(selectedAction.risk_score)}</span>
                    ) : null}
                  </div>

                  {!selectedAction ? (
                    <div className="ph-small">Click an action row.</div>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                        <button className="ph-btn" onClick={() => copyToClipboard(selectedAction.key).then((ok) => setToast(ok ? "Copied key" : "Copy failed"))}>
                          Copy key
                        </button>
                        <button className="ph-btn" disabled={!selectedAction.host} onClick={() => copyToClipboard(selectedAction.host || "").then((ok) => setToast(ok ? "Copied host" : "Copy failed"))}>
                          Copy host
                        </button>
                        <button className="ph-btn" disabled={!selectedAction.path_template} onClick={() => copyToClipboard(selectedAction.path_template || "").then((ok) => setToast(ok ? "Copied path" : "Copy failed"))}>
                          Copy path
                        </button>
                        <button className="ph-btn" disabled={!selectedAction.sample_urls?.length} onClick={() => copyToClipboard(selectedAction.sample_urls?.[0] || "").then((ok) => setToast(ok ? "Copied URL" : "Copy failed"))}>
                          Copy URL
                        </button>
                        <button className="ph-btn" disabled={!selectedAction.sample_urls?.length} onClick={() => {
                          const u = selectedAction.sample_urls?.[0] || "";
                          if (u) window.open(u, "_blank", "noopener,noreferrer");
                        }}>
                          Open URL
                        </button>
                      </div>

                      <div className="ph-mono" style={{ fontSize: 12, opacity: 0.9 }}>{selectedAction.key}</div>

                      {scopeBadges.length ? (
                        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {scopeBadges.map((b) => <span key={b.t} style={pillStyle(b.bg, b.fg)}>{b.t}</span>)}
                        </div>
                      ) : null}

                      <div className="ph-kv" style={{ marginTop: 10 }}><strong>Count:</strong> {selectedAction.count}</div>
                      <div className="ph-kv"><strong>Avg bytes:</strong> {fmtInt(selectedAction.avg_resp_bytes)}</div>
                      <div className="ph-kv"><strong>Avg time:</strong> {fmtMs(selectedAction.avg_time_ms)} ms</div>
                      <div className="ph-kv"><strong>Has body:</strong> {selectedAction.has_body ? "yes" : "no"}</div>

                      {selectedAction.risk_score !== undefined ? (
                        <div className="ph-kv">
                          <strong>Risk:</strong> <span style={riskStyle(selectedAction.risk_score)}>{fmtInt(selectedAction.risk_score)}</span>{" "}
                          {Array.isArray(selectedAction.risk_tags) && selectedAction.risk_tags.length ? `(${selectedAction.risk_tags.join(", ")})` : ""}
                        </div>
                      ) : null}

                      {Array.isArray(selectedAction.sample_urls) && selectedAction.sample_urls.length ? (
                        <>
                          <div className="ph-h2" style={{ marginTop: 14 }}>Sample URLs</div>
                          <ul className="ph-list">
                            {selectedAction.sample_urls.slice(0, 10).map((u) => (
                              <li key={u} style={{ wordBreak: "break-all", display: "flex", alignItems: "center", gap: 10 }}>
                                <span className="ph-mono" style={{ flex: 1 }}>{u}</span>
                                <button className="ph-btn" onClick={() => copyToClipboard(u).then((ok) => setToast(ok ? "Copied" : "Copy failed"))}>Copy</button>
                                <button className="ph-btn" onClick={() => window.open(u, "_blank", "noopener,noreferrer")}>Open</button>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}

                      {Array.isArray(selectedAction.top_query_keys) && selectedAction.top_query_keys.length ? (
                        <>
                          <div className="ph-h2" style={{ marginTop: 14 }}>Top query keys</div>
                          <ul className="ph-list">
                            {selectedAction.top_query_keys.slice(0, 16).map((x) => (
                              <li key={x.value}><span className="ph-mono">{x.value}</span> — {x.count}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}

                      {Array.isArray(selectedAction.top_statuses) && selectedAction.top_statuses.length ? (
                        <>
                          <div className="ph-h2" style={{ marginTop: 14 }}>Top statuses</div>
                          <ul className="ph-list">
                            {selectedAction.top_statuses.slice(0, 12).map((x) => (
                              <li key={String(x.value)}><span className="ph-mono">{String(x.value)}</span> — {x.count}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}

                      {Array.isArray(selectedAction.top_mimes) && selectedAction.top_mimes.length ? (
                        <>
                          <div className="ph-h2" style={{ marginTop: 14 }}>Top mimes</div>
                          <ul className="ph-list">
                            {selectedAction.top_mimes.slice(0, 12).map((x) => (
                              <li key={x.value}><span className="ph-mono">{x.value}</span> — {x.count}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 16 }} className="ph-small">
            Tip: This is organizer/intel mode only — no replay, no fuzzing. Modules come later.
          </div>
        </div>
      </div>
    </div>
  );
}
