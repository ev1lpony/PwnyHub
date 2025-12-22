import React, { useEffect, useMemo, useState } from "react";

const DEFAULT_ENGINE = "http://127.0.0.1:8787";

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

function asPairs(objOrPairs) {
  // Accept either:
  //  - { "a": 1, "b": 2 }
  //  - [ ["a", 1], ["b", 2] ]
  if (!objOrPairs) return [];
  if (Array.isArray(objOrPairs)) return objOrPairs;
  if (typeof objOrPairs === "object") return Object.entries(objOrPairs);
  return [];
}

export default function App() {
  const [engineUrl, setEngineUrl] = useState(
    import.meta?.env?.VITE_ENGINE_URL || DEFAULT_ENGINE
  );

  const [engineOk, setEngineOk] = useState(false);
  const [engineErr, setEngineErr] = useState("");

  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [file, setFile] = useState(null);

  const [summary, setSummary] = useState(null);
  const [actions, setActions] = useState([]);
  const [selectedActionKey, setSelectedActionKey] = useState("");

  const [busy, setBusy] = useState(false);
  const [busyActions, setBusyActions] = useState(false);
  const [msg, setMsg] = useState("");

  // Filters
  const [fHost, setFHost] = useState("");
  const [fMethod, setFMethod] = useState("");
  const [fMime, setFMime] = useState("");
  const [q, setQ] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState("count_desc"); // count_desc | time_desc | bytes_desc | risk_desc

  // Engine feature toggles
  const [includeRisk, setIncludeRisk] = useState(true);
  const [includeAssets, setIncludeAssets] = useState(false);

  // --- engine health poll ---
  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const data = await jfetch(`${engineUrl}/health`);
        if (!cancelled) {
          setEngineOk(!!data?.ok);
          setEngineErr("");
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

  const selectedAction = useMemo(() => {
    return actions.find((a) => a.key === selectedActionKey) || null;
  }, [actions, selectedActionKey]);

  const hasRisk = useMemo(() => {
    return actions.some(
      (a) => a && a.risk_score !== undefined && a.risk_score !== null
    );
  }, [actions]);

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
    const qq = q.trim().toLowerCase();
    let list = actions
      .filter((a) => (fHost ? a.host === fHost : true))
      .filter((a) => (fMethod ? a.method === fMethod : true))
      .filter((a) => (fMime ? a.top_mime === fMime : true))
      .filter((a) => {
        if (!qq) return true;
        return (
          (a.host || "").toLowerCase().includes(qq) ||
          (a.path_template || "").toLowerCase().includes(qq) ||
          (a.method || "").toLowerCase().includes(qq) ||
          (a.top_mime || "").toLowerCase().includes(qq) ||
          (a.key || "").toLowerCase().includes(qq)
        );
      });

    // Sort
    const cmp = (A, B) => {
      if (sortKey === "time_desc") {
        return (
          Number(B.avg_time_ms || 0) - Number(A.avg_time_ms || 0) ||
          B.count - A.count
        );
      }
      if (sortKey === "bytes_desc") {
        return (
          Number(B.avg_resp_bytes || 0) - Number(A.avg_resp_bytes || 0) ||
          B.count - A.count
        );
      }
      if (sortKey === "risk_desc") {
        return (
          Number(B.risk_score || 0) - Number(A.risk_score || 0) ||
          B.count - A.count
        );
      }
      // default count desc
      return (
        B.count - A.count ||
        Number(B.avg_time_ms || 0) - Number(A.avg_time_ms || 0)
      );
    };

    list = list.slice().sort(cmp);

    return list.slice(0, 500); // keep UI snappy
  }, [actions, fHost, fMethod, fMime, q, sortKey]);

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
  }, [fHost, fMethod, fMime, q, actions.length, sortKey]);

  async function refreshSummary(pid) {
    const p = pid || projectId;
    if (!p) return;
    const data = await jfetch(
      `${engineUrl}/summary?project_id=${encodeURIComponent(p)}`
    );
    setSummary(data);
  }

  async function loadActions(pid, opts = {}) {
    const p = pid || projectId;
    if (!p) return;

    const useRisk =
      opts.includeRisk !== undefined ? !!opts.includeRisk : !!includeRisk;

    setBusyActions(true);
    try {
      const data = await jfetch(
        `${engineUrl}/actions?project_id=${encodeURIComponent(
          p
        )}&include_risk=${useRisk ? "true" : "false"}`
      );
      const list = Array.isArray(data?.actions) ? data.actions : [];
      setActions(list);
      setSelectedActionKey((prev) => prev || list[0]?.key || "");
      setMsg(`Loaded ${list.length} actions.`);
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
        scope_allow: "example.com\nlocalhost",
        scope_deny: "",
        qps: 3.0,
      };
      const created = await jfetch(`${engineUrl}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const newList = await jfetch(`${engineUrl}/projects`);
      setProjects(newList);
      setProjectId(
        String(created?.id || created?.project?.id || newList?.[0]?.id || "")
      );
      setMsg("Created demo project.");
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
      const fd = new FormData();
      fd.append("project_id", projectId);
      fd.append("file", file);
      if (includeAssets) fd.append("include_assets", "true");

      await jfetch(`${engineUrl}/import/har`, {
        method: "POST",
        body: fd,
      });

      setMsg("Imported HAR. Refreshing summary + actions...");
      await refreshSummary(projectId);
      await loadActions(projectId);
    } catch (e) {
      setMsg(`Import failed: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  }

  const summaryHosts = useMemo(() => {
    return asPairs(summary?.hosts).slice(0, 20);
  }, [summary]);

  const summaryMimes = useMemo(() => {
    return asPairs(summary?.mimes).slice(0, 20);
  }, [summary]);

  return (
    <div className="ph-wrap">
      <h1 style={{ marginBottom: 6 }}>PwnyHub</h1>
      <div className="ph-sub">
        Standalone hub (Electron UI) + engine (FastAPI). MVP: HAR import → normalize → summarize → actions.
      </div>

      <div className="ph-card">
        {/* Top controls */}
        <div className="ph-topbar">
          <div className="ph-row">
            <span className="ph-pill">
              <strong>Engine:</strong>{" "}
              <span className={engineOk ? "ok" : "down"}>
                {engineOk ? "OK" : "Down"}
              </span>
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

            <button
              className="ph-btn"
              onClick={createDemoProject}
              disabled={!engineOk || busy}
            >
              Create demo project
            </button>

            <select
              className="ph-select"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setSummary(null);
                setActions([]);
                setSelectedActionKey("");
                setMsg("");
              }}
              disabled={!engineOk}
            >
              <option value="">Select project…</option>
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name} (id={p.id})
                </option>
              ))}
            </select>

            <input
              className="ph-input"
              type="file"
              accept=".har,application/json"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              disabled={!engineOk}
            />

            <button
              className="ph-btn"
              onClick={importHar}
              disabled={!engineOk || busy || !projectId || !file}
            >
              {busy ? "Working…" : "Import HAR"}
            </button>

            <button
              className="ph-btn"
              onClick={() => refreshSummary()}
              disabled={!engineOk || !projectId || busy}
            >
              Refresh summary
            </button>

            <button
              className="ph-btn"
              onClick={() => loadActions()}
              disabled={!engineOk || !projectId || busyActions}
            >
              {busyActions ? "Loading…" : "Load actions"}
            </button>
          </div>

          {/* Engine knobs */}
          <div className="ph-row" style={{ marginTop: 10 }}>
            <label className="ph-small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={includeRisk}
                onChange={(e) => setIncludeRisk(!!e.target.checked)}
              />
              Include risk scoring
            </label>

            <label className="ph-small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={includeAssets}
                onChange={(e) => setIncludeAssets(!!e.target.checked)}
              />
              Include assets on import
            </label>

            <button
              className="ph-btn"
              onClick={() => loadActions(projectId, { includeRisk })}
              disabled={!engineOk || !projectId || busyActions}
              title="Reload actions using current toggles"
            >
              Reload actions (toggles)
            </button>

            <div className="ph-small" style={{ marginLeft: "auto" }}>
              Risk in dataset: <strong>{hasRisk ? "yes" : "no"}</strong>
            </div>
          </div>
        </div>

        {/* Errors / messages */}
        {!engineOk && engineErr ? (
          <div className="ph-err">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Engine error</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{engineErr}</div>
          </div>
        ) : null}

        {msg ? <div className="ph-msg">{msg}</div> : null}

        <div className="ph-content">
          {/* Summary */}
          {summary ? (
            <div style={{ marginBottom: 16 }}>
              <div className="ph-h2">Summary</div>
              <div className="ph-kv">
                <strong>Entries stored:</strong>{" "}
                {summary.entries ?? summary.entries_stored ?? "?"}
              </div>

              {summaryHosts.length ? (
                <>
                  <div className="ph-h2" style={{ marginTop: 14 }}>
                    Top hosts
                  </div>
                  <ul className="ph-list">
                    {summaryHosts.map(([k, v]) => (
                      <li key={k}>
                        <span className="ph-mono">{k}</span> — {v}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {summaryMimes.length ? (
                <>
                  <div className="ph-h2" style={{ marginTop: 14 }}>
                    Top MIME types
                  </div>
                  <ul className="ph-list">
                    {summaryMimes.map(([k, v]) => (
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
            <div className="ph-h2">Actions</div>

            {/* Filters */}
            <div className="ph-row" style={{ marginBottom: 10 }}>
              <select
                className="ph-select"
                value={fHost}
                onChange={(e) => setFHost(e.target.value)}
              >
                <option value="">All hosts</option>
                {hostOptions.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>

              <select
                className="ph-select"
                value={fMethod}
                onChange={(e) => setFMethod(e.target.value)}
              >
                <option value="">All methods</option>
                {methodOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <select
                className="ph-select"
                value={fMime}
                onChange={(e) => setFMime(e.target.value)}
              >
                <option value="">All MIME</option>
                {mimeOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <input
                className="ph-input"
                placeholder="Search host/path/mime…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ width: 320 }}
              />

              <select
                className="ph-select"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                title="Sort"
              >
                <option value="count_desc">Sort: Count</option>
                <option value="time_desc">Sort: Avg ms</option>
                <option value="bytes_desc">Sort: Avg bytes</option>
                <option value="risk_desc">Sort: Risk</option>
              </select>

              <button
                className="ph-btn"
                onClick={() => {
                  setFHost("");
                  setFMethod("");
                  setFMime("");
                  setQ("");
                }}
              >
                Clear
              </button>

              <div className="ph-small" style={{ marginLeft: "auto" }}>
                Showing <strong>{filteredActions.length}</strong> / {actions.length}
              </div>
            </div>

            {actions.length === 0 ? (
              <div className="ph-small">
                No actions loaded yet. Import a HAR or click “Load actions”.
              </div>
            ) : (
              <div className="ph-grid">
                {/* Table */}
                <div className="ph-tableWrap">
                  <div className="ph-tableScroll">
                    <table className="ph-table">
                      <thead>
                        <tr>
                          {[
                            "Count",
                            "Method",
                            "Host",
                            "Path template",
                            "Top MIME",
                            "Statuses",
                            "Avg bytes",
                            "Avg ms",
                            "Body?",
                            "Risk",
                          ].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredActions.map((a) => {
                          const isSel = a.key === selectedActionKey;
                          return (
                            <tr
                              key={a.key}
                              onClick={() => setSelectedActionKey(a.key)}
                              className={`ph-tr ${isSel ? "selected" : ""}`}
                            >
                              <td>{a.count}</td>
                              <td>{a.method}</td>
                              <td>{a.host}</td>
                              <td className="ph-mono">{a.path_template}</td>
                              <td>{a.top_mime}</td>
                              <td>
                                {(a.status_codes || []).slice(0, 5).join(", ")}
                                {(a.status_codes || []).length > 5 ? "…" : ""}
                              </td>
                              <td>{fmtInt(a.avg_resp_bytes)}</td>
                              <td>{fmtMs(a.avg_time_ms)}</td>
                              <td>{a.has_body ? "yes" : ""}</td>
                              <td>{fmtInt(a.risk_score)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Details */}
                <div className="right">
                  <div className="ph-h2">Details</div>
                  {!selectedAction ? (
                    <div className="ph-small">Click an action row.</div>
                  ) : (
                    <>
                      <div className="ph-mono" style={{ fontSize: 12 }}>
                        {selectedAction.key}
                      </div>

                      <div className="ph-kv">
                        <strong>Count:</strong> {selectedAction.count}
                      </div>
                      <div className="ph-kv">
                        <strong>Avg bytes:</strong>{" "}
                        {fmtInt(selectedAction.avg_resp_bytes)}
                      </div>
                      <div className="ph-kv">
                        <strong>Avg time:</strong>{" "}
                        {fmtMs(selectedAction.avg_time_ms)} ms
                      </div>
                      <div className="ph-kv">
                        <strong>Has body:</strong>{" "}
                        {selectedAction.has_body ? "yes" : "no"}
                      </div>

                      <div className="ph-kv">
                        <strong>Risk:</strong> {fmtInt(selectedAction.risk_score)}{" "}
                        {Array.isArray(selectedAction.risk_tags) &&
                        selectedAction.risk_tags.length
                          ? `(${selectedAction.risk_tags.join(", ")})`
                          : ""}
                      </div>

                      {Array.isArray(selectedAction.sample_urls) &&
                      selectedAction.sample_urls.length ? (
                        <>
                          <div className="ph-h2" style={{ marginTop: 14 }}>
                            Sample URLs
                          </div>
                          <ul className="ph-list">
                            {selectedAction.sample_urls.slice(0, 6).map((u) => (
                              <li key={u} style={{ wordBreak: "break-all" }}>
                                <span className="ph-mono">{u}</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}

                      {Array.isArray(selectedAction.top_query_keys) &&
                      selectedAction.top_query_keys.length ? (
                        <>
                          <div className="ph-h2" style={{ marginTop: 14 }}>
                            Top query keys
                          </div>
                          <ul className="ph-list">
                            {selectedAction.top_query_keys.slice(0, 12).map((x) => (
                              <li key={x.value}>
                                <span className="ph-mono">{x.value}</span> —{" "}
                                {x.count}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}

                      {Array.isArray(selectedAction.top_statuses) &&
                      selectedAction.top_statuses.length ? (
                        <>
                          <div className="ph-h2" style={{ marginTop: 14 }}>
                            Top statuses
                          </div>
                          <ul className="ph-list">
                            {selectedAction.top_statuses.slice(0, 10).map((x) => (
                              <li key={String(x.value)}>
                                <span className="ph-mono">{String(x.value)}</span>{" "}
                                — {x.count}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}

                      {Array.isArray(selectedAction.top_mimes) &&
                      selectedAction.top_mimes.length ? (
                        <>
                          <div className="ph-h2" style={{ marginTop: 14 }}>
                            Top mimes
                          </div>
                          <ul className="ph-list">
                            {selectedAction.top_mimes.slice(0, 10).map((x) => (
                              <li key={x.value}>
                                <span className="ph-mono">{x.value}</span> —{" "}
                                {x.count}
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
            Tip: This is organizer/intel mode only — no replay, no fuzzing.
            Modules come later.
          </div>
        </div>
      </div>
    </div>
  );
}
