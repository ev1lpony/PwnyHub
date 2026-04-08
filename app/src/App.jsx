import React, { useEffect, useMemo, useRef, useState } from "react";
import SetupWizard from "./components/SetupWizard";
import SourcesPanel from "./components/SourcesPanel";
import ModulesPanel from "./components/ModulesPanel";
import ActionsToolbar from "./components/ActionsToolbar";
import ActionsTable from "./components/ActionsTable";
import ActionDetails from "./components/ActionDetails";
import TopControlsBar from "./components/TopControlsBar";

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

  // ML Risk Scoring
  const [mlEnabled, setMlEnabled] = useState(saved.mlEnabled || false);

  // Modules / Runs / Findings
  const [modules, setModules] = useState([]);
  const [modulesBusy, setModulesBusy] = useState(false);
  const [runs, setRuns] = useState([]);
  const [runsBusy, setRunsBusy] = useState(false);
  const [runFindings, setRunFindings] = useState([]);
  const [findingsBusy, setFindingsBusy] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState(saved.selectedModuleId || "risk_digest");
  const [selectedRunId, setSelectedRunId] = useState(saved.selectedRunId || "");
  const [moduleRunBusy, setModuleRunBusy] = useState(false);
  const [moduleMinRisk, setModuleMinRisk] = useState(
    Number.isFinite(saved.moduleMinRisk) ? saved.moduleMinRisk : 70
  );

  // Sources / Ingest
  const [sources, setSources] = useState([]);
  const [sourcesBusy, setSourcesBusy] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState(saved.selectedSourceId || "");
  const [sourceName, setSourceName] = useState(saved.sourceName || "");

  // Filters
  const [fHost, setFHost] = useState(saved.fHost || "");
  const [fMethod, setFMethod] = useState(saved.fMethod || "");
  const [fMime, setFMime] = useState(saved.fMime || "");
  const [fSourceId, setFSourceId] = useState(saved.fSourceId || "");
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
  const [wizEnabledModules, setWizEnabledModules] = useState([]);
  const [wizModuleConfigs, setWizModuleConfigs] = useState({});
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  function openWizardFromCfg(cfg, force = false) {
    if (!cfg?.project) return;
    if (!force && wizardOpen) return;
    const p = cfg.project;

    const allowLines = Array.isArray(p?.scope?.allow)
      ? p.scope.allow
      : Array.isArray(p?.scope_allow)
        ? p.scope_allow
        : [];
    const denyLines = Array.isArray(p?.scope?.deny)
      ? p.scope.deny
      : Array.isArray(p?.scope_deny)
        ? p.scope_deny
        : [];

    setWizAllowText(listToLines(allowLines));
    setWizDenyText(listToLines(denyLines));
    setWizQps(String(p?.qps ?? 3));
    setWizRoeText(String(p?.roe_json || safePrettyJson(p?.roe || {})));
    setWizEnabledModules(Array.isArray(p?.enabled_modules) ? p.enabled_modules.map((x) => String(x)) : []);
    setWizModuleConfigs(
      p?.module_configs && typeof p.module_configs === "object" && !Array.isArray(p.module_configs)
        ? p.module_configs
        : {}
    );

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
      fSourceId,
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
      mlEnabled,
      selectedModuleId,
      selectedRunId,
      moduleMinRisk,
      selectedSourceId,
      sourceName,
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
    fSourceId,
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
    mlEnabled,
    selectedModuleId,
    selectedRunId,
    moduleMinRisk,
    selectedSourceId,
    sourceName,
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

  const selectedModule = useMemo(() => {
    return modules.find((m) => String(m.id) === String(selectedModuleId)) || null;
  }, [modules, selectedModuleId]);

  const selectedRun = useMemo(() => {
    return runs.find((r) => String(r.id) === String(selectedRunId)) || null;
  }, [runs, selectedRunId]);

  const selectedRunSummary = useMemo(() => {
    return safeJsonParse(selectedRun?.summary_json || "{}") || {};
  }, [selectedRun]);

  const selectedSource = useMemo(() => {
    return sources.find((s) => String(s.id) === String(selectedSourceId)) || null;
  }, [sources, selectedSourceId]);

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
                    <input type="checkbox" checked={show} onChange={(e) => setShowTag(tag, e.target.checked)} />
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

  const actionSourceOptions = useMemo(() => {
    const map = new Map();

    for (const s of sources) {
      const id = String(s?.id ?? "").trim();
      if (!id) continue;
      map.set(id, {
        id,
        name: s?.name || "",
        kind: s?.kind || "",
        entry_count: Number(s?.entry_count || 0),
      });
    }

    for (const a of actions) {
      const topSources = Array.isArray(a?.top_sources) ? a.top_sources : [];
      for (const ts of topSources) {
        const id = String(ts?.source_id ?? "").trim();
        if (!id) continue;

        const prev = map.get(id) || { id, name: "", kind: "", entry_count: 0 };
        map.set(id, {
          id,
          name: prev.name || ts?.name || "",
          kind: prev.kind || ts?.kind || "",
          entry_count: prev.entry_count || 0,
        });
      }

      const rawIds = Array.isArray(a?.source_ids) ? a.source_ids : [];
      for (const sid of rawIds) {
        const id = String(sid ?? "").trim();
        if (!id || map.has(id)) continue;
        map.set(id, { id, name: "", kind: "", entry_count: 0 });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const an = `${a.name || ""}`.toLowerCase();
      const bn = `${b.name || ""}`.toLowerCase();
      if (an && bn && an !== bn) return an.localeCompare(bn);
      if (an && !bn) return -1;
      if (!an && bn) return 1;
      return Number(a.id) - Number(b.id);
    });
  }, [sources, actions]);

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
      .filter((a) => {
        if (!fSourceId) return true;
        const ids = Array.isArray(a?.source_ids) ? a.source_ids.map((x) => String(x)) : [];
        return ids.includes(String(fSourceId));
      })
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
          (Array.isArray(a.risk_tags) ? a.risk_tags.join(" ").toLowerCase().includes(qq) : false) ||
          (Array.isArray(a.source_names) ? a.source_names.join(" ").toLowerCase().includes(qq) : false) ||
          (Array.isArray(a.source_kinds) ? a.source_kinds.join(" ").toLowerCase().includes(qq) : false) ||
          (Array.isArray(a.source_ids) ? a.source_ids.map((x) => String(x)).join(" ").includes(qq) : false)
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
    fSourceId,
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
    fSourceId,
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

  // Load ML setting from backend when engine is ready
  useEffect(() => {
    if (!engineOk) return;
    (async () => {
      try {
        const data = await jfetch(`${engineUrl}/settings/ml`);
        setMlEnabled(!!data.ml_risk_enabled);
      } catch (e) {
        console.warn("Could not load ML settings", e);
      }
    })();
  }, [engineOk, engineUrl]);

  useEffect(() => {
    if (!engineOk) return;
    loadModules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineOk, engineUrl]);

  useEffect(() => {
    if (!engineOk || !projectId || !setupComplete) {
      setRuns([]);
      setSelectedRunId("");
      setRunFindings([]);
      return;
    }
    loadRuns(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineOk, projectId, setupComplete]);

  useEffect(() => {
    if (!engineOk || !projectId || !setupComplete) {
      setSources([]);
      setSelectedSourceId("");
      return;
    }
    loadSources(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineOk, projectId, setupComplete]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunFindings([]);
      return;
    }
    loadRunFindings(selectedRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId]);

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

  async function loadModules() {
    if (!engineOk) return;
    setModulesBusy(true);
    try {
      const data = await jfetch(`${engineUrl}/modules`);
      const list = Array.isArray(data?.modules) ? data.modules : [];
      setModules(list);
      setSelectedModuleId((prev) => {
        if (prev && list.some((m) => String(m.id) === String(prev))) return prev;
        return list[0]?.id || "";
      });
    } catch (e) {
      setMsg(`Failed to load modules: ${String(e?.message || e)}`);
    } finally {
      setModulesBusy(false);
    }
  }

  async function loadRuns(pid) {
    const p = pid || projectId;
    if (!p) return;
    setRunsBusy(true);
    try {
      const data = await jfetch(`${engineUrl}/runs?project_id=${encodeURIComponent(p)}`);
      const list = Array.isArray(data?.runs) ? data.runs : [];
      setRuns(list);
      setSelectedRunId((prev) => {
        if (prev && list.some((r) => String(r.id) === String(prev))) return prev;
        return list[0]?.id ? String(list[0].id) : "";
      });
    } catch (e) {
      setMsg(`Failed to load runs: ${String(e?.message || e)}`);
    } finally {
      setRunsBusy(false);
    }
  }

  async function loadSources(pid) {
    const p = pid || projectId;
    if (!p) return;
    setSourcesBusy(true);
    try {
      const data = await jfetch(`${engineUrl}/sources?project_id=${encodeURIComponent(p)}`);
      const list = Array.isArray(data?.sources) ? data.sources : [];
      setSources(list);
      setSelectedSourceId((prev) => {
        if (prev && list.some((s) => String(s.id) === String(prev))) return prev;
        return list[0]?.id ? String(list[0].id) : "";
      });
    } catch (e) {
      setMsg(`Failed to load sources: ${String(e?.message || e)}`);
    } finally {
      setSourcesBusy(false);
    }
  }

  async function loadRunFindings(runId) {
    const rid = runId || selectedRunId;
    if (!rid) {
      setRunFindings([]);
      return;
    }
    setFindingsBusy(true);
    try {
      const data = await jfetch(`${engineUrl}/runs/${encodeURIComponent(rid)}/findings`);
      const list = Array.isArray(data?.findings) ? data.findings : [];
      setRunFindings(list);
    } catch (e) {
      setMsg(`Failed to load findings: ${String(e?.message || e)}`);
    } finally {
      setFindingsBusy(false);
    }
  }

  async function runSelectedModule() {
    if (!engineOk) return setToast("Engine down");
    if (!projectId) return setToast("Pick project");
    if (!setupComplete) {
      setToast("Setup required");
      setWizardOpen(true);
      return;
    }
    if (!selectedModuleId) return setToast("Pick module");

    const params =
      selectedModuleId === "risk_digest"
        ? { min_risk: Math.max(0, Math.min(100, Number(moduleMinRisk) || 70)) }
        : {};

    setModuleRunBusy(true);
    try {
      const data = await jfetch(`${engineUrl}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: Number(projectId),
          module_id: selectedModuleId,
          params,
        }),
      });

      const newRunId = String(data?.run_id || "");
      setToast("Module ran");
      setMsg(`Module ${selectedModuleId} finished.`);
      await loadRuns(projectId);
      if (newRunId) {
        setSelectedRunId(newRunId);
        await loadRunFindings(newRunId);
      }
    } catch (e) {
      setMsg(`Module run failed: ${String(e?.message || e)}`);
      setToast("Module failed");
    } finally {
      setModuleRunBusy(false);
    }
  }

  // Toggle ML Risk Scoring
  async function toggleMlRisk() {
    const newVal = !mlEnabled;
    try {
      await jfetch(`${engineUrl}/settings/ml`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newVal }),
      });
      setMlEnabled(newVal);
      setToast(newVal ? "ML Risk Scoring Enabled" : "ML Risk Scoring Disabled");

      // Refresh actions so ML scores take effect
      if (projectId && setupComplete) {
        await loadActions();
      }
    } catch (e) {
      setToast(`Failed to toggle ML: ${String(e?.message || e)}`);
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
        await loadSources(pid);
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
        if (sourceName.trim()) fd.append("source_name", sourceName.trim());
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
      await loadSources(projectId);
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
        await loadSources(projectId);
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
    setFSourceId("");
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

  function runStatusStyle(status) {
    const s = String(status || "").toLowerCase();
    if (s === "done") return pillStyle("#1f2c1f", "#c9ffd0");
    if (s === "running") return pillStyle("#1c2430", "#cfe0ff");
    if (s === "failed") return pillStyle("#3b1f1f", "#ffd2d2");
    return pillStyle("#222", "#eee");
  }

  function severityStyle(sev) {
    const s = String(sev || "").toLowerCase();
    if (s === "high") return pillStyle("#4a1515", "#ffd6d6");
    if (s === "med") return pillStyle("#4a3515", "#ffe7c2");
    if (s === "low") return pillStyle("#1f2c1f", "#c9ffd0");
    return pillStyle("#1c2430", "#cfe0ff");
  }

  function sourceStatusStyle(status) {
    const s = String(status || "").toLowerCase();
    if (s === "done") return pillStyle("#1f2c1f", "#c9ffd0");
    if (s === "running") return pillStyle("#1c2430", "#cfe0ff");
    if (s === "failed") return pillStyle("#3b1f1f", "#ffd2d2");
    return pillStyle("#222", "#eee");
  }

  function getSourceMeta(sourceId) {
    const id = String(sourceId ?? "").trim();
    if (!id) return null;
    return sources.find((s) => String(s?.id) === id) || null;
  }

  function getSourceDisplay(sourceId, fallback = {}) {
    const live = getSourceMeta(sourceId);
    return {
      id: String(sourceId ?? ""),
      name: live?.name || fallback?.name || "",
      kind: live?.kind || fallback?.kind || "",
      entry_count: Number(live?.entry_count || 0),
      status: live?.status || "",
    };
  }

  function inspectSourceId(sourceId) {
    const id = String(sourceId ?? "").trim();
    if (!id) return;
    setSelectedSourceId(id);
    const el = document.getElementById("ph-source-details");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function filterToSourceId(sourceId) {
    const id = String(sourceId ?? "").trim();
    setFSourceId(id);
    if (id) setToast(`Source #${id}`);
  }

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
        enabled_modules: Array.isArray(wizEnabledModules) ? wizEnabledModules.map((x) => String(x)) : [],
        module_configs:
          wizModuleConfigs && typeof wizModuleConfigs === "object" && !Array.isArray(wizModuleConfigs)
            ? wizModuleConfigs
            : {},
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
        await loadSources(projectId);
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

  const handleWizardValidate = ({ allow, deny, enabled_modules, module_configs }) => {
    const em = Array.isArray(enabled_modules) ? enabled_modules.length : 0;
    const mc =
      module_configs && typeof module_configs === "object" && !Array.isArray(module_configs)
        ? Object.keys(module_configs).length
        : 0;
    setToast(`allow:${allow.length} deny:${deny.length} mods:${em}/${mc}`);
  };

  const wizardOverlay = (
    <SetupWizard
      open={wizardOpen}
      modal={true}
      setupComplete={setupComplete}
      wizardCanClose={wizardCanClose}
      projectCfg={projectCfg}
      projectId={projectId}
      wizardErr={wizardErr}
      wizardSaving={wizardSaving}
      wizardDirty={wizardDirty}
      engineOk={engineOk}
      wizAllowText={wizAllowText}
      setWizAllowText={(value) => {
        setWizAllowText(value);
        setWizardDirty(true);
      }}
      wizDenyText={wizDenyText}
      setWizDenyText={(value) => {
        setWizDenyText(value);
        setWizardDirty(true);
      }}
      wizQps={wizQps}
      setWizQps={(value) => {
        setWizQps(value);
        setWizardDirty(true);
      }}
      wizRoeText={wizRoeText}
      setWizRoeText={(value) => {
        setWizRoeText(value);
        setWizardDirty(true);
      }}
      wizUseAdvanced={wizUseAdvanced}
      setWizUseAdvanced={(value) => {
        setWizUseAdvanced(value);
        setWizardDirty(true);
      }}
      setWizardDirty={setWizardDirty}
      modules={modules}
      modulesBusy={modulesBusy}
      wizEnabledModules={wizEnabledModules}
      setWizEnabledModules={setWizEnabledModules}
      wizModuleConfigs={wizModuleConfigs}
      setWizModuleConfigs={setWizModuleConfigs}
      pillStyle={pillStyle}
      parseLinesToList={parseLinesToList}
      subtitle={
        <>
          Set <strong>scope</strong>, <strong>ROE</strong>, and project defaults first. You can import a HAR here before entering the main workspace.
        </>
      }
      tip={
        <>
          Tip: Once setup is saved, you can continue into the main workspace and still import more HAR files later.
        </>
      }
      saveLabel="Save setup"
      onClose={() => setWizardOpen(false)}
      onLoadDefaultRoe={wizardLoadDefaultRoe}
      onSave={wizardSave}
      onValidate={handleWizardValidate}
    />
  );

  const onboardingScreen = (
    <div className={`ph-wrap${focusMode ? " focus" : ""}`}>
      <h1 style={{ marginBottom: 6, display: "flex", alignItems: "baseline", gap: 12 }}>
        PwnyHub {toast ? <span style={pillStyle("#1d2b1d", "#c9ffd0")}>{toast}</span> : null}
      </h1>

      <div className="ph-sub">
        First-run setup. Choose your project, define scope + ROE, optionally import a HAR, then continue into the main workspace.
      </div>

      <div className="ph-card" style={{ marginBottom: 16 }}>
        <div className="ph-row" style={{ alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <span className="ph-pill" title={engineOk ? `Last OK: ${engineAgo}` : "Engine down"}>
            <strong>Engine:</strong>{" "}
            <span className={engineOk ? "ok" : "down"}>{engineOk ? "OK" : "Down"}</span>{" "}
            {engineOk && engineAgo ? <span style={{ opacity: 0.7, marginLeft: 8 }}>{engineAgo}</span> : null}
          </span>

          <span className="ph-small">
            URL:{" "}
            <input
              className="ph-input"
              value={engineUrl}
              onChange={(e) => setEngineUrl(e.target.value)}
              style={{ width: 280 }}
            />
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
              setSelectedRunId("");
              setSelectedSourceId("");
              setFSourceId("");
              setWizEnabledModules([]);
              setWizModuleConfigs({});
              setMsg("");
            }}
            disabled={!engineOk}
            title="Select project"
          >
            <option value="">Select project…</option>
            {projects.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name} (id={p.id})
                {p.setup_complete === false ? " • setup" : ""}
              </option>
            ))}
          </select>

          {projectId ? (
            <button className="ph-btn" onClick={() => setWorkspaceOpen(true)} disabled={!setupComplete}>
              Continue to workspace
            </button>
          ) : null}
        </div>

        {!engineOk && engineErr ? (
          <div className="ph-err" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Engine error</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{engineErr}</div>
          </div>
        ) : null}

        {msg ? <div className="ph-msg">{msg}</div> : null}
      </div>

      <SetupWizard
        open={true}
        modal={false}
        setupComplete={setupComplete}
        wizardCanClose={wizardCanClose}
        projectCfg={projectCfg}
        projectId={projectId}
        wizardErr={wizardErr}
        wizardSaving={wizardSaving}
        wizardDirty={wizardDirty}
        engineOk={engineOk}
        wizAllowText={wizAllowText}
        setWizAllowText={(value) => {
          setWizAllowText(value);
          setWizardDirty(true);
        }}
        wizDenyText={wizDenyText}
        setWizDenyText={(value) => {
          setWizDenyText(value);
          setWizardDirty(true);
        }}
        wizQps={wizQps}
        setWizQps={(value) => {
          setWizQps(value);
          setWizardDirty(true);
        }}
        wizRoeText={wizRoeText}
        setWizRoeText={(value) => {
          setWizRoeText(value);
          setWizardDirty(true);
        }}
        wizUseAdvanced={wizUseAdvanced}
        setWizUseAdvanced={(value) => {
          setWizUseAdvanced(value);
          setWizardDirty(true);
        }}
        setWizardDirty={setWizardDirty}
        modules={modules}
        modulesBusy={modulesBusy}
        wizEnabledModules={wizEnabledModules}
        setWizEnabledModules={setWizEnabledModules}
        wizModuleConfigs={wizModuleConfigs}
        setWizModuleConfigs={setWizModuleConfigs}
        pillStyle={pillStyle}
        parseLinesToList={parseLinesToList}
        subtitle={
          <>
            Set <strong>scope</strong>, <strong>ROE</strong>, and project defaults first. You can import a HAR here before entering the main workspace.
          </>
        }
        tip={
          <>
            Tip: Once setup is saved, you can continue into the main workspace and still import more HAR files later.
          </>
        }
        saveLabel="Save setup"
        onClose={() => setWizardOpen(false)}
        onLoadDefaultRoe={wizardLoadDefaultRoe}
        onSave={wizardSave}
        onValidate={handleWizardValidate}
      />

      <div className="ph-card" style={{ marginTop: 16 }}>
        <div className="ph-h2" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          Optional HAR import
          {!setupComplete && projectId ? <span style={pillStyle("#2a2020", "#ffd2d2")}>Finish setup first</span> : null}
        </div>

        <div className="ph-small" style={{ opacity: 0.8, marginBottom: 10 }}>
          You can import now to seed the workspace, or skip this and import later from the main screen.
        </div>

        <div className="ph-row" style={{ alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <input
            className="ph-input"
            type="file"
            accept=".har,application/json"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={!engineOk || !setupComplete}
            title={!setupComplete ? "Complete setup first" : ""}
          />

          <input
            className="ph-input"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            placeholder="source name (optional)"
            style={{ width: 210 }}
            disabled={!engineOk || !setupComplete}
          />

          <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={includeAssets}
              onChange={(e) => setIncludeAssets(e.target.checked)}
              disabled={!setupComplete}
            />
            include assets
          </label>

          <button
            className="ph-btn"
            onClick={importHar}
            disabled={!engineOk || busy || !projectId || !file || !setupComplete}
          >
            {busy ? "Working…" : "Import HAR"}
          </button>

          <button className="ph-btn" onClick={() => setWorkspaceOpen(true)} disabled={!projectId || !setupComplete}>
            Start workspace
          </button>
        </div>
      </div>
    </div>
  );

  if (!workspaceOpen) {
    return onboardingScreen;
  }

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
        <TopControlsBar
          engineOk={engineOk}
          engineErr={engineErr}
          engineAgo={engineAgo}
          engineUrl={engineUrl}
          setEngineUrl={setEngineUrl}
          createDemoProject={createDemoProject}
          busy={busy}
          projects={projects}
          projectId={projectId}
          setProjectId={setProjectId}
          setSummary={setSummary}
          setActions={setActions}
          setSelectedActionKey={setSelectedActionKey}
          setSelectedRunId={setSelectedRunId}
          setSelectedSourceId={setSelectedSourceId}
          setFSourceId={setFSourceId}
          setMsg={setMsg}
          projectCfg={projectCfg}
          openWizardFromCfg={openWizardFromCfg}
          setWizardOpen={setWizardOpen}
          setToast={setToast}
          autoLoadOnProjectSelect={autoLoadOnProjectSelect}
          setAutoLoadOnProjectSelect={setAutoLoadOnProjectSelect}
          setupComplete={setupComplete}
          focusMode={focusMode}
          setFocusMode={setFocusMode}
          setFile={setFile}
          sourceName={sourceName}
          setSourceName={setSourceName}
          includeAssets={includeAssets}
          setIncludeAssets={setIncludeAssets}
          includeRisk={includeRisk}
          setIncludeRisk={setIncludeRisk}
          mlEnabled={mlEnabled}
          toggleMlRisk={toggleMlRisk}
          importHar={importHar}
          refreshSummary={refreshSummary}
          loadActions={loadActions}
          busyActions={busyActions}
          file={file}
        />

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

          {/* Sources / Ingest */}
          <SourcesPanel
            engineOk={engineOk}
            projectId={projectId}
            setupComplete={setupComplete}
            sources={sources}
            sourcesBusy={sourcesBusy}
            selectedSourceId={selectedSourceId}
            selectedSource={selectedSource}
            fSourceId={fSourceId}
            pillStyle={pillStyle}
            sourceStatusStyle={sourceStatusStyle}
            fmtInt={fmtInt}
            safePrettyJson={safePrettyJson}
            onRefreshSources={() => loadSources()}
            onSelectSource={(id) => setSelectedSourceId(id)}
            onFilterToSource={filterToSourceId}
            onClearSourceFilter={() => setFSourceId("")}
          />

          {/* Modules / Runs / Findings */}
          <ModulesPanel
            engineOk={engineOk}
            projectId={projectId}
            setupComplete={setupComplete}
            modules={modules}
            modulesBusy={modulesBusy}
            runs={runs}
            runsBusy={runsBusy}
            runFindings={runFindings}
            findingsBusy={findingsBusy}
            selectedModuleId={selectedModuleId}
            selectedModule={selectedModule}
            selectedRunId={selectedRunId}
            selectedRun={selectedRun}
            selectedRunSummary={selectedRunSummary}
            moduleRunBusy={moduleRunBusy}
            moduleMinRisk={moduleMinRisk}
            pillStyle={pillStyle}
            runStatusStyle={runStatusStyle}
            severityStyle={severityStyle}
            safeJsonParse={safeJsonParse}
            safePrettyJson={safePrettyJson}
            onRefreshModules={() => loadModules()}
            onRefreshRuns={() => loadRuns()}
            onSelectModule={(id) => setSelectedModuleId(id)}
            onSetModuleMinRisk={(value) =>
              setModuleMinRisk(Math.max(0, Math.min(100, parseInt(value || "0", 10) || 0)))
            }
            onRunSelectedModule={runSelectedModule}
            onSelectRun={(id) => setSelectedRunId(id)}
          />

          {/* Actions */}
          <div>
            <ActionsToolbar
              actions={actions}
              filteredActions={filteredActions}
              hasRisk={hasRisk}
              fSourceId={fSourceId}
              pillStyle={pillStyle}
              activeSortExplain={activeSortExplain}
              exportActions={exportActions}
              copyJson={copyJson}
              selectedAction={selectedAction}
              fHost={fHost}
              setFHost={setFHost}
              hostOptions={hostOptions}
              fMethod={fMethod}
              setFMethod={setFMethod}
              methodOptions={methodOptions}
              fMime={fMime}
              setFMime={setFMime}
              mimeOptions={mimeOptions}
              actionSourceOptions={actionSourceOptions}
              setFSourceId={setFSourceId}
              searchRef={searchRef}
              q={q}
              setQ={setQ}
              keyHint={keyHint}
              setupComplete={setupComplete}
              onlyHasBody={onlyHasBody}
              setOnlyHasBody={setOnlyHasBody}
              minCount={minCount}
              setMinCount={setMinCount}
              minRisk={minRisk}
              setMinRisk={setMinRisk}
              resetUi={resetUi}
              excludedTagSet={excludedTagSet}
              tagFilterOpen={tagFilterOpen}
              setTagFilterOpen={setTagFilterOpen}
              tagFilterPanel={tagFilterPanel}
              defaultCols={defaultCols}
              cols={cols}
              toggleCol={toggleCol}
              riskStyle={riskStyle}
            />

            {!setupComplete ? (
              <div className="ph-small">
                Setup is required before actions view is enabled. Click <strong>Settings</strong>.
              </div>
            ) : actions.length === 0 ? (
              <div className="ph-small">
                No actions loaded yet. Import a HAR or click “Load actions”.
              </div>
            ) : (
              <div className="ph-grid">
                <ActionsTable
                  filteredActions={filteredActions}
                  selectedActionKey={selectedActionKey}
                  setSelectedActionKey={setSelectedActionKey}
                  cols={cols}
                  hasRisk={hasRisk}
                  toggleSort={toggleSort}
                  sortMark={sortMark}
                  riskStyle={riskStyle}
                  pillStyle={pillStyle}
                  fmtInt={fmtInt}
                  fmtMs={fmtMs}
                  tableScrollRef={tableScrollRef}
                />

                <ActionDetails
                  selectedAction={selectedAction}
                  scopeBadges={scopeBadges}
                  pillStyle={pillStyle}
                  riskStyle={riskStyle}
                  fmtInt={fmtInt}
                  fmtMs={fmtMs}
                  copyToClipboard={copyToClipboard}
                  setToast={setToast}
                  fSourceId={fSourceId}
                  setFSourceId={setFSourceId}
                  getSourceDisplay={getSourceDisplay}
                  sourceStatusStyle={sourceStatusStyle}
                  inspectSourceId={inspectSourceId}
                  filterToSourceId={filterToSourceId}
                />
              </div>
            )}
          </div>

          <div style={{ marginTop: 16 }} className="ph-small">
            Tip: Actions help you triage. Modules turn that triage into repeatable workflow.
          </div>
        </div>
      </div>
    </div>
  );
}
