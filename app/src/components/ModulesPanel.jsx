import React from "react";

export default function ModulesPanel({
  engineOk,
  projectId,
  setupComplete,
  modules,
  modulesBusy,
  runs,
  runsBusy,
  runFindings,
  findingsBusy,
  selectedModuleId,
  selectedModule,
  selectedRunId,
  selectedRun,
  selectedRunSummary,
  moduleRunBusy,
  moduleMinRisk,
  pillStyle,
  runStatusStyle,
  severityStyle,
  safeJsonParse,
  safePrettyJson,
  onRefreshModules,
  onRefreshRuns,
  onSelectModule,
  onSetModuleMinRisk,
  onRunSelectedModule,
  onSelectRun,
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        className="ph-h2"
        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        Modules & Runs
        <span style={pillStyle("#1c2430", "#cfe0ff")}>modules: {modules.length}</span>
        <span style={pillStyle("#1c2430", "#cfe0ff")}>runs: {runs.length}</span>

        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <button className="ph-btn" onClick={onRefreshModules} disabled={!engineOk || modulesBusy}>
            {modulesBusy ? "Loading modules…" : "Refresh modules"}
          </button>
          <button
            className="ph-btn"
            onClick={onRefreshRuns}
            disabled={!engineOk || !projectId || runsBusy || !setupComplete}
          >
            {runsBusy ? "Loading runs…" : "Refresh runs"}
          </button>
        </span>
      </div>

      {!setupComplete ? (
        <div className="ph-small">Finish project setup first, then you can run modules.</div>
      ) : (
        <div className="ph-grid">
          <div className="ph-tableWrap">
            <div className="ph-card" style={{ padding: 12 }}>
              <div className="ph-row" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <select
                  className="ph-select"
                  value={selectedModuleId}
                  onChange={(e) => onSelectModule(e.target.value)}
                  disabled={!modules.length || modulesBusy}
                >
                  <option value="">Select module…</option>
                  {modules.map((m) => (
                    <option key={m.id} value={String(m.id)}>
                      {m.name || m.id}
                    </option>
                  ))}
                </select>

                {selectedModuleId === "risk_digest" ? (
                  <span
                    className="ph-small"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    min risk:
                    <input
                      className="ph-input"
                      style={{ width: 88 }}
                      value={String(moduleMinRisk)}
                      onChange={(e) => onSetModuleMinRisk(e.target.value)}
                      inputMode="numeric"
                    />
                  </span>
                ) : null}

                <button
                  className="ph-btn"
                  onClick={onRunSelectedModule}
                  disabled={!engineOk || !projectId || !selectedModuleId || moduleRunBusy || !setupComplete}
                >
                  {moduleRunBusy ? "Running…" : "Run module"}
                </button>
              </div>

              {selectedModule ? (
                <div style={{ marginTop: 12 }}>
                  <div className="ph-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={pillStyle("#1c2430", "#cfe0ff")}>{selectedModule.id}</span>
                    <span style={pillStyle("#222", "#eee")}>{selectedModule.kind || "module"}</span>
                    {Array.isArray(selectedModule.targets)
                      ? selectedModule.targets.map((t) => (
                          <span key={t} style={pillStyle("#1f2230", "#cfd7ff")}>
                            {t}
                          </span>
                        ))
                      : null}
                  </div>
                  <div className="ph-small" style={{ opacity: 0.9 }}>
                    {selectedModule.description || "No description."}
                  </div>
                </div>
              ) : (
                <div className="ph-small" style={{ marginTop: 12 }}>
                  Select a module to inspect and run it.
                </div>
              )}
            </div>

            <div className="ph-card" style={{ padding: 12, marginTop: 12 }}>
              <div className="ph-h2" style={{ marginBottom: 8 }}>
                Recent runs
              </div>
              {!runs.length ? (
                <div className="ph-small">No runs yet for this project.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {runs.slice(0, 12).map((r) => {
                    const isSel = String(r.id) === String(selectedRunId);
                    const summaryObj = safeJsonParse(r.summary_json || "{}") || {};
                    const findingsCreated = Number(summaryObj?.findings_created || 0);

                    return (
                      <button
                        key={r.id}
                        className="ph-btn"
                        onClick={() => onSelectRun(String(r.id))}
                        style={{
                          justifyContent: "flex-start",
                          textAlign: "left",
                          padding: 10,
                          border: isSel ? "1px solid rgba(120,180,255,0.8)" : undefined,
                        }}
                      >
                        <span
                          className="ph-row"
                          style={{
                            width: "100%",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <span className="ph-mono">#{r.id}</span>
                          <span style={runStatusStyle(r.status)}>{r.status || "unknown"}</span>
                          <span style={pillStyle("#222", "#eee")}>{r.module_id}</span>
                          <span className="ph-small" style={{ opacity: 0.75 }}>
                            findings: {findingsCreated}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="right">
            <div className="ph-card" style={{ padding: 12 }}>
              <div
                className="ph-h2"
                style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
              >
                Run details
                {selectedRun ? (
                  <span style={runStatusStyle(selectedRun.status)}>
                    {selectedRun.status || "unknown"}
                  </span>
                ) : null}
              </div>

              {!selectedRun ? (
                <div className="ph-small">Select a run to inspect its summary and findings.</div>
              ) : (
                <>
                  <div className="ph-kv" style={{ marginTop: 10 }}>
                    <strong>Run ID:</strong> <span className="ph-mono">{selectedRun.id}</span>
                  </div>
                  <div className="ph-kv">
                    <strong>Module:</strong> <span className="ph-mono">{selectedRun.module_id}</span>
                  </div>
                  <div className="ph-kv">
                    <strong>Created:</strong> {selectedRun.created_at || "—"}
                  </div>
                  <div className="ph-kv">
                    <strong>Finished:</strong> {selectedRun.finished_at || "—"}
                  </div>

                  {selectedRun.error ? (
                    <div className="ph-err" style={{ marginTop: 10 }}>
                      <div style={{ fontWeight: 900, marginBottom: 6 }}>Run error</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{selectedRun.error}</div>
                    </div>
                  ) : null}

                  <div className="ph-h2" style={{ marginTop: 14 }}>
                    Summary
                  </div>
                  <pre
                    className="ph-mono"
                    style={{ whiteSpace: "pre-wrap", overflowX: "auto", fontSize: 12 }}
                  >
                    {safePrettyJson(selectedRunSummary)}
                  </pre>

                  <div
                    className="ph-h2"
                    style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8 }}
                  >
                    Findings
                    <span style={pillStyle("#1c2430", "#cfe0ff")}>{runFindings.length}</span>
                  </div>

                  {findingsBusy ? (
                    <div className="ph-small">Loading findings…</div>
                  ) : !runFindings.length ? (
                    <div className="ph-small">No findings for this run.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                      {runFindings.slice(0, 20).map((f) => (
                        <div key={f.id} className="ph-card" style={{ padding: 10 }}>
                          <div
                            className="ph-row"
                            style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}
                          >
                            <span style={severityStyle(f.severity)}>{f.severity || "info"}</span>
                            <span className="ph-mono">#{f.id}</span>
                            <span style={pillStyle("#222", "#eee")}>{f.module_id}</span>
                          </div>
                          <div style={{ fontWeight: 800, marginTop: 8 }}>
                            {f.title || "(untitled finding)"}
                          </div>
                          {f.description ? (
                            <div
                              className="ph-small"
                              style={{ whiteSpace: "pre-wrap", marginTop: 6 }}
                            >
                              {f.description}
                            </div>
                          ) : null}
                          {f.evidence_json ? (
                            <details style={{ marginTop: 8 }}>
                              <summary className="ph-small" style={{ cursor: "pointer" }}>
                                Evidence
                              </summary>
                              <pre
                                className="ph-mono"
                                style={{
                                  whiteSpace: "pre-wrap",
                                  overflowX: "auto",
                                  fontSize: 12,
                                  marginTop: 6,
                                }}
                              >
                                {safePrettyJson(safeJsonParse(f.evidence_json || "{}") || {})}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
