import React from "react";

export default function ActionsToolbar({
  actions,
  filteredActions,
  hasRisk,
  fSourceId,
  pillStyle,
  activeSortExplain,
  exportActions,
  copyJson,
  selectedAction,
  fHost,
  setFHost,
  hostOptions,
  fMethod,
  setFMethod,
  methodOptions,
  fMime,
  setFMime,
  mimeOptions,
  actionSourceOptions,
  setFSourceId,
  searchRef,
  q,
  setQ,
  keyHint,
  setupComplete,
  onlyHasBody,
  setOnlyHasBody,
  minCount,
  setMinCount,
  minRisk,
  setMinRisk,
  resetUi,
  excludedTagSet,
  tagFilterOpen,
  setTagFilterOpen,
  tagFilterPanel,
  defaultCols,
  cols,
  toggleCol,
  riskStyle,
}) {
  return (
    <>
      <div
        className="ph-h2"
        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        Actions
        <span style={pillStyle("#1c2430", "#cfe0ff")}>
          showing {filteredActions.length} / {actions.length}
        </span>
        <span className="ph-small" style={{ opacity: 0.75 }}>
          {activeSortExplain()}
        </span>

        {fSourceId ? (
          <span style={pillStyle("#1f2230", "#cfd7ff")}>source filter: #{fSourceId}</span>
        ) : null}

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
            onClick={() => exportActions(actions, "actions_all")}
            disabled={!actions.length}
          >
            Export all
          </button>
          <button
            className="ph-btn"
            onClick={() => exportActions(filteredActions, "actions_filtered")}
            disabled={!filteredActions.length}
          >
            Export filtered
          </button>
          <button
            className="ph-btn"
            onClick={() => copyJson(filteredActions, "Copied filtered")}
            disabled={!filteredActions.length}
          >
            Copy filtered JSON
          </button>
          <button
            className="ph-btn"
            onClick={() =>
              selectedAction ? copyJson(selectedAction, "Copied action") : null
            }
            disabled={!selectedAction}
          >
            Copy action JSON
          </button>
        </span>
      </div>

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

        <select className="ph-select" value={fSourceId} onChange={(e) => setFSourceId(e.target.value)}>
          <option value="">All sources</option>
          {actionSourceOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ? `${s.name} (#${s.id})` : `Source #${s.id}`}
              {s.kind ? ` · ${s.kind}` : ""}
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
          disabled={!setupComplete}
        />

        <label
          className="ph-small"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <input
            type="checkbox"
            checked={onlyHasBody}
            onChange={(e) => setOnlyHasBody(e.target.checked)}
            disabled={!setupComplete}
          />
          has body
        </label>

        <span
          className="ph-small"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          min count:
          <input
            className="ph-input"
            style={{ width: 88 }}
            value={String(minCount)}
            onChange={(e) =>
              setMinCount(Math.max(0, parseInt(e.target.value || "0", 10) || 0))
            }
            inputMode="numeric"
            disabled={!setupComplete}
          />
        </span>

        {hasRisk ? (
          <span
            className="ph-small"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            min risk:
            <input
              className="ph-input"
              style={{ width: 88 }}
              value={String(minRisk)}
              onChange={(e) =>
                setMinRisk(Math.max(0, parseInt(e.target.value || "0", 10) || 0))
              }
              inputMode="numeric"
              disabled={!setupComplete}
            />
          </span>
        ) : null}

        <button className="ph-btn" onClick={resetUi} disabled={!setupComplete}>
          Reset UI
        </button>

        <button
          className={`ph-btn ${excludedTagSet.size ? "ph-btn-active" : ""}`}
          onClick={() => setTagFilterOpen((v) => !v)}
          disabled={!setupComplete}
        >
          Tag filters{excludedTagSet.size ? ` (${excludedTagSet.size} hidden)` : ""}
        </button>

        <div className="ph-small" style={{ marginLeft: "auto", opacity: 0.75 }}>
          {keyHint}
        </div>
      </div>

      {tagFilterPanel}

      <div
        className="ph-row"
        style={{ marginBottom: 10, alignItems: "center", flexWrap: "wrap", gap: 8 }}
      >
        <span className="ph-small" style={{ fontWeight: 800, opacity: 0.75 }}>
          Columns:
        </span>

        {Object.keys(defaultCols).map((k) => {
          if (k === "risk" && !hasRisk) return null;
          return (
            <label
              key={k}
              className="ph-small"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <input
                type="checkbox"
                checked={!!cols[k]}
                onChange={() => toggleCol(k)}
                disabled={!setupComplete}
              />
              {k}
            </label>
          );
        })}

        {hasRisk ? (
          <span
            className="ph-small"
            style={{ marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 10 }}
          >
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
    </>
  );
}
