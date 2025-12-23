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
  // Adjust for dark mode so it's not blinding.
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
  // backend might return:
  // - array of [k, v]
  // - object map {k: v}
  // - already array of objects
  if (!x) return [];
  if (Array.isArray(x)) {
    if (x.length && Array.isArray(x[0]) && x[0].length >= 2) return x;
    return x;
  }
  if (typeof x === "object") {
    return Object.entries(x);
  }
  return [];
}

function isMac() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
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

  // Default ordering ("normal"):
  // - If risk exists, default to highest risk first
  // - Else default to count desc
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
    // third click => back to default ("normal")
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
      } else {
        const d = String(vb).localeCompare(String(va)) * dirMul;
        if (d !== 0) return d;

        const t1 = num(B.count) - num(A.count);
        if (t1 !== 0) return t1;
        return num(B.avg_time_ms) - num(A.avg_time_ms);
      }
    };

    list = list.slice().sort(cmp);
    return list.slice(0, 800);
  }, [
    actions,
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
    if (!stillVisible) {
      setSelectedActionKey(filteredActions[0]?.key || "");
    }
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
  ]);

  // Keyboard shortcuts (no stale selectedAction closure)
  useEffect(() => {
    function getSelected() {
      return actions.find((a) => a.key === selectedActionKey) || null;
    }

    function onKeyDown(e) {
      const tag = (e.target?.tagName || "").toLowerCase();
      const isTyping =
        tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable;

      const k = e.key || "";
      const metaOrCtrl = (isMac() ? e.metaKey : e.ctrlKey) || false;

      // Cmd/Ctrl+K or "/" focus search
      if ((metaOrCtrl && k.toLowerCase() === "k") || (!isTyping && k === "/")) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      // Focus mode toggle (f)
      if (!isTyping && k.toLowerCase() === "f") {
        e.preventDefault();
        setFocusMode((v) => !v);
        setToast("Focus");
        return;
      }

      // Export filtered (e)
      if (!isTyping && k.toLowerCase() === "e") {
        e.preventDefault();
        const payload = JSON.stringify(filteredActions, null, 2);
        const ok = downloadTextFile(`pwnyhub_actions_filtered_${Date.now()}.json`, payload);
        setToast(ok ? "Exported" : "Export failed");
        return;
      }

      if (isTyping) return;

      // Up/Down select rows
      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        setNavIntent(k);
        return;
      }

      // Enter scroll details into view
      if (k === "Enter") {
        e.preventDefault();
        const el = document.getElementById("ph-details");
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      // c copy key
      if (k.toLowerCase() === "c") {
        e.preventDefault();
        const a = getSelected();
        if (a?.key) {
          copyToClipboard(a.key).then((ok) => setToast(ok ? "Copied key" : "Copy failed"));
        }
        return;
      }

      // u copy first sample url
      if (k.toLowerCase() === "u") {
        e.preventDefault();
        const a = getSelected();
        const u = a?.sample_urls?.[0] || "";
        if (u) {
          copyToClipboard(u).then((ok) => setToast(ok ? "Copied URL" : "Copy failed"));
        }
        return;
      }

      // o open first sample url
      if (k.toLowerCase() === "o") {
        e.preventDefault();
        const a = getSelected();
        const u = a?.sample_urls?.[0] || "";
        if (u) window.open(u, "_blank", "noopener,noreferrer");
        return;
      }

      // Escape clears selection
      if (k === "Escape") {
        setSelectedActionKey("");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedActionKey, actions, filteredActions]);

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
        if (!projectId && list.length > 0) {
          setProjectId(String(list[0].id));
        }
      } catch (e) {
        setMsg(`Failed to load projects: ${String(e?.message || e)}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineOk]);

  async function refreshSummary(pid) {
    const p = pid || projectId;
    if (!p) return;
    const data = await jfetch(`${engineUrl}/summary?project_id=${encodeURIComponent(p)}`);
    setSummary(data);
  }

  async function loadActions(pid) {
    const p = pid || projectId;
    if (!p) return;
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
  }, [projectId, autoLoadOnProjectSelect, includeRisk, engineOk]);

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

  return (
    <div className={`ph-wrap${focusMode ? " focus" : ""}`}>
      <h1 style={{ marginBottom: 6, display: "flex", alignItems: "baseline", gap: 12 }}>
        PwnyHub{" "}
        {toast ? <span style={pillStyle("#1d2b1d", "#c9ffd0")}>{toast}</span> : null}
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
                setMsg("");
              }}
              disabled={!engineOk}
              title="Select project"
            >
              <option value="">Select project…</option>
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name} (id={p.id})
                </option>
              ))}
            </select>

            <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={autoLoadOnProjectSelect}
                onChange={(e) => setAutoLoadOnProjectSelect(e.target.checked)}
              />
              Auto-load
            </label>

            <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={focusMode}
                onChange={(e) => setFocusMode(e.target.checked)}
              />
              Focus mode
            </label>

            <input
              className="ph-input"
              type="file"
              accept=".har,application/json"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              disabled={!engineOk}
            />

            <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={includeAssets}
                onChange={(e) => setIncludeAssets(e.target.checked)}
              />
              include assets
            </label>

            <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={includeRisk}
                onChange={(e) => setIncludeRisk(e.target.checked)}
              />
              include risk
            </label>

            <button
              className="ph-btn"
              onClick={importHar}
              disabled={!engineOk || busy || !projectId || !file}
              title="Import HAR into selected project"
            >
              {busy ? "Working…" : "Import HAR"}
            </button>

            <button
              className="ph-btn"
              onClick={() => refreshSummary()}
              disabled={!engineOk || !projectId || busy}
              title="Refresh summary"
            >
              Refresh summary
            </button>

            <button
              className="ph-btn"
              onClick={() => loadActions()}
              disabled={!engineOk || !projectId || busyActions}
              title="Load actions"
            >
              {busyActions ? "Loading…" : "Load actions"}
            </button>
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
                <span style={pillStyle("#1c2430", "#cfe0ff")}>
                  entries: {summary.entries ?? summary.entries_stored ?? "?"}
                </span>
              </div>

              {summaryHosts?.length ? (
                <>
                  <div className="ph-h2" style={{ marginTop: 14 }}>
                    Top hosts
                  </div>
                  <ul className="ph-list">
                    {summaryHosts.slice(0, 20).map(([k, v]) => (
                      <li key={k}>
                        <span className="ph-mono">{k}</span> — {v}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {summaryMimes?.length ? (
                <>
                  <div className="ph-h2" style={{ marginTop: 14 }}>
                    Top MIME types
                  </div>
                  <ul className="ph-list">
                    {summaryMimes.slice(0, 20).map(([k, v]) => (
                      <li key={k}>
                        <span className="ph-mono">{k}</span> — {v}
                      </li>
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
              <span style={pillStyle("#1c2430", "#cfe0ff")}>
                showing {filteredActions.length} / {actions.length}
              </span>
              <span className="ph-small" style={{ opacity: 0.75 }}>
                {activeSortExplain()}
              </span>

              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                <button className="ph-btn" onClick={() => exportActions(actions, "actions_all")} disabled={!actions.length}>
                  Export all
                </button>
                <button
                  className="ph-btn"
                  onClick={() => exportActions(filteredActions, "actions_filtered")}
                  disabled={!filteredActions.length}
                  title="Export what you are currently viewing"
                >
                  Export filtered
                </button>
                <button
                  className="ph-btn"
                  onClick={() => copyJson(filteredActions, "Copied filtered")}
                  disabled={!filteredActions.length}
                  title="Copy filtered list JSON"
                >
                  Copy filtered JSON
                </button>
                <button
                  className="ph-btn"
                  onClick={() => selectedAction ? copyJson(selectedAction, "Copied action") : setToast("No action")}
                  disabled={!selectedAction}
                  title="Copy selected action JSON"
                >
                  Copy action JSON
                </button>
              </span>
            </div>

            {/* Filters */}
            <div className="ph-row" style={{ marginBottom: 10, alignItems: "center" }}>
              <select className="ph-select" value={fHost} onChange={(e) => setFHost(e.target.value)}>
                <option value="">All hosts</option>
                {hostOptions.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>

              <select className="ph-select" value={fMethod} onChange={(e) => setFMethod(e.target.value)}>
                <option value="">All methods</option>
                {methodOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <select className="ph-select" value={fMime} onChange={(e) => setFMime(e.target.value)}>
                <option value="">All MIME</option>
                {mimeOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <input
                ref={searchRef}
                className="ph-input"
                placeholder="Search host/path/mime/tags… (Ctrl/Cmd+K or /)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ width: 360 }}
                title={keyHint}
              />

              <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={onlyHasBody} onChange={(e) => setOnlyHasBody(e.target.checked)} />
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
                  />
                </span>
              ) : null}

              <button className="ph-btn" onClick={resetUi} title="Reset filters/sort/columns">
                Reset UI
              </button>

              <div className="ph-small" style={{ marginLeft: "auto", opacity: 0.75 }}>
                {keyHint}
              </div>
            </div>

            {/* Column toggles */}
            <div className="ph-row" style={{ marginBottom: 10, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span className="ph-small" style={{ fontWeight: 800, opacity: 0.75 }}>
                Columns:
              </span>

              {Object.keys(defaultCols).map((k) => {
                if (k === "risk" && !hasRisk) return null;
                return (
                  <label key={k} className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={!!cols[k]} onChange={() => toggleCol(k)} />
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
              Sort tip: click a column header to sort (desc → asc → normal). Normal ={" "}
              {hasRisk ? "risk desc" : "count desc"}.
            </div>

            {actions.length === 0 ? (
              <div className="ph-small">No actions loaded yet. Import a HAR or click “Load actions”.</div>
            ) : (
              <div className="ph-grid">
                {/* Table */}
                <div className="ph-tableWrap">
                  <div className="ph-tableScroll" ref={tableScrollRef}>
                    <table className="ph-table">
                      <thead>
                        <tr>
                          {cols.count ? (
                            <th style={{ cursor: "pointer" }} onClick={() => toggleSort("count")} title="Sort by count">
                              Count{sortMark("count")}
                            </th>
                          ) : null}

                          {hasRisk && cols.risk ? (
                            <th style={{ cursor: "pointer" }} onClick={() => toggleSort("risk")} title="Sort by risk">
                              Risk{sortMark("risk")}
                            </th>
                          ) : null}

                          {cols.method ? (
                            <th style={{ cursor: "pointer" }} onClick={() => toggleSort("method")} title="Sort by method">
                              Method{sortMark("method")}
                            </th>
                          ) : null}

                          {cols.host ? (
                            <th style={{ cursor: "pointer" }} onClick={() => toggleSort("host")} title="Sort by host">
                              Host{sortMark("host")}
                            </th>
                          ) : null}

                          {cols.path ? (
                            <th
                              style={{ cursor: "pointer" }}
                              onClick={() => toggleSort("path")}
                              title="Sort by path template"
                            >
                              Path template{sortMark("path")}
                            </th>
                          ) : null}

                          {cols.mime ? (
                            <th style={{ cursor: "pointer" }} onClick={() => toggleSort("mime")} title="Sort by top MIME">
                              Top MIME{sortMark("mime")}
                            </th>
                          ) : null}

                          {cols.statuses ? <th title="Status codes observed">Statuses</th> : null}

                          {cols.bytes ? (
                            <th
                              style={{ cursor: "pointer" }}
                              onClick={() => toggleSort("bytes")}
                              title="Sort by average bytes"
                            >
                              Avg bytes{sortMark("bytes")}
                            </th>
                          ) : null}

                          {cols.time ? (
                            <th style={{ cursor: "pointer" }} onClick={() => toggleSort("time")} title="Sort by average ms">
                              Avg ms{sortMark("time")}
                            </th>
                          ) : null}

                          {cols.body ? (
                            <th style={{ cursor: "pointer" }} onClick={() => toggleSort("body")} title="Sort by has body">
                              Body?{sortMark("body")}
                            </th>
                          ) : null}
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
                                  {miniTag ? (
                                    <span style={{ marginLeft: 8, ...pillStyle("#2a2020", "#ffd2d2") }}>{miniTag}</span>
                                  ) : null}
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
                        <button
                          className="ph-btn"
                          onClick={async () => {
                            const ok = await copyToClipboard(selectedAction.key);
                            setToast(ok ? "Copied key" : "Copy failed");
                          }}
                          title="Copy action key"
                        >
                          Copy key
                        </button>

                        <button
                          className="ph-btn"
                          onClick={async () => {
                            const ok = await copyToClipboard(selectedAction.host || "");
                            setToast(ok ? "Copied host" : "Copy failed");
                          }}
                          title="Copy host"
                          disabled={!selectedAction.host}
                        >
                          Copy host
                        </button>

                        <button
                          className="ph-btn"
                          onClick={async () => {
                            const ok = await copyToClipboard(selectedAction.path_template || "");
                            setToast(ok ? "Copied path" : "Copy failed");
                          }}
                          title="Copy path template"
                          disabled={!selectedAction.path_template}
                        >
                          Copy path
                        </button>

                        <button
                          className="ph-btn"
                          onClick={async () => {
                            const u = selectedAction.sample_urls?.[0] || "";
                            if (!u) return;
                            const ok = await copyToClipboard(u);
                            setToast(ok ? "Copied URL" : "Copy failed");
                          }}
                          title="Copy first sample URL"
                          disabled={!selectedAction.sample_urls?.length}
                        >
                          Copy URL
                        </button>

                        <button
                          className="ph-btn"
                          onClick={() => {
                            const u = selectedAction.sample_urls?.[0] || "";
                            if (u) window.open(u, "_blank", "noopener,noreferrer");
                          }}
                          title="Open first sample URL"
                          disabled={!selectedAction.sample_urls?.length}
                        >
                          Open URL
                        </button>
                      </div>

                      <div className="ph-mono" style={{ fontSize: 12, opacity: 0.9 }}>
                        {selectedAction.key}
                      </div>

                      {scopeBadges.length ? (
                        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {scopeBadges.map((b) => (
                            <span key={b.t} style={pillStyle(b.bg, b.fg)}>
                              {b.t}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="ph-kv" style={{ marginTop: 10 }}>
                        <strong>Count:</strong> {selectedAction.count}
                      </div>
                      <div className="ph-kv">
                        <strong>Avg bytes:</strong> {fmtInt(selectedAction.avg_resp_bytes)}
                      </div>
                      <div className="ph-kv">
                        <strong>Avg time:</strong> {fmtMs(selectedAction.avg_time_ms)} ms
                      </div>
                      <div className="ph-kv">
                        <strong>Has body:</strong> {selectedAction.has_body ? "yes" : "no"}
                      </div>

                      {selectedAction.risk_score !== undefined ? (
                        <div className="ph-kv">
                          <strong>Risk:</strong>{" "}
                          <span style={riskStyle(selectedAction.risk_score)}>{fmtInt(selectedAction.risk_score)}</span>{" "}
                          {Array.isArray(selectedAction.risk_tags) && selectedAction.risk_tags.length
                            ? `(${selectedAction.risk_tags.join(", ")})`
                            : ""}
                        </div>
                      ) : null}

                      {Array.isArray(selectedAction.sample_urls) && selectedAction.sample_urls.length ? (
                        <>
                          <div className="ph-h2" style={{ marginTop: 14 }}>
                            Sample URLs
                          </div>
                          <ul className="ph-list">
                            {selectedAction.sample_urls.slice(0, 10).map((u) => (
                              <li
                                key={u}
                                style={{
                                  wordBreak: "break-all",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 10,
                                }}
                              >
                                <span className="ph-mono" style={{ flex: 1 }}>
                                  {u}
                                </span>
                                <button
                                  className="ph-btn"
                                  onClick={async () => {
                                    const ok = await copyToClipboard(u);
                                    setToast(ok ? "Copied" : "Copy failed");
                                  }}
                                  title="Copy URL"
                                >
                                  Copy
                                </button>
                                <button
                                  className="ph-btn"
                                  onClick={() => window.open(u, "_blank", "noopener,noreferrer")}
                                  title="Open URL"
                                >
                                  Open
                                </button>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}

                      {Array.isArray(selectedAction.top_query_keys) && selectedAction.top_query_keys.length ? (
                        <>
                          <div className="ph-h2" style={{ marginTop: 14 }}>
                            Top query keys
                          </div>
                          <ul className="ph-list">
                            {selectedAction.top_query_keys.slice(0, 16).map((x) => (
                              <li key={x.value}>
                                <span className="ph-mono">{x.value}</span> — {x.count}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}

                      {Array.isArray(selectedAction.top_statuses) && selectedAction.top_statuses.length ? (
                        <>
                          <div className="ph-h2" style={{ marginTop: 14 }}>
                            Top statuses
                          </div>
                          <ul className="ph-list">
                            {selectedAction.top_statuses.slice(0, 12).map((x) => (
                              <li key={String(x.value)}>
                                <span className="ph-mono">{String(x.value)}</span> — {x.count}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}

                      {Array.isArray(selectedAction.top_mimes) && selectedAction.top_mimes.length ? (
                        <>
                          <div className="ph-h2" style={{ marginTop: 14 }}>
                            Top mimes
                          </div>
                          <ul className="ph-list">
                            {selectedAction.top_mimes.slice(0, 12).map((x) => (
                              <li key={x.value}>
                                <span className="ph-mono">{x.value}</span> — {x.count}
                              </li>
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