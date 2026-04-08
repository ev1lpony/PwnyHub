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

  modules = [],
  modulesBusy = false,
  wizEnabledModules = [],
  setWizEnabledModules,
  wizModuleConfigs = {},
  setWizModuleConfigs,

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

  const enabledSet = new Set(
    Array.isArray(wizEnabledModules) ? wizEnabledModules.map((x) => String(x)) : []
  );

  const markDirty = () => {
    if (typeof setWizardDirty === "function") {
      setWizardDirty(true);
    }
  };

  const toggleModule = (moduleId, checked) => {
    if (typeof setWizEnabledModules !== "function") return;
    const id = String(moduleId || "").trim();
    if (!id) return;

    const next = new Set(enabledSet);
    if (checked) next.add(id);
    else next.delete(id);

    setWizEnabledModules(Array.from(next));
    markDirty();
  };

  const updateModuleParam = (moduleId, paramKey, rawValue) => {
    if (typeof setWizModuleConfigs !== "function") return;
    const mid = String(moduleId || "").trim();
    const pkey = String(paramKey || "").trim();
    if (!mid || !pkey) return;

    setWizModuleConfigs((prev) => {
      const base = prev && typeof prev === "object" ? prev : {};
      const prevForModule =
        base[mid] && typeof base[mid] === "object" && !Array.isArray(base[mid]) ? base[mid] : {};

      return {
        ...base,
        [mid]: {
          ...prevForModule,
          [pkey]: rawValue,
        },
      };
    });

    markDirty();
  };

  const renderSchemaInput = (mod, paramKey, schema) => {
    const mid = String(mod?.id || "");
    const type = String(schema?.type || "string").toLowerCase();
    const title = schema?.description || schema?.label || "";
    const moduleCfg =
      wizModuleConfigs && typeof wizModuleConfigs === "object" && !Array.isArray(wizModuleConfigs)
        ? wizModuleConfigs[mid] || {}
        : {};
    const currentValue =
      moduleCfg && Object.prototype.hasOwnProperty.call(moduleCfg, paramKey)
        ? moduleCfg[paramKey]
        : schema?.default;

    if (type === "bool" || type === "boolean") {
      return (
        <label
          className="ph-small"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          title={title}
        >
          <input
            type="checkbox"
            checked={!!currentValue}
            onChange={(e) => updateModuleParam(mid, paramKey, e.target.checked)}
          />
          {paramKey}
        </label>
      );
    }

    const inputMode =
      type === "int" || type === "float" || type === "number" ? "decimal" : undefined;

    return (
      <label className="ph-small" style={{ display: "grid", gap: 6 }} title={title}>
        <span style={{ opacity: 0.85 }}>{paramKey}</span>
        <input
          className="ph-input"
          value={currentValue ?? ""}
          inputMode={inputMode}
          onChange={(e) => updateModuleParam(mid, paramKey, e.target.value)}
          placeholder={
            schema?.default !== undefined && schema?.default !== null
              ? String(schema.default)
              : ""
          }
        />
        {schema?.description ? (
          <span style={{ opacity: 0.65 }}>{schema.description}</span>
        ) : null}
      </label>
    );
  };

  const card = (
    <div
      className="ph-card"
      style={{
        width: modal ? "min(1180px, 96vw)" : "100%",
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
            Set <strong>scope</strong>, <strong>ROE</strong>, and <strong>module defaults</strong>.
          </>
        )}
      </div>

      {wizardErr ? (
        <div className="ph-err" style={{ marginBottom: 10 }}>
          <div style={{ whiteSpace: "pre-wrap" }}>{wizardErr}</div>
        </div>
      ) : null}

      <div className="ph-row" style={{ gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 360px", minWidth: 320 }}>
          <div className="ph-h2" style={{ marginTop: 10 }}>Scope allowlist (required)</div>
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

          <div className="ph-h2" style={{ marginTop: 12 }}>Scope denylist (optional)</div>
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

          <div className="ph-row" style={{ marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
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

        <div style={{ flex: "1 1 360px", minWidth: 320 }}>
          <div className="ph-h2" style={{ marginTop: 10 }}>ROE (Rules of Engagement)</div>

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
        </div>

        <div style={{ flex: "1 1 360px", minWidth: 320 }}>
          <div
            className="ph-h2"
            style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
          >
            Modules
            <span style={pillStyle("#1c2430", "#cfe0ff")}>
              enabled: {Array.isArray(wizEnabledModules) ? wizEnabledModules.length : 0}
            </span>
          </div>

          <div className="ph-small" style={{ opacity: 0.8, marginBottom: 8 }}>
            Choose which modules are enabled for this project and set their default params here.
          </div>

          {modulesBusy ? (
            <div className="ph-small">Loading modules…</div>
          ) : !modules.length ? (
            <div className="ph-small">No modules available yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {modules.map((mod) => {
                const mid = String(mod?.id || "");
                const enabled = enabledSet.has(mid);
                const schema =
                  mod?.params_schema && typeof mod.params_schema === "object" ? mod.params_schema : {};
                const schemaKeys = Object.keys(schema);

                return (
                  <div key={mid} className="ph-card" style={{ padding: 10 }}>
                    <div className="ph-row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <label
                        className="ph-small"
                        style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => toggleModule(mid, e.target.checked)}
                        />
                        {mod?.name || mid}
                      </label>

                      {mid ? <span style={pillStyle("#1c2430", "#cfe0ff")}>{mid}</span> : null}
                      {mod?.kind ? <span style={pillStyle("#222", "#eee")}>{mod.kind}</span> : null}
                      {Array.isArray(mod?.targets)
                        ? mod.targets.map((t) => (
                            <span key={t} style={pillStyle("#1f2230", "#cfd7ff")}>
                              {t}
                            </span>
                          ))
                        : null}
                    </div>

                    {mod?.description ? (
                      <div className="ph-small" style={{ opacity: 0.85, marginTop: 6 }}>
                        {mod.description}
                      </div>
                    ) : null}

                    {enabled ? (
                      <div style={{ marginTop: 10 }}>
                        {!schemaKeys.length ? (
                          <div className="ph-small" style={{ opacity: 0.75 }}>
                            No configurable params for this module.
                          </div>
                        ) : (
                          <div style={{ display: "grid", gap: 10 }}>
                            {schemaKeys.map((paramKey) => (
                              <div key={`${mid}:${paramKey}`}>
                                {renderSchemaInput(mod, paramKey, schema[paramKey] || {})}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="ph-row" style={{ marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
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
              onValidate({
                allow,
                deny,
                enabled_modules: Array.isArray(wizEnabledModules) ? wizEnabledModules : [],
                module_configs:
                  wizModuleConfigs && typeof wizModuleConfigs === "object" ? wizModuleConfigs : {},
              });
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
