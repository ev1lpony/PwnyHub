import React from "react";

export default function TopControlsBar({
  engineOk,
  engineErr,
  engineAgo,
  engineUrl,
  setEngineUrl,
  createDemoProject,
  busy,
  projects,
  projectId,
  setProjectId,
  setSummary,
  setActions,
  setSelectedActionKey,
  setSelectedRunId,
  setSelectedSourceId,
  setFSourceId,
  setMsg,
  projectCfg,
  openWizardFromCfg,
  setWizardOpen,
  setToast,
  autoLoadOnProjectSelect,
  setAutoLoadOnProjectSelect,
  setupComplete,
  focusMode,
  setFocusMode,
  setFile,
  sourceName,
  setSourceName,
  includeAssets,
  setIncludeAssets,
  includeRisk,
  setIncludeRisk,
  mlEnabled,
  toggleMlRisk,
  importHar,
  refreshSummary,
  loadActions,
  busyActions,
  file,
}) {
  return (
    <>
      <div className="ph-topbar">
        <div className="ph-row" style={{ alignItems: "center" }}>
          <span className="ph-pill" title={engineOk ? `Last OK: ${engineAgo}` : "Engine down"}>
            <strong>Engine:</strong>{" "}
            <span className={engineOk ? "ok" : "down"}>{engineOk ? "OK" : "Down"}</span>{" "}
            {engineOk && engineAgo ? (
              <span style={{ opacity: 0.7, marginLeft: 8 }}>{engineAgo}</span>
            ) : null}
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

          <label
            className="ph-small"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <input
              type="checkbox"
              checked={autoLoadOnProjectSelect}
              onChange={(e) => setAutoLoadOnProjectSelect(e.target.checked)}
              disabled={!setupComplete}
              title={!setupComplete ? "Complete setup first" : ""}
            />
            Auto-load
          </label>

          <label
            className="ph-small"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
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
            title={!setupComplete ? "Complete setup first" : "Friendly label for this import source"}
          />

          <label
            className="ph-small"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <input
              type="checkbox"
              checked={includeAssets}
              onChange={(e) => setIncludeAssets(e.target.checked)}
              disabled={!setupComplete}
              title={!setupComplete ? "Complete setup first" : ""}
            />
            include assets
          </label>

          <label
            className="ph-small"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <input
              type="checkbox"
              checked={includeRisk}
              onChange={(e) => setIncludeRisk(e.target.checked)}
              disabled={!setupComplete}
              title={!setupComplete ? "Complete setup first" : ""}
            />
            include risk
          </label>

          <label
            className="ph-small"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <input
              type="checkbox"
              checked={mlEnabled}
              onChange={toggleMlRisk}
              disabled={!engineOk || !setupComplete}
            />
            ML Risk Scoring
            {mlEnabled ? <span className="ph-pill">ON</span> : null}
          </label>

          <button
            className="ph-btn"
            onClick={importHar}
            disabled={!engineOk || busy || !projectId || !file || !setupComplete}
            title={!setupComplete ? "Complete setup first" : "Import HAR into selected project"}
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
            disabled={!engineOk || !projectId || busyActions || !setupComplete}
            title={!setupComplete ? "Complete setup first" : "Load actions"}
          >
            {busyActions ? "Loading…" : "Load actions"}
          </button>
        </div>
      </div>

      {!engineOk && engineErr ? (
        <div className="ph-err">
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Engine error</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{engineErr}</div>
        </div>
      ) : null}
    </>
  );
}
