import React from "react";

export default function SourcesPanel({
  engineOk,
  projectId,
  setupComplete,
  sources,
  sourcesBusy,
  selectedSourceId,
  selectedSource,
  fSourceId,
  pillStyle,
  sourceStatusStyle,
  fmtInt,
  safePrettyJson,
  onRefreshSources,
  onSelectSource,
  onFilterToSource,
  onClearSourceFilter,
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        className="ph-h2"
        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        Sources / Ingest
        <span style={pillStyle("#1c2430", "#cfe0ff")}>sources: {sources.length}</span>

        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <button
            className="ph-btn"
            onClick={onRefreshSources}
            disabled={!engineOk || !projectId || sourcesBusy || !setupComplete}
          >
            {sourcesBusy ? "Loading sources…" : "Refresh sources"}
          </button>
        </span>
      </div>

      {!setupComplete ? (
        <div className="ph-small">
          Finish project setup first, then you can inspect project sources.
        </div>
      ) : (
        <div className="ph-grid">
          <div className="ph-tableWrap">
            <div className="ph-card" style={{ padding: 12 }}>
              <div className="ph-h2" style={{ marginBottom: 8 }}>
                Project sources
              </div>

              {!sources.length ? (
                <div className="ph-small">
                  No sources yet for this project. Import a HAR to create the first source.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {sources.slice(0, 20).map((s) => {
                    const isSel = String(s.id) === String(selectedSourceId);
                    return (
                      <button
                        key={s.id}
                        className="ph-btn"
                        onClick={() => onSelectSource(String(s.id))}
                        style={{
                          justifyContent: "flex-start",
                          textAlign: "left",
                          padding: 10,
                          border: isSel
                            ? "1px solid rgba(120,180,255,0.8)"
                            : undefined,
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
                          <span className="ph-mono">#{s.id}</span>
                          <span style={sourceStatusStyle(s.status)}>
                            {s.status || "unknown"}
                          </span>
                          <span style={pillStyle("#222", "#eee")}>
                            {s.kind || "source"}
                          </span>
                          <span style={{ fontWeight: 800 }}>
                            {s.name || "(unnamed source)"}
                          </span>
                          <span className="ph-small" style={{ opacity: 0.75 }}>
                            entries: {fmtInt(s.entry_count)}
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
            <div className="ph-card" style={{ padding: 12 }} id="ph-source-details">
              <div
                className="ph-h2"
                style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
              >
                Source details
                {selectedSource ? (
                  <span style={sourceStatusStyle(selectedSource.status)}>
                    {selectedSource.status || "unknown"}
                  </span>
                ) : null}
              </div>

              {!selectedSource ? (
                <div className="ph-small">
                  Select a source to inspect its ingest details.
                </div>
              ) : (
                <>
                  <div className="ph-kv" style={{ marginTop: 10 }}>
                    <strong>Source ID:</strong>{" "}
                    <span className="ph-mono">{selectedSource.id}</span>
                  </div>
                  <div className="ph-kv">
                    <strong>Name:</strong> {selectedSource.name || "—"}
                  </div>
                  <div className="ph-kv">
                    <strong>Kind:</strong>{" "}
                    <span className="ph-mono">{selectedSource.kind || "—"}</span>
                  </div>
                  <div className="ph-kv">
                    <strong>Entries:</strong> {fmtInt(selectedSource.entry_count)}
                  </div>
                  <div className="ph-kv">
                    <strong>Created:</strong> {selectedSource.created_at || "—"}
                  </div>
                  <div className="ph-kv">
                    <strong>Finished:</strong> {selectedSource.finished_at || "—"}
                  </div>

                  <div
                    className="ph-row"
                    style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}
                  >
                    <button
                      className="ph-btn"
                      onClick={() => onFilterToSource(selectedSource.id)}
                    >
                      Filter actions to this source
                    </button>
                    <button
                      className="ph-btn"
                      onClick={onClearSourceFilter}
                      disabled={!fSourceId}
                    >
                      Clear source filter
                    </button>
                  </div>

                  {selectedSource.error ? (
                    <div className="ph-err" style={{ marginTop: 10 }}>
                      <div style={{ fontWeight: 900, marginBottom: 6 }}>
                        Source error
                      </div>
                      <div style={{ whiteSpace: "pre-wrap" }}>
                        {selectedSource.error}
                      </div>
                    </div>
                  ) : null}

                  <div className="ph-h2" style={{ marginTop: 14 }}>
                    Metadata
                  </div>
                  <pre
                    className="ph-mono"
                    style={{
                      whiteSpace: "pre-wrap",
                      overflowX: "auto",
                      fontSize: 12,
                    }}
                  >
                    {safePrettyJson(selectedSource.metadata || {})}
                  </pre>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}