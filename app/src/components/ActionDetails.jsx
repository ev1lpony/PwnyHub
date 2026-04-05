import React from "react";

export default function ActionDetails({
  selectedAction,
  scopeBadges,
  pillStyle,
  riskStyle,
  fmtInt,
  fmtMs,
  copyToClipboard,
  setToast,
  fSourceId,
  setFSourceId,
  getSourceDisplay,
  sourceStatusStyle,
  inspectSourceId,
  filterToSourceId,
}) {
  return (
    <div className="right" id="ph-details">
      <div className="ph-h2" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        Details
        {selectedAction?.risk_score !== undefined ? (
          <span style={riskStyle(selectedAction.risk_score)}>
            {fmtInt(selectedAction.risk_score)}
          </span>
        ) : null}
      </div>

      {!selectedAction ? (
        <div className="ph-small">Click an action row.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <button
              className="ph-btn"
              onClick={() =>
                copyToClipboard(selectedAction.key).then((ok) =>
                  setToast(ok ? "Copied key" : "Copy failed")
                )
              }
            >
              Copy key
            </button>
            <button
              className="ph-btn"
              disabled={!selectedAction.host}
              onClick={() =>
                copyToClipboard(selectedAction.host || "").then((ok) =>
                  setToast(ok ? "Copied host" : "Copy failed")
                )
              }
            >
              Copy host
            </button>
            <button
              className="ph-btn"
              disabled={!selectedAction.path_template}
              onClick={() =>
                copyToClipboard(selectedAction.path_template || "").then((ok) =>
                  setToast(ok ? "Copied path" : "Copy failed")
                )
              }
            >
              Copy path
            </button>
            <button
              className="ph-btn"
              disabled={!selectedAction.sample_urls?.length}
              onClick={() =>
                copyToClipboard(selectedAction.sample_urls?.[0] || "").then((ok) =>
                  setToast(ok ? "Copied URL" : "Copy failed")
                )
              }
            >
              Copy URL
            </button>
            <button
              className="ph-btn"
              disabled={!selectedAction.sample_urls?.length}
              onClick={() => {
                const u = selectedAction.sample_urls?.[0] || "";
                if (u) window.open(u, "_blank", "noopener,noreferrer");
              }}
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
          <div className="ph-kv">
            <strong>Source count:</strong> {fmtInt(selectedAction.source_count || 0)}
          </div>

          {Array.isArray(selectedAction.source_kinds) && selectedAction.source_kinds.length ? (
            <div className="ph-kv">
              <strong>Source kinds:</strong>{" "}
              {selectedAction.source_kinds.map((k) => (
                <span key={k} style={{ ...pillStyle("#222", "#eee"), marginRight: 6 }}>
                  {k}
                </span>
              ))}
            </div>
          ) : null}

          {selectedAction.risk_score !== undefined ? (
            <div className="ph-kv">
              <strong>Risk:</strong>{" "}
              <span style={riskStyle(selectedAction.risk_score)}>
                {fmtInt(selectedAction.risk_score)}
              </span>{" "}
              {Array.isArray(selectedAction.risk_tags) && selectedAction.risk_tags.length
                ? `(${selectedAction.risk_tags.join(", ")})`
                : ""}
            </div>
          ) : null}

          {selectedAction?.ml_confidence !== undefined && (
            <div className="ph-kv">
              <strong>ML Confidence:</strong>{" "}
              {(selectedAction.ml_confidence * 100).toFixed(0)}%
              {selectedAction.risk_tags?.includes("ml-boosted") && (
                <span style={pillStyle("#1f2c1f", "#c9ffd0")}>ml-boosted</span>
              )}
            </div>
          )}

          {Array.isArray(selectedAction.top_sources) && selectedAction.top_sources.length ? (
            <>
              <div
                className="ph-h2"
                style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
              >
                Top sources
                {fSourceId ? (
                  <button className="ph-btn" onClick={() => setFSourceId("")}>
                    Clear source filter
                  </button>
                ) : null}
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {selectedAction.top_sources.slice(0, 12).map((ts) => {
                  const meta = getSourceDisplay(ts.source_id, ts);
                  return (
                    <div key={String(ts.source_id)} className="ph-card" style={{ padding: 10 }}>
                      <div className="ph-row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="ph-mono">#{ts.source_id}</span>
                        {meta.status ? (
                          <span style={sourceStatusStyle(meta.status)}>{meta.status}</span>
                        ) : null}
                        {meta.kind ? <span style={pillStyle("#222", "#eee")}>{meta.kind}</span> : null}
                        <span style={{ fontWeight: 800 }}>
                          {meta.name || `Source #${ts.source_id}`}
                        </span>
                        <span className="ph-small" style={{ opacity: 0.75 }}>
                          action hits: {fmtInt(ts.count)}
                        </span>
                        {meta.entry_count ? (
                          <span className="ph-small" style={{ opacity: 0.75 }}>
                            source entries: {fmtInt(meta.entry_count)}
                          </span>
                        ) : null}
                      </div>

                      <div className="ph-row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                        <button className="ph-btn" onClick={() => inspectSourceId(ts.source_id)}>
                          Inspect source
                        </button>
                        <button className="ph-btn" onClick={() => filterToSourceId(ts.source_id)}>
                          Filter to source
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
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
                    style={{ wordBreak: "break-all", display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span className="ph-mono" style={{ flex: 1 }}>
                      {u}
                    </span>
                    <button
                      className="ph-btn"
                      onClick={() =>
                        copyToClipboard(u).then((ok) => setToast(ok ? "Copied" : "Copy failed"))
                      }
                    >
                      Copy
                    </button>
                    <button
                      className="ph-btn"
                      onClick={() => window.open(u, "_blank", "noopener,noreferrer")}
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
  );
}
