import React from "react";

const ALLOWED_TEST_CATEGORIES = [
  { key: "passive_recon", label: "Passive recon / OSINT", help: "Collect and organize public info without touching the target." },
  { key: "manual_web_testing", label: "Manual web testing", help: "Normal browser/API exploration inside scope." },
  { key: "authenticated_testing", label: "Authenticated testing", help: "Testing using accounts you are allowed to use." },
  { key: "rate_limited_crawling", label: "Rate-limited crawling", help: "Low-speed crawling that follows the project QPS limit." },
  { key: "api_parameter_testing", label: "API parameter testing", help: "Safe parameter tampering and request comparison." },
  { key: "idor_bac_testing", label: "IDOR / BAC testing", help: "Authorization and object access checks." },
  { key: "xss_testing", label: "XSS testing", help: "Safe reflected/stored/DOM XSS checks where allowed." },
  { key: "sqli_testing", label: "SQLi testing", help: "Careful injection checks where allowed by the program." },
  { key: "file_upload_testing", label: "File upload testing", help: "Safe upload validation checks." },
  { key: "ssrf_testing", label: "SSRF testing", help: "Safe callback/canary style checks only if allowed." },
  { key: "subdomain_takeover_checks", label: "Subdomain takeover checks", help: "Non-destructive takeover validation checks." },
];

const BLOCKED_TEST_CATEGORIES = [
  { key: "dos_ddos", label: "DoS / DDoS / stress testing" },
  { key: "bruteforce", label: "Bruteforce / password spraying" },
  { key: "credential_stuffing", label: "Credential stuffing" },
  { key: "social_engineering", label: "Social engineering / phishing" },
  { key: "physical_attacks", label: "Physical attacks" },
  { key: "malware", label: "Malware / persistence / backdoors" },
  { key: "spam", label: "Spam / email abuse" },
  { key: "payment_abuse", label: "Payment abuse / real purchases" },
  { key: "pii_exfiltration", label: "PII exfiltration / data dumping" },
  { key: "destructive_actions", label: "Destructive actions / deletion" },
  { key: "mass_scanning", label: "Mass scanning outside stated limits" },
  { key: "cve_poc_exploitation", label: "CVE PoC exploitation unless explicitly allowed" },
];

function parseJsonObject(text) {
  try {
    const obj = JSON.parse(text || "{}");
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function prettyJson(obj) {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function getPath(obj, path, fallback) {
  let cur = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || !(key in cur)) return fallback;
    cur = cur[key];
  }
  return cur ?? fallback;
}

function setPath(obj, path, value) {
  const root = { ...(obj || {}) };
  let cur = root;
  path.forEach((key, idx) => {
    if (idx === path.length - 1) {
      cur[key] = value;
      return;
    }
    const next = cur[key] && typeof cur[key] === "object" && !Array.isArray(cur[key]) ? cur[key] : {};
    cur[key] = { ...next };
    cur = cur[key];
  });
  return root;
}

function boolFromPath(obj, path, fallback = false) {
  const v = getPath(obj, path, fallback);
  return !!v;
}

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

  const roe = parseJsonObject(wizRoeText);
  const roeInvalid = (() => {
    try {
      JSON.parse(wizRoeText || "{}");
      return false;
    } catch {
      return true;
    }
  })();

  const allowedCategories = normalizeList(getPath(roe, ["testing", "allowed_categories"], []));
  const blockedCategories = normalizeList(getPath(roe, ["testing", "blocked_categories"], []));
  const cveBlocklist = normalizeList(getPath(roe, ["testing", "cve_blocklist"], []));
  const cveBlocklistText = cveBlocklist.join("\n");

  const markDirty = () => {
    if (typeof setWizardDirty === "function") {
      setWizardDirty(true);
    }
  };

  const commitRoe = (next) => {
    const cleaned = {
      version: 1,
      ...next,
      network: {
        qps: Number(wizQps || getPath(next, ["network", "qps"], 3)) || 3,
        burst: Math.max(1, Math.round(Number(wizQps || getPath(next, ["network", "burst"], 3)) || 3)),
        timeout_s: Number(getPath(next, ["network", "timeout_s"], 20)) || 20,
        retries: Number(getPath(next, ["network", "retries"], 0)) || 0,
        ...(next.network || {}),
      },
      constraints: {
        respect_scope: true,
        include_third_party: false,
        no_destructive_actions: true,
        no_pii_exfiltration: true,
        ...(next.constraints || {}),
      },
      testing: {
        allowed_categories: normalizeList(getPath(next, ["testing", "allowed_categories"], [])),
        blocked_categories: normalizeList(getPath(next, ["testing", "blocked_categories"], [])),
        cve_blocklist: normalizeList(getPath(next, ["testing", "cve_blocklist"], [])),
        notes: String(getPath(next, ["testing", "notes"], "") || ""),
        ...(next.testing || {}),
      },
    };
    setWizRoeText(prettyJson(cleaned));
    markDirty();
  };

  const updateRoePath = (path, value) => {
    commitRoe(setPath(roe, path, value));
  };

  const toggleRoeListValue = (path, value, checked) => {
    const current = new Set(normalizeList(getPath(roe, path, [])));
    if (checked) current.add(value);
    else current.delete(value);
    updateRoePath(path, Array.from(current).sort());
  };

  const applyCommonBbpDefaults = () => {
    commitRoe({
      ...roe,
      network: {
        ...(roe.network || {}),
        qps: Number(wizQps || 3) || 3,
        burst: Math.max(1, Math.round(Number(wizQps || 3) || 3)),
        timeout_s: Number(getPath(roe, ["network", "timeout_s"], 20)) || 20,
        retries: Number(getPath(roe, ["network", "retries"], 0)) || 0,
      },
      constraints: {
        ...(roe.constraints || {}),
        respect_scope: true,
        include_third_party: false,
        no_destructive_actions: true,
        no_pii_exfiltration: true,
      },
      testing: {
        ...(roe.testing || {}),
        allowed_categories: [
          "api_parameter_testing",
          "authenticated_testing",
          "idor_bac_testing",
          "manual_web_testing",
          "passive_recon",
          "rate_limited_crawling",
          "xss_testing",
        ],
        blocked_categories: [
          "bruteforce",
          "credential_stuffing",
          "cve_poc_exploitation",
          "destructive_actions",
          "dos_ddos",
          "malware",
          "mass_scanning",
          "payment_abuse",
          "physical_attacks",
          "pii_exfiltration",
          "social_engineering",
          "spam",
        ],
        cve_blocklist: normalizeList(getPath(roe, ["testing", "cve_blocklist"], [])),
      },
      notes: roe.notes || "Structured BBP/VDP ROE generated by PwnyHub setup. Advanced JSON may be edited manually if needed.",
    });
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

  const sectionCard = {
    padding: 12,
    border: "1px solid rgba(120,140,180,0.22)",
    borderRadius: 14,
    background: "rgba(255,255,255,0.02)",
  };

  const card = (
    <div
      className="ph-card"
      style={{
        width: modal ? "min(1280px, 96vw)" : "100%",
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

      {roeInvalid ? (
        <div className="ph-err" style={{ marginBottom: 10 }}>
          ROE JSON is invalid right now. Structured controls will rebuild it into valid JSON when changed.
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

          <div style={{ ...sectionCard, marginTop: 12 }}>
            <div className="ph-h2" style={{ marginTop: 0 }}>Network limits</div>
            <div className="ph-small" style={{ opacity: 0.8, marginBottom: 8 }}>
              These limits are saved into ROE and should match the BBP/VDP rules.
            </div>
            <div className="ph-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span
                className="ph-small"
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                QPS:
                <input
                  className="ph-input"
                  style={{ width: 96 }}
                  value={wizQps}
                  onChange={(e) => {
                    setWizQps(e.target.value);
                    markDirty();
                  }}
                  inputMode="decimal"
                />
              </span>

              <span className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                Timeout:
                <input
                  className="ph-input"
                  style={{ width: 96 }}
                  value={String(getPath(roe, ["network", "timeout_s"], 20))}
                  onChange={(e) => updateRoePath(["network", "timeout_s"], Number(e.target.value || 20))}
                  inputMode="numeric"
                />
              </span>

              <span className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                Retries:
                <input
                  className="ph-input"
                  style={{ width: 82 }}
                  value={String(getPath(roe, ["network", "retries"], 0))}
                  onChange={(e) => updateRoePath(["network", "retries"], Number(e.target.value || 0))}
                  inputMode="numeric"
                />
              </span>

              <button className="ph-btn" onClick={() => updateRoePath(["network", "qps"], Number(wizQps || 3) || 3)} disabled={wizardSaving}>
                Sync QPS into ROE
              </button>
            </div>
          </div>
        </div>

        <div style={{ flex: "1 1 420px", minWidth: 340 }}>
          <div className="ph-h2" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            ROE controls
            <span style={pillStyle("#1c2430", "#cfe0ff")}>structured</span>
          </div>

          <div className="ph-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button className="ph-btn" onClick={applyCommonBbpDefaults} disabled={wizardSaving}>
              Apply common BBP defaults
            </button>
            <button className="ph-btn" onClick={onLoadDefaultRoe} disabled={!engineOk || wizardSaving}>
              Load engine ROE defaults
            </button>
          </div>

          <div style={sectionCard}>
            <div className="ph-h2" style={{ marginTop: 0 }}>Global safety switches</div>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={boolFromPath(roe, ["constraints", "respect_scope"], true)}
                  onChange={(e) => updateRoePath(["constraints", "respect_scope"], e.target.checked)}
                />
                Respect scope allow/deny lists
              </label>
              <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={boolFromPath(roe, ["constraints", "include_third_party"], false)}
                  onChange={(e) => updateRoePath(["constraints", "include_third_party"], e.target.checked)}
                />
                Include third-party hosts in analysis
              </label>
              <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={boolFromPath(roe, ["constraints", "no_destructive_actions"], true)}
                  onChange={(e) => updateRoePath(["constraints", "no_destructive_actions"], e.target.checked)}
                />
                Block destructive actions
              </label>
              <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={boolFromPath(roe, ["constraints", "no_pii_exfiltration"], true)}
                  onChange={(e) => updateRoePath(["constraints", "no_pii_exfiltration"], e.target.checked)}
                />
                Block PII exfiltration / bulk data dumping
              </label>
            </div>
          </div>

          <div style={{ ...sectionCard, marginTop: 12 }}>
            <div className="ph-h2" style={{ marginTop: 0 }}>Allowed testing</div>
            <div className="ph-small" style={{ opacity: 0.8, marginBottom: 8 }}>
              Toggle what this specific program allows. This feeds the saved ROE JSON.
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {ALLOWED_TEST_CATEGORIES.map((item) => (
                <label key={item.key} className="ph-small" style={{ display: "grid", gap: 2 }} title={item.help}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={allowedCategories.includes(item.key)}
                      onChange={(e) => toggleRoeListValue(["testing", "allowed_categories"], item.key, e.target.checked)}
                    />
                    <strong>{item.label}</strong>
                  </span>
                  <span style={{ opacity: 0.65, marginLeft: 24 }}>{item.help}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: "1 1 420px", minWidth: 340 }}>
          <div className="ph-h2" style={{ marginTop: 10 }}>Blocked testing / CVE rules</div>

          <div style={sectionCard}>
            <div className="ph-small" style={{ opacity: 0.8, marginBottom: 8 }}>
              Block anything the BBP/VDP says is out of bounds. These are stored as ROE block categories.
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {BLOCKED_TEST_CATEGORIES.map((item) => (
                <label key={item.key} className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={blockedCategories.includes(item.key)}
                    onChange={(e) => toggleRoeListValue(["testing", "blocked_categories"], item.key, e.target.checked)}
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ ...sectionCard, marginTop: 12 }}>
            <div className="ph-h2" style={{ marginTop: 0 }}>CVE / exploit blocklist</div>
            <div className="ph-small" style={{ opacity: 0.8, marginBottom: 8 }}>
              One per line. Use exact CVEs, exploit families, or program-specific banned checks.
            </div>
            <textarea
              className="ph-input"
              style={{ width: "100%", minHeight: 110, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              value={cveBlocklistText}
              onChange={(e) => updateRoePath(["testing", "cve_blocklist"], normalizeList(e.target.value))}
              placeholder={"CVE-2021-44228\nLog4Shell\nSpring4Shell\nknown RCE PoCs"}
            />
            <div className="ph-small" style={{ opacity: 0.7, marginTop: 6 }}>
              This does not remove findings; it tells PwnyHub how to label/gate future checks and workflow.
            </div>
          </div>

          <div style={{ ...sectionCard, marginTop: 12 }}>
            <div className="ph-h2" style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              Modules
              <span style={pillStyle("#1c2430", "#cfe0ff")}>
                enabled: {Array.isArray(wizEnabledModules) ? wizEnabledModules.length : 0}
              </span>
            </div>

            <div className="ph-small" style={{ opacity: 0.8, marginBottom: 8 }}>
              Existing module controls stay here. Later these will respect the structured ROE automatically.
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
      </div>

      <div style={{ ...sectionCard, marginTop: 14 }}>
        <label
          className="ph-small"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8 }}
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
        <div className="ph-small" style={{ opacity: 0.75, marginBottom: 8 }}>
          Kept as an escape hatch. Structured controls above update this JSON; manual edits are still allowed.
        </div>

        {wizUseAdvanced ? (
          <textarea
            className="ph-input"
            style={{
              width: "100%",
              minHeight: 240,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
            value={wizRoeText}
            onChange={(e) => {
              setWizRoeText(e.target.value);
              markDirty();
            }}
            placeholder={"{\n  \"version\": 1,\n  \"network\": { \"qps\": 3 }\n}"}
          />
        ) : null}
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
                roe: parseJsonObject(wizRoeText),
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
        overflow: "auto",
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
