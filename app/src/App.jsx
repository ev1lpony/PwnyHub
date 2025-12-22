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
    return actions
      .filter((a) => (fHost ? a.host === fHost : true))
      .filter((a) => (fMethod ? a.method === fMethod : true))
      .filter((a) => (fMime ? a.top_mime === fMime : true))
      .filter((a) => {
        if (!qq) return true;
        return (
          (a.host || "").toLowerCase().includes(qq) ||
          (a.path_template || "").toLowerCase().includes(qq) ||
          (a.method || "").toLowerCase().includes(qq) ||
          (a.top_mime || "").toLowerCase().includes(qq)
        );
      })
      .slice(0, 500); // keep UI snappy
  }, [actions, fHost, fMethod, fMime, q]);

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
  }, [fHost, fMethod, fMime, q, actions.length]);

  async function refreshSummary(pid) {
    const p = pid || projectId;
    if (!p) return;
    const data = await jfetch(
      `${engineUrl}/summary?project_id=${encodeURIComponent(p)}`
    );
    setSummary(data);
  }

  async function loadActions(pid) {
    const p = pid || projectId;
    if (!p) return;
    setBusyActions(true);
    try {
      const data = await jfetch(
        `${engineUrl}/actions?project_id=${encodeURIComponent(p)}`
      );
      const list = Array.isArray(data?.actions) ? data.actions : [];
      setActions(list);
      setSelectedActionKey(list[0]?.key || "");
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

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Copied to clipboard.");
    } catch {
      setMsg("Clipboard copy failed (browser blocked it).");
    }
  }

  function curlSkeleton(a) {
    if (!a) return "";
    const url = `https://${a.host}${a.path_template}`;
    return `curl -i -X ${a.method} '${url}'`;
  }

  return (
    <div className="ph-wrap">
      <h1 style={{ marginBottom: 6 }}>PwnyHub</h1>
      <div className="ph-sub">
        Standalone hub (Electron UI) + engine (FastAPI). MVP: HAR import → normalize
        → summarize → actions.
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
                setFHost("");
                setFMethod("");
                setFMime("");
                setQ("");
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

              {summary.hosts ? (
                <>
                  <div className="ph-h2" style={{ marginTop: 14 }}>
                    Top hosts
                  </div>
                  <ul className="ph-list">
                    {Object.entries(summary.hosts)
                      .slice(0, 20)
                      .map(([k, v]) => (
                        <li key={k}>
                          <span className="ph-mono">{k}</span> — {v}
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}

              {summary.mimes ? (
                <>
                  <div className="ph-h2" style={{ marginTop: 14 }}>
                    Top MIME types
                  </div>
                  <ul className="ph-list">
                    {Object.entries(summary.mimes)
                      .slice(0, 20)
                      .map(([k, v]) => (
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
                              <td>{a.avg_resp_bytes}</td>
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
                        <strong>Host:</strong>{" "}
                        <span className="ph-mono">{selectedAction.host}</span>
                      </div>

                      <div className="ph-kv">
                        <strong>Path:</strong>{" "}
                        <span className="ph-mono">{selectedAction.path_template}</span>
                      </div>

                      <div className="ph-kv">
                        <strong>MIME:</strong> {selectedAction.top_mime}
                      </div>

                      <div className="ph-kv">
                        <strong>Avg bytes:</strong> {selectedAction.avg_resp_bytes}
                      </div>

                      <div className="ph-kv">
                        <strong>Status codes:</strong>{" "}
                        {(selectedAction.status_codes || []).join(", ") || "—"}
                      </div>

                      <div className="ph-kv">
                        <strong>Query keys:</strong>{" "}
                        {(selectedAction.query_keys || []).slice(0, 20).join(", ") ||
                          "—"}
                      </div>

                      <div className="ph-row" style={{ marginTop: 10 }}>
                        <button
                          className="ph-btn"
                          onClick={() => copyToClipboard(curlSkeleton(selectedAction))}
                        >
                          Copy curl skeleton
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 16 }} className="ph-small">
            Tip: This is organizer/intel mode only — no replay, no fuzzing. Modules
            come later.
          </div>
        </div>
      </div>
    </div>
  );
}
