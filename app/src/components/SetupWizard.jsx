import React from "react";

export default function SetupWizard({
  open,
  modal = true,
  setupComplete,
  wizardCanClose,
  projectCfg,
  projectId,
  wizardErr,
  wizardSaving,
  wizardDirty,
  engineOk,
  wizAllowText,
  setWizAllowText,
  wizDenyText,
  setWizDenyText,
  wizQps,
  setWizQps,
  wizRoeText,
  setWizRoeText,
  wizUseAdvanced,
  setWizUseAdvanced,
  setWizardDirty,
  pillStyle,
  parseLinesToList,
  subtitle,
  tip,
  saveLabel = "Finish setup",
  onClose,
  onLoadDefaultRoe,
  onSave,
  onValidate,
}) {
  if (!open) return null;

  const markDirty = () => {
    if (typeof setWizardDirty === "function") {
      setWizardDirty(true);
    }
  };

  const card = (
    <div
      className="ph-card"
      style={{
        width: modal ? "min(980px, 96vw)" : "100%",
        marginTop: modal ? 22 : 0,
        boxShadow: modal ? "0 16px 60px rgba(0,0,0,0.35)" : undefined,
        padding: 14,
      }}
      onMouseDown={modal ? (e) => e.stopPropagation() : undefined}
    >
      <div
        className="ph-h2"
        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        Setup Wizard
        {!setupComplete ? <span style={pillStyle("#2a2020", "#ffd2d2")}>Required</span> : null}
        <span style={{ marginLeft: "auto", opacity: 0.75 }} className="ph-small">
          Project: {projectCfg?.project?.name || `id=${projectId || "?"}`}
        </span>
      </div>

      <div className="ph-small" style={{ opacity: 0.85, marginBottom: 10 }}>
        {subtitle || (
          <>
            Set <strong>scope</strong> and <strong>ROE</strong> first.
          </>
        )}
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
            One per line. Examples: <span className="ph-mono">example.com</span>{" "}
            <span className="ph-mono">*.example.com</span>
          </div>
          <textarea
            className="ph-input"
            style={{
              width: "100%",
              minHeight: 140,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
            value={wizAllowText}
            onChange={(e) => {
              setWizAllowText(e.target.value);
              markDirty();
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
            style={{
              width: "100%",
              minHeight: 90,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
            value={wizDenyText}
            onChange={(e) => {
              setWizDenyText(e.target.value);
              markDirty();
            }}
            placeholder={"cdn.example.com\n*.doubleclick.net"}
          />

          <div className="ph-row" style={{ marginTop: 12, alignItems: "center" }}>
            <span
              className="ph-small"
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              QPS (global):
              <input
                className="ph-input"
                style={{ width: 120 }}
                value={wizQps}
                onChange={(e) => {
                  setWizQps(e.target.value);
                  markDirty();
                }}
                inputMode="decimal"
              />
            </span>

            <button className="ph-btn" onClick={onLoadDefaultRoe} disabled={!engineOk || wizardSaving}>
              Load ROE defaults
            </button>

            <label
              className="ph-small"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <input
                type="checkbox"
                checked={wizUseAdvanced}
                onChange={(e) => {
                  setWizUseAdvanced(e.target.checked);
                  markDirty();
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
              style={{
                width: "100%",
                minHeight: 320,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
              value={wizRoeText}
              onChange={(e) => {
                setWizRoeText(e.target.value);
                markDirty();
              }}
              placeholder={"{\n  \"version\": 1,\n  \"network\": { \"qps\": 3 }\n}"}
            />
          ) : (
            <div className="ph-small" style={{ opacity: 0.85 }}>
              Turn on “Advanced ROE JSON” to edit directly.
            </div>
          )}

          <div className="ph-row" style={{ marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="ph-btn" onClick={onSave} disabled={!engineOk || wizardSaving}>
              {wizardSaving ? "Saving…" : saveLabel}
            </button>

            {modal ? (
              <button
                className="ph-btn"
                onClick={onClose}
                disabled={!wizardCanClose || wizardSaving}
                title={!wizardCanClose ? "Setup is required before continuing" : "Close"}
              >
                Close
              </button>
            ) : null}

            <button
              className="ph-btn"
              onClick={() => {
                const allow = parseLinesToList(wizAllowText);
                const deny = parseLinesToList(wizDenyText);
                if (typeof onValidate === "function") {
                  onValidate({ allow, deny });
                }
              }}
              disabled={wizardSaving}
              title="Quick sanity check"
            >
              Validate
            </button>

            {wizardDirty ? (
              <span className="ph-small" style={{ opacity: 0.75 }}>
                Unsaved changes
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="ph-small" style={{ marginTop: 12, opacity: 0.75 }}>
        {tip || (
          <>
            Tip: You can reopen this anytime via <strong>Settings</strong>.
          </>
        )}
      </div>
    </div>
  );

  if (!modal) return card;

  return (
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
        if (e.target === e.currentTarget && wizardCanClose) {
          if (typeof onClose === "function") onClose();
        }
      }}
    >
      {card}
    </div>
  );
}
