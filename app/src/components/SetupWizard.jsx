import React, { useState } from "react";

const TEST_MATRIX_GROUPS = [
  {
    id: "recon",
    label: "Recon & mapping",
    items: [
      ["passive_recon", "Passive recon / OSINT", "Public-source collection that does not touch the target."],
      ["subdomain_enum", "Subdomain enumeration", "Scoped subdomain discovery and validation."],
      ["technology_fingerprinting", "Technology fingerprinting", "Identify frameworks, platforms, headers, and versions."],
      ["content_discovery", "Content discovery", "Directory/file discovery within stated rate limits."],
      ["crawler_spider", "Crawler / spider", "Rate-limited crawling from known in-scope URLs."],
      ["historical_urls", "Historical URLs", "Wayback, Common Crawl, and archived endpoint review."],
      ["port_service_discovery", "Port/service discovery", "Only where explicitly allowed by the program."],
    ],
  },
  {
    id: "auth_session",
    label: "Auth & session",
    items: [
      ["login_testing", "Login flow testing", "Normal login, logout, lockout, and error behavior checks."],
      ["password_reset", "Password reset / recovery", "Reset token, email, and account recovery checks."],
      ["mfa_testing", "MFA / 2FA testing", "MFA bypass and downgrade checks where allowed."],
      ["oauth_sso", "OAuth / SSO", "OAuth, SAML, SSO, redirect, and callback checks."],
      ["jwt_testing", "JWT / token testing", "Token handling, claim trust, expiry, and signing checks."],
      ["session_management", "Session management", "Cookie flags, fixation, logout, and rotation checks."],
      ["auth_rate_limits", "Auth rate-limit checks", "Only safe, low-volume checks unless program allows more."],
    ],
  },
  {
    id: "access_control",
    label: "Access control / BAC",
    items: [
      ["idor_bac", "IDOR / broken access control", "Object-level authorization checks."],
      ["tenant_isolation", "Tenant isolation", "Cross-org, cross-workspace, and multi-tenant boundaries."],
      ["role_privilege", "Role / privilege boundaries", "Admin/user/support/staff role separation."],
      ["object_permissions", "Object permissions", "Read/write/delete permissions on owned vs unowned objects."],
      ["admin_boundary", "Admin panel boundary", "Admin-only endpoints and actions."],
      ["workflow_bypass", "Workflow / state bypass", "Skipping approval, payment, verification, or state transitions."],
    ],
  },
  {
    id: "injection",
    label: "Injection classes",
    items: [
      ["sqli", "SQL injection", "Classic, blind, error-based, and time-based checks."],
      ["nosqli", "NoSQL injection", "Mongo/NoSQL query manipulation checks."],
      ["command_injection", "Command injection", "OS command execution checks; usually high-risk."],
      ["ssti", "Server-side template injection", "Template expression injection checks."],
      ["xxe", "XXE", "XML external entity and parser behavior checks."],
      ["ldap_xpath_injection", "LDAP/XPath injection", "Directory/query language injection checks."],
      ["crlf_header_injection", "CRLF / header injection", "Response splitting and injected header checks."],
      ["deserialization", "Insecure deserialization", "Object/parser unsafe deserialization checks."],
    ],
  },
  {
    id: "client_side",
    label: "Client-side / browser",
    items: [
      ["reflected_xss", "Reflected XSS", "Safe reflected payload testing."],
      ["stored_xss", "Stored XSS", "Persistent payload testing with cleanup caution."],
      ["dom_xss", "DOM XSS", "Client-side sink/source checks."],
      ["csp_bypass", "CSP bypass", "Content Security Policy bypass checks."],
      ["clickjacking", "Clickjacking", "Frame and UI redress checks."],
      ["cors_misconfig", "CORS misconfiguration", "Origin trust and credentialed CORS checks."],
      ["open_redirect", "Open redirect", "Redirect and return URL validation checks."],
      ["postmessage", "postMessage issues", "Cross-window message trust checks."],
    ],
  },
  {
    id: "files_content",
    label: "Files, content & parsing",
    items: [
      ["file_upload", "File upload testing", "Extension, MIME, storage, and execution handling."],
      ["path_traversal_lfi", "Path traversal / LFI", "File path and local file read checks."],
      ["rfi", "Remote file inclusion", "Remote include behavior where applicable."],
      ["download_export", "Download / export endpoints", "Report/export/download data exposure checks."],
      ["archive_extraction", "Archive extraction", "Zip slip and archive parser behavior."],
      ["svg_image_parsing", "SVG/image parsing", "Image parser, SVG, and metadata handling."],
      ["ssrf_file_fetch", "URL/file fetchers", "Avatar import, webhook, PDF, image, and fetcher endpoints."],
    ],
  },
  {
    id: "api_logic",
    label: "API & business logic",
    items: [
      ["rest_api", "REST API testing", "Parameter, method, auth, and object checks."],
      ["graphql", "GraphQL testing", "Introspection, authz, batching, and resolver checks."],
      ["mass_assignment", "Mass assignment", "Unexpected writable fields and object mutation."],
      ["webhooks", "Webhooks", "Callback trust, signing, replay, and SSRF-adjacent checks."],
      ["race_conditions", "Race conditions", "Concurrency checks where safe and allowed."],
      ["idempotency", "Idempotency / replay", "Duplicate request and replay behavior."],
      ["business_logic", "Business logic", "Abuse paths that do not fit a single CVE-style class."],
      ["rate_limit_general", "General rate limits", "Safe non-auth rate-limit checks."],
    ],
  },
  {
    id: "infra_cloud",
    label: "Infra, cloud & supply chain",
    items: [
      ["ssrf", "SSRF", "Callback/canary SSRF checks only inside ROE."],
      ["cloud_storage", "Cloud storage permissions", "S3/GCS/Azure bucket exposure and permissions."],
      ["metadata_service", "Cloud metadata service", "Metadata access checks; often prohibited unless explicit."],
      ["subdomain_takeover", "Subdomain takeover", "Dangling DNS/non-destructive validation."],
      ["dns_misconfig", "DNS misconfiguration", "DNS records, takeover risk, and routing mistakes."],
      ["secrets_exposure", "Secrets exposure", "Keys/tokens in JS, repos, logs, or responses."],
      ["cicd_supply_chain", "CI/CD & supply chain", "Build, artifact, dependency, and pipeline exposure."],
      ["container_k8s", "Container / Kubernetes", "Cluster, registry, and container exposure checks."],
    ],
  },
  {
    id: "cve_known",
    label: "CVE / known-vulnerability workflow",
    items: [
      ["safe_version_checks", "Safe version checks", "Identify vulnerable versions without exploit execution."],
      ["nday_validation", "N-day validation", "Validate known bugs using safe proof only."],
      ["public_poc_execution", "Public PoC execution", "Running public exploit code; often prohibited."],
      ["rce_poc", "RCE PoC testing", "Any check that may execute code or commands."],
      ["auth_bypass_cve", "Auth bypass CVEs", "Known auth bypass classes and vendor-specific issues."],
      ["file_read_cve", "File read CVEs", "Known arbitrary file read/path traversal CVEs."],
      ["ssrf_cve", "SSRF CVEs", "Known SSRF issue classes."],
      ["deserialization_cve", "Deserialization CVEs", "Known unsafe deserialization exploit families."],
      ["log4shell", "Log4Shell-style checks", "JNDI/callback-style checks; usually needs explicit permission."],
      ["spring4shell", "Spring4Shell-style checks", "Spring framework known-vulnerability checks."],
      ["struts_cve", "Apache Struts CVE checks", "Struts known-vulnerability families."],
      ["exchange_cve", "Microsoft Exchange CVE checks", "Exchange known-vulnerability families."],
      ["wordpress_plugin_cve", "WordPress/plugin CVE checks", "CMS/plugin known-vulnerability checks."],
    ],
  },
  {
    id: "explicitly_prohibited",
    label: "Usually prohibited / needs explicit permission",
    items: [
      ["dos_ddos", "DoS / DDoS / stress testing", "Load, resource exhaustion, or outage risk."],
      ["bruteforce", "Bruteforce / password spraying", "Credential guessing or high-volume auth attempts."],
      ["credential_stuffing", "Credential stuffing", "Using known leaked credentials."],
      ["social_engineering", "Social engineering / phishing", "Human-targeted deception."],
      ["physical_attacks", "Physical attacks", "Physical access, theft, or facility testing."],
      ["malware", "Malware / persistence / backdoors", "Malware, shells, persistence, or implants."],
      ["spam", "Spam / email abuse", "Bulk messaging or abuse of notification systems."],
      ["payment_abuse", "Payment abuse / real purchases", "Fraudulent checkout, real charges, refunds, or abuse."],
      ["pii_exfiltration", "PII exfiltration / data dumping", "Bulk data access or storing sensitive user data."],
      ["destructive_actions", "Destructive actions / deletion", "Deleting, corrupting, or altering real data."],
      ["mass_scanning", "Mass scanning outside limits", "Broad scanning outside scope/rate limits."],
    ],
  },
];

const STEP_IDS = ["scope", "network", "matrix", "cve", "modules", "advanced"];
const STEPS = [
  { id: "scope", label: "1 Scope", hint: "What is in/out." },
  { id: "network", label: "2 Limits", hint: "Rate and safety guardrails." },
  { id: "matrix", label: "3 Testing Matrix", hint: "Allow, review, or block each class." },
  { id: "cve", label: "4 CVE Rules", hint: "Specific CVEs and exploit families." },
  { id: "modules", label: "5 Modules", hint: "Project defaults." },
  { id: "advanced", label: "6 Advanced JSON", hint: "Escape hatch." },
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
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
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
  return !!getPath(obj, path, fallback);
}

function allMatrixItems() {
  return TEST_MATRIX_GROUPS.flatMap((group) => group.items.map(([key, label, help]) => ({ key, label, help, group: group.id })));
}

function normalizeMatrix(roe) {
  const testing = roe?.testing && typeof roe.testing === "object" ? roe.testing : {};
  const rawMatrix = testing.matrix && typeof testing.matrix === "object" && !Array.isArray(testing.matrix) ? testing.matrix : {};
  const allowed = new Set(normalizeList(testing.allowed_categories));
  const blocked = new Set(normalizeList(testing.blocked_categories));
  const matrix = {};

  for (const item of allMatrixItems()) {
    const raw = String(rawMatrix[item.key] || "").toLowerCase();
    if (["allowed", "review", "blocked"].includes(raw)) matrix[item.key] = raw;
    else if (allowed.has(item.key)) matrix[item.key] = "allowed";
    else if (blocked.has(item.key)) matrix[item.key] = "blocked";
    else matrix[item.key] = "review";
  }

  for (const [key, value] of Object.entries(rawMatrix)) {
    const raw = String(value || "").toLowerCase();
    matrix[key] = ["allowed", "review", "blocked"].includes(raw) ? raw : "review";
  }

  return matrix;
}

function matrixLists(matrix) {
  const allowed = [];
  const blocked = [];
  const review = [];
  for (const [key, status] of Object.entries(matrix || {})) {
    if (status === "allowed") allowed.push(key);
    else if (status === "blocked") blocked.push(key);
    else review.push(key);
  }
  return { allowed: allowed.sort(), blocked: blocked.sort(), review: review.sort() };
}

function textFromList(value) {
  return normalizeList(value).join("\n");
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
  const [activeStep, setActiveStep] = useState("scope");

  if (!open) return null;

  const enabledSet = new Set(
    Array.isArray(wizEnabledModules) ? wizEnabledModules.map((x) => String(x)) : []
  );

  const roe = parseJsonObject(wizRoeText);
  const matrix = normalizeMatrix(roe);
  const lists = matrixLists(matrix);
  const roeInvalid = (() => {
    try {
      JSON.parse(wizRoeText || "{}");
      return false;
    } catch {
      return true;
    }
  })();

  const cveRules = getPath(roe, ["testing", "cve_rules"], {});
  const cveDefault = String(cveRules?.default_disposition || "review");
  const cveAllowlistText = textFromList(cveRules?.allowlist);
  const cveBlocklistText = textFromList(cveRules?.blocklist || getPath(roe, ["testing", "cve_blocklist"], []));
  const exploitFamilyBlocklistText = textFromList(cveRules?.exploit_family_blocklist);
  const exploitFamilyAllowlistText = textFromList(cveRules?.exploit_family_allowlist);
  const cveNotes = String(cveRules?.notes || "");

  const markDirty = () => {
    if (typeof setWizardDirty === "function") setWizardDirty(true);
  };

  const commitRoe = (next) => {
    const nextTesting = next?.testing && typeof next.testing === "object" ? next.testing : {};
    const nextMatrix = normalizeMatrix({ testing: nextTesting });
    const nextLists = matrixLists(nextMatrix);

    const cleaned = {
      version: 1,
      ...next,
      network: {
        qps: Number(getPath(next, ["network", "qps"], Number(wizQps || 3) || 3)) || 3,
        burst: Number(getPath(next, ["network", "burst"], Math.max(1, Math.round(Number(wizQps || 3) || 3)))) || 1,
        timeout_s: Number(getPath(next, ["network", "timeout_s"], 20)) || 20,
        retries: Number(getPath(next, ["network", "retries"], 0)) || 0,
        ...(next.network || {}),
      },
      constraints: {
        respect_scope: boolFromPath(next, ["constraints", "respect_scope"], true),
        include_third_party: boolFromPath(next, ["constraints", "include_third_party"], false),
        require_manual_review_for_active_tests: boolFromPath(next, ["constraints", "require_manual_review_for_active_tests"], true),
        no_destructive_actions: boolFromPath(next, ["constraints", "no_destructive_actions"], true),
        no_pii_exfiltration: boolFromPath(next, ["constraints", "no_pii_exfiltration"], true),
        ...(next.constraints || {}),
      },
      testing: {
        ...nextTesting,
        matrix: nextMatrix,
        allowed_categories: nextLists.allowed,
        review_categories: nextLists.review,
        blocked_categories: nextLists.blocked,
        cve_rules: {
          default_disposition: String(getPath(next, ["testing", "cve_rules", "default_disposition"], "review") || "review"),
          allowlist: normalizeList(getPath(next, ["testing", "cve_rules", "allowlist"], [])),
          blocklist: normalizeList(getPath(next, ["testing", "cve_rules", "blocklist"], getPath(next, ["testing", "cve_blocklist"], []))),
          exploit_family_allowlist: normalizeList(getPath(next, ["testing", "cve_rules", "exploit_family_allowlist"], [])),
          exploit_family_blocklist: normalizeList(getPath(next, ["testing", "cve_rules", "exploit_family_blocklist"], [])),
          notes: String(getPath(next, ["testing", "cve_rules", "notes"], "") || ""),
          ...(getPath(next, ["testing", "cve_rules"], {}) || {}),
        },
        cve_blocklist: normalizeList(getPath(next, ["testing", "cve_rules", "blocklist"], getPath(next, ["testing", "cve_blocklist"], []))),
      },
    };

    setWizRoeText(prettyJson(cleaned));
    markDirty();
  };

  const updateRoePath = (path, value) => commitRoe(setPath(roe, path, value));

  const updateMatrixValue = (key, status) => {
    const nextMatrix = { ...matrix, [key]: status };
    updateRoePath(["testing", "matrix"], nextMatrix);
  };

  const setWholeGroup = (group, status) => {
    const nextMatrix = { ...matrix };
    for (const [key] of group.items) nextMatrix[key] = status;
    updateRoePath(["testing", "matrix"], nextMatrix);
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
        <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }} title={title}>
          <input type="checkbox" checked={!!currentValue} onChange={(e) => updateModuleParam(mid, paramKey, e.target.checked)} />
          {paramKey}
        </label>
      );
    }

    const inputMode = type === "int" || type === "float" || type === "number" ? "decimal" : undefined;

    return (
      <label className="ph-small" style={{ display: "grid", gap: 6 }} title={title}>
        <span style={{ opacity: 0.85 }}>{paramKey}</span>
        <input
          className="ph-input"
          value={currentValue ?? ""}
          inputMode={inputMode}
          onChange={(e) => updateModuleParam(mid, paramKey, e.target.value)}
          placeholder={schema?.default !== undefined && schema?.default !== null ? String(schema.default) : ""}
        />
        {schema?.description ? <span style={{ opacity: 0.65 }}>{schema.description}</span> : null}
      </label>
    );
  };

  const sectionCard = {
    padding: 14,
    border: "1px solid rgba(120,140,180,0.22)",
    borderRadius: 14,
    background: "rgba(255,255,255,0.02)",
  };

  const stepIndex = Math.max(0, STEP_IDS.indexOf(activeStep));
  const goStep = (delta) => setActiveStep(STEP_IDS[Math.max(0, Math.min(STEP_IDS.length - 1, stepIndex + delta))]);

  const stepHeader = (
    <div style={{ ...sectionCard, marginBottom: 14 }}>
      <div className="ph-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
        {STEPS.map((step) => {
          const active = activeStep === step.id;
          return (
            <button
              key={step.id}
              className={`ph-btn ${active ? "ph-btn-active" : ""}`}
              onClick={() => setActiveStep(step.id)}
              style={{ textAlign: "left", minWidth: 150, border: active ? "1px solid rgba(120,180,255,0.8)" : undefined }}
              type="button"
            >
              <div style={{ fontWeight: 900 }}>{step.label}</div>
              <div className="ph-small" style={{ opacity: 0.68 }}>{step.hint}</div>
            </button>
          );
        })}
      </div>
      <div className="ph-row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <span style={pillStyle("#1c2430", "#cfe0ff")}>allow: {lists.allowed.length}</span>
        <span style={pillStyle("#2f2a17", "#ffe9a8")}>review: {lists.review.length}</span>
        <span style={pillStyle("#3b1f1f", "#ffd2d2")}>block: {lists.blocked.length}</span>
        <span style={pillStyle("#222", "#eee")}>modules: {Array.isArray(wizEnabledModules) ? wizEnabledModules.length : 0}</span>
      </div>
    </div>
  );

  const renderScopeStep = () => (
    <div style={sectionCard}>
      <div className="ph-h2" style={{ marginTop: 0 }}>Scope</div>
      <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
        This is the hard boundary for the project. Keep it explicit so later triage and active modules can respect it.
      </div>

      <div className="ph-row" style={{ gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 420px", minWidth: 320 }}>
          <div className="ph-h2">Allowlist (required)</div>
          <div className="ph-small" style={{ opacity: 0.75, marginBottom: 6 }}>
            One host/domain per line. Examples: <span className="ph-mono">example.com</span> <span className="ph-mono">*.example.com</span>
          </div>
          <textarea
            className="ph-input"
            style={{ width: "100%", minHeight: 220, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            value={wizAllowText}
            onChange={(e) => {
              setWizAllowText(e.target.value);
              markDirty();
            }}
            placeholder={"example.com\napi.example.com\n*.dev.example.com"}
          />
        </div>

        <div style={{ flex: "1 1 420px", minWidth: 320 }}>
          <div className="ph-h2">Denylist (optional)</div>
          <div className="ph-small" style={{ opacity: 0.75, marginBottom: 6 }}>
            Deny always wins. Put third parties, CDNs, auth providers, or no-touch systems here.
          </div>
          <textarea
            className="ph-input"
            style={{ width: "100%", minHeight: 220, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            value={wizDenyText}
            onChange={(e) => {
              setWizDenyText(e.target.value);
              markDirty();
            }}
            placeholder={"cdn.example.com\n*.doubleclick.net\nlogin.thirdparty-idp.com"}
          />
        </div>
      </div>
    </div>
  );

  const renderNetworkStep = () => (
    <div style={sectionCard}>
      <div className="ph-h2" style={{ marginTop: 0 }}>Network limits & global guardrails</div>
      <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
        These settings are project-level rules. They do not remove flexibility; they document and enforce how aggressive the workflow is allowed to be.
      </div>

      <div className="ph-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <label className="ph-small" style={{ display: "grid", gap: 6 }}>
          QPS
          <input
            className="ph-input"
            style={{ width: 130 }}
            value={wizQps}
            onChange={(e) => {
              setWizQps(e.target.value);
              markDirty();
            }}
            inputMode="decimal"
          />
        </label>
        <label className="ph-small" style={{ display: "grid", gap: 6 }}>
          Burst
          <input
            className="ph-input"
            style={{ width: 130 }}
            value={String(getPath(roe, ["network", "burst"], Math.max(1, Math.round(Number(wizQps || 3) || 3))))}
            onChange={(e) => updateRoePath(["network", "burst"], Number(e.target.value || 1))}
            inputMode="numeric"
          />
        </label>
        <label className="ph-small" style={{ display: "grid", gap: 6 }}>
          Timeout seconds
          <input
            className="ph-input"
            style={{ width: 150 }}
            value={String(getPath(roe, ["network", "timeout_s"], 20))}
            onChange={(e) => updateRoePath(["network", "timeout_s"], Number(e.target.value || 20))}
            inputMode="numeric"
          />
        </label>
        <label className="ph-small" style={{ display: "grid", gap: 6 }}>
          Retries
          <input
            className="ph-input"
            style={{ width: 120 }}
            value={String(getPath(roe, ["network", "retries"], 0))}
            onChange={(e) => updateRoePath(["network", "retries"], Number(e.target.value || 0))}
            inputMode="numeric"
          />
        </label>
        <button className="ph-btn" type="button" onClick={() => updateRoePath(["network", "qps"], Number(wizQps || 3) || 3)}>
          Sync QPS into ROE
        </button>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {[
          ["respect_scope", "Respect scope allow/deny lists", true],
          ["include_third_party", "Include third-party hosts in analysis", false],
          ["require_manual_review_for_active_tests", "Require manual review before active tests", true],
          ["no_destructive_actions", "Block destructive actions", true],
          ["no_pii_exfiltration", "Block PII exfiltration / bulk data dumping", true],
        ].map(([key, label, fallback]) => (
          <label key={key} className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={boolFromPath(roe, ["constraints", key], fallback)}
              onChange={(e) => updateRoePath(["constraints", key], e.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );

  const renderMatrixStep = () => (
    <div style={sectionCard}>
      <div className="ph-h2" style={{ marginTop: 0 }}>Testing matrix</div>
      <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
        Set each class to <strong>Allow</strong>, <strong>Review</strong>, or <strong>Block</strong>. Review is the safe middle: visible in workflow, but not treated as automatically approved.
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {TEST_MATRIX_GROUPS.map((group) => (
          <div key={group.id} className="ph-card" style={{ padding: 12 }}>
            <div className="ph-row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <div className="ph-h2" style={{ margin: 0 }}>{group.label}</div>
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                <button className="ph-btn" type="button" onClick={() => setWholeGroup(group, "allowed")}>Allow group</button>
                <button className="ph-btn" type="button" onClick={() => setWholeGroup(group, "review")}>Review group</button>
                <button className="ph-btn" type="button" onClick={() => setWholeGroup(group, "blocked")}>Block group</button>
              </span>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {group.items.map(([key, label, help]) => (
                <div key={key} className="ph-row" style={{ alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
                  <div style={{ flex: "1 1 300px", minWidth: 260 }}>
                    <div style={{ fontWeight: 850 }}>{label}</div>
                    <div className="ph-small" style={{ opacity: 0.68 }}>{help}</div>
                    <div className="ph-mono" style={{ fontSize: 11, opacity: 0.5 }}>{key}</div>
                  </div>
                  <select className="ph-select" value={matrix[key] || "review"} onChange={(e) => updateMatrixValue(key, e.target.value)}>
                    <option value="allowed">Allow</option>
                    <option value="review">Review first</option>
                    <option value="blocked">Block</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderCveStep = () => (
    <div style={sectionCard}>
      <div className="ph-h2" style={{ marginTop: 0 }}>CVE and exploit-family rules</div>
      <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
        This is intentionally open-ended. Add exact CVE IDs, vendor advisories, exploit families, banned checks, and program-specific exceptions here.
      </div>

      <div className="ph-row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <label className="ph-small" style={{ display: "grid", gap: 6 }}>
          Unknown CVE default
          <select className="ph-select" value={cveDefault} onChange={(e) => updateRoePath(["testing", "cve_rules", "default_disposition"], e.target.value)}>
            <option value="allowed">Allowed</option>
            <option value="review">Review first</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
      </div>

      <div className="ph-row" style={{ gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 360px", minWidth: 300 }}>
          CVE allowlist
          <textarea
            className="ph-input"
            style={{ minHeight: 150, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            value={cveAllowlistText}
            onChange={(e) => updateRoePath(["testing", "cve_rules", "allowlist"], normalizeList(e.target.value))}
            placeholder={"CVE-2024-xxxxx\nVendor advisory ID\nProgram-approved check"}
          />
        </label>

        <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 360px", minWidth: 300 }}>
          CVE blocklist
          <textarea
            className="ph-input"
            style={{ minHeight: 150, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            value={cveBlocklistText}
            onChange={(e) => updateRoePath(["testing", "cve_rules", "blocklist"], normalizeList(e.target.value))}
            placeholder={"CVE-2021-44228\nCVE-2022-22965\nAny banned PoC"}
          />
        </label>
      </div>

      <div className="ph-row" style={{ gap: 14, alignItems: "flex-start", flexWrap: "wrap", marginTop: 12 }}>
        <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 360px", minWidth: 300 }}>
          Exploit family allowlist
          <textarea
            className="ph-input"
            style={{ minHeight: 130, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            value={exploitFamilyAllowlistText}
            onChange={(e) => updateRoePath(["testing", "cve_rules", "exploit_family_allowlist"], normalizeList(e.target.value))}
            placeholder={"safe version check\nnon-invasive fingerprint\nprogram-approved callback check"}
          />
        </label>

        <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 360px", minWidth: 300 }}>
          Exploit family blocklist
          <textarea
            className="ph-input"
            style={{ minHeight: 130, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            value={exploitFamilyBlocklistText}
            onChange={(e) => updateRoePath(["testing", "cve_rules", "exploit_family_blocklist"], normalizeList(e.target.value))}
            placeholder={"RCE PoC execution\nreverse shell\nJNDI callback\nblind SSRF callback if banned"}
          />
        </label>
      </div>

      <label className="ph-small" style={{ display: "grid", gap: 6, marginTop: 12 }}>
        Program-specific notes / exact ROE language
        <textarea
          className="ph-input"
          style={{ minHeight: 110 }}
          value={cveNotes}
          onChange={(e) => updateRoePath(["testing", "cve_rules", "notes"], e.target.value)}
          placeholder={"Paste exact BBP/VDP language or special exceptions here."}
        />
      </label>
    </div>
  );

  const renderModulesStep = () => (
    <div style={sectionCard}>
      <div className="ph-h2" style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        Modules
        <span style={pillStyle("#1c2430", "#cfe0ff")}>enabled: {Array.isArray(wizEnabledModules) ? wizEnabledModules.length : 0}</span>
      </div>
      <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
        Existing module controls are preserved. Later module execution should read this project ROE and refuse anything blocked.
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
            const schema = mod?.params_schema && typeof mod.params_schema === "object" ? mod.params_schema : {};
            const schemaKeys = Object.keys(schema);

            return (
              <div key={mid} className="ph-card" style={{ padding: 10 }}>
                <div className="ph-row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
                    <input type="checkbox" checked={enabled} onChange={(e) => toggleModule(mid, e.target.checked)} />
                    {mod?.name || mid}
                  </label>

                  {mid ? <span style={pillStyle("#1c2430", "#cfe0ff")}>{mid}</span> : null}
                  {mod?.kind ? <span style={pillStyle("#222", "#eee")}>{mod.kind}</span> : null}
                  {Array.isArray(mod?.targets)
                    ? mod.targets.map((t) => <span key={t} style={pillStyle("#1f2230", "#cfd7ff")}>{t}</span>)
                    : null}
                </div>

                {mod?.description ? <div className="ph-small" style={{ opacity: 0.85, marginTop: 6 }}>{mod.description}</div> : null}

                {enabled ? (
                  <div style={{ marginTop: 10 }}>
                    {!schemaKeys.length ? (
                      <div className="ph-small" style={{ opacity: 0.75 }}>No configurable params for this module.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {schemaKeys.map((paramKey) => <div key={`${mid}:${paramKey}`}>{renderSchemaInput(mod, paramKey, schema[paramKey] || {})}</div>)}
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
  );

  const renderAdvancedStep = () => (
    <div style={sectionCard}>
      <div className="ph-h2" style={{ marginTop: 0 }}>Advanced ROE JSON</div>
      <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
        This stays available for weird programs, edge cases, and exact custom rules. The structured controls update this JSON; manual edits are still allowed.
      </div>
      <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={wizUseAdvanced}
          onChange={(e) => {
            setWizUseAdvanced(e.target.checked);
            markDirty();
          }}
        />
        Show advanced JSON editor
      </label>

      {wizUseAdvanced ? (
        <textarea
          className="ph-input"
          style={{ width: "100%", minHeight: 430, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          value={wizRoeText}
          onChange={(e) => {
            setWizRoeText(e.target.value);
            markDirty();
          }}
          placeholder={"{\n  \"version\": 1,\n  \"network\": { \"qps\": 3 }\n}"}
        />
      ) : null}
    </div>
  );

  const renderActiveStep = () => {
    if (activeStep === "scope") return renderScopeStep();
    if (activeStep === "network") return renderNetworkStep();
    if (activeStep === "matrix") return renderMatrixStep();
    if (activeStep === "cve") return renderCveStep();
    if (activeStep === "modules") return renderModulesStep();
    return renderAdvancedStep();
  };

  const card = (
    <div
      className="ph-card"
      style={{
        width: modal ? "min(1320px, 96vw)" : "100%",
        marginTop: modal ? 22 : 0,
        boxShadow: modal ? "0 16px 60px rgba(0,0,0,0.35)" : undefined,
        padding: 14,
      }}
      onMouseDown={modal ? (e) => e.stopPropagation() : undefined}
    >
      <div className="ph-h2" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        Setup Wizard
        {!setupComplete ? <span style={pillStyle("#2a2020", "#ffd2d2")}>Required</span> : null}
        <span style={{ marginLeft: "auto", opacity: 0.75 }} className="ph-small">
          Project: {projectCfg?.project?.name || `id=${projectId || "?"}`}
        </span>
      </div>

      <div className="ph-small" style={{ opacity: 0.85, marginBottom: 10 }}>
        {subtitle || <><strong>Scope</strong>, <strong>ROE</strong>, testing rules, CVE exceptions, and project defaults.</>}
      </div>

      {wizardErr ? <div className="ph-err" style={{ marginBottom: 10 }}><div style={{ whiteSpace: "pre-wrap" }}>{wizardErr}</div></div> : null}
      {roeInvalid ? <div className="ph-err" style={{ marginBottom: 10 }}>ROE JSON is invalid. Structured controls will rebuild it into valid JSON when changed.</div> : null}

      {stepHeader}
      {renderActiveStep()}

      <div className="ph-row" style={{ marginTop: 12, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <button className="ph-btn" type="button" onClick={() => goStep(-1)} disabled={stepIndex <= 0}>Back</button>
        <button className="ph-btn" type="button" onClick={() => goStep(1)} disabled={stepIndex >= STEP_IDS.length - 1}>Next</button>

        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          <button className="ph-btn" onClick={onSave} disabled={!engineOk || wizardSaving}>{wizardSaving ? "Saving…" : saveLabel}</button>

          {modal ? (
            <button className="ph-btn" onClick={onClose} disabled={!wizardCanClose || wizardSaving} title={!wizardCanClose ? "Setup is required before continuing" : "Close"}>Close</button>
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
                  module_configs: wizModuleConfigs && typeof wizModuleConfigs === "object" ? wizModuleConfigs : {},
                  roe: parseJsonObject(wizRoeText),
                });
              }
            }}
            disabled={wizardSaving}
            title="Quick sanity check"
          >
            Validate
          </button>
        </span>

        {wizardDirty ? <span className="ph-small" style={{ opacity: 0.75 }}>Unsaved changes</span> : null}
      </div>

      <div className="ph-small" style={{ marginTop: 12, opacity: 0.75 }}>
        {tip || <>Tip: You can reopen this anytime via <strong>Settings</strong>.</>}
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
