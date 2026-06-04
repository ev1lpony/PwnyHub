import React, { useMemo, useRef, useState } from "react";

const DISPOSITIONS = [
  ["target", "High-value target"],
  ["valid", "In scope / valid"],
  ["conditional", "Conditional / impact required"],
  ["low_value", "Low value"],
  ["known_issue", "Known issue"],
  ["no_bounty", "No bounty"],
  ["out_of_scope", "Out of scope"],
  ["prohibited", "Prohibited"],
];

const PRIORITIES = [
  ["critical", "Critical"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
  ["noise", "Noise"],
];

const VULN_POLICY_CLASSES = [
  {
    id: "rce",
    group: "High-impact server-side",
    label: "Remote code execution",
    defaultDisposition: "target",
    defaultPriority: "critical",
    help: "Usually top payout. Track whether real code execution or isolated/dev-only execution changes bounty cap.",
  },
  {
    id: "server_side_injection",
    group: "High-impact server-side",
    label: "Server-side injection: SQLi / NoSQLi / command / SSTI",
    defaultDisposition: "target",
    defaultPriority: "critical",
    help: "Use for SQLi or equivalent server-side injection classes. Document exploitability and data/function impact.",
  },
  {
    id: "local_file_read_xxe",
    group: "High-impact server-side",
    label: "Local file read / XXE",
    defaultDisposition: "target",
    defaultPriority: "high",
    help: "Differentiate unrestricted file read from restricted/dev/isolated environments.",
  },
  {
    id: "full_read_ssrf",
    group: "High-impact server-side",
    label: "Full-read SSRF / internal services / cloud metadata",
    defaultDisposition: "target",
    defaultPriority: "high",
    help: "Track whether SSRF can reach internal systems, privileged infrastructure, or metadata services.",
  },
  {
    id: "file_upload_executable",
    group: "High-impact server-side",
    label: "Arbitrary file upload with execution/accessibility",
    defaultDisposition: "conditional",
    defaultPriority: "high",
    help: "Usually needs proof the file is accepted, reachable, and creates real security impact.",
  },
  {
    id: "idor_bac",
    group: "Access control & business logic",
    label: "IDOR / broken access control",
    defaultDisposition: "target",
    defaultPriority: "high",
    help: "Payout depends on data sensitivity and privilege/trust boundary crossed.",
  },
  {
    id: "tenant_isolation",
    group: "Access control & business logic",
    label: "Tenant / organization isolation bypass",
    defaultDisposition: "target",
    defaultPriority: "high",
    help: "Cross-tenant access is often more valuable than same-user object confusion.",
  },
  {
    id: "privilege_escalation",
    group: "Access control & business logic",
    label: "Privilege escalation / role boundary bypass",
    defaultDisposition: "target",
    defaultPriority: "high",
    help: "Admin/support/staff role boundary issues can be major if reproducible.",
  },
  {
    id: "business_logic",
    group: "Access control & business logic",
    label: "Business logic / financial workflow abuse",
    defaultDisposition: "target",
    defaultPriority: "high",
    help: "Usually needs realistic reproducibility under normal system constraints.",
  },
  {
    id: "workflow_bypass",
    group: "Access control & business logic",
    label: "Workflow/state bypass",
    defaultDisposition: "valid",
    defaultPriority: "medium",
    help: "Skipping approvals, verification, payment states, onboarding states, etc.",
  },
  {
    id: "xss",
    group: "Client-side",
    label: "XSS: reflected / stored / DOM",
    defaultDisposition: "conditional",
    defaultPriority: "medium",
    help: "Many programs only care if it reaches sessions, user data, privileged functionality, or trust boundaries.",
  },
  {
    id: "cors",
    group: "Client-side",
    label: "CORS misconfiguration",
    defaultDisposition: "conditional",
    defaultPriority: "low",
    help: "Often only valid with a real browser PoC, automatic credentials, and sensitive data/action impact.",
  },
  {
    id: "csrf",
    group: "Client-side",
    label: "CSRF",
    defaultDisposition: "conditional",
    defaultPriority: "low",
    help: "Usually needs meaningful state-changing impact. Logout-only CSRF is often noise.",
  },
  {
    id: "open_redirect",
    group: "Client-side",
    label: "Open redirect",
    defaultDisposition: "conditional",
    defaultPriority: "low",
    help: "Usually needs token theft, auth bypass, or meaningful chain impact.",
  },
  {
    id: "clickjacking",
    group: "Client-side",
    label: "Clickjacking",
    defaultDisposition: "conditional",
    defaultPriority: "low",
    help: "Usually needs proof of sensitive action exploitation.",
  },
  {
    id: "content_injection",
    group: "Client-side",
    label: "Content injection",
    defaultDisposition: "conditional",
    defaultPriority: "low",
    help: "Often invalid unless it changes executable HTML/JS or application behavior.",
  },
  {
    id: "subdomain_takeover",
    group: "Infra & cloud",
    label: "Subdomain takeover",
    defaultDisposition: "conditional",
    defaultPriority: "low",
    help: "Often low by default unless successfully claimable or chained to greater impact.",
  },
  {
    id: "cloud_storage_exposure",
    group: "Infra & cloud",
    label: "Cloud storage exposure",
    defaultDisposition: "conditional",
    defaultPriority: "medium",
    help: "Track data sensitivity, write access, and whether it affects in-scope assets.",
  },
  {
    id: "secret_exposure",
    group: "Infra & cloud",
    label: "API keys / tokens / secrets exposure",
    defaultDisposition: "conditional",
    defaultPriority: "medium",
    help: "Many programs require proof the token can access sensitive data/functionality.",
  },
  {
    id: "host_header_injection",
    group: "Protocol / infra edge",
    label: "Host header injection",
    defaultDisposition: "conditional",
    defaultPriority: "low",
    help: "Usually needs exploitability such as password-reset poisoning, cache poisoning, or auth impact.",
  },
  {
    id: "http_request_smuggling",
    group: "Protocol / infra edge",
    label: "HTTP request smuggling",
    defaultDisposition: "conditional",
    defaultPriority: "medium",
    help: "Usually needs demonstrated impact, not just a scanner signature.",
  },
  {
    id: "rate_limit_abuse",
    group: "Abuse / rate limits",
    label: "Rate-limit bypass / abuse",
    defaultDisposition: "conditional",
    defaultPriority: "low",
    help: "Often invalid unless it demonstrates account compromise, data exposure, or meaningful abuse.",
  },
  {
    id: "bruteforce",
    group: "Abuse / rate limits",
    label: "Bruteforce / password spraying",
    defaultDisposition: "prohibited",
    defaultPriority: "noise",
    help: "Usually explicitly prohibited by BBP/VDP rules.",
  },
  {
    id: "dos_ddos",
    group: "Abuse / rate limits",
    label: "DoS / DDoS / resource exhaustion",
    defaultDisposition: "prohibited",
    defaultPriority: "noise",
    help: "Usually prohibited unless a program specifically allows safe, bounded testing.",
  },
  {
    id: "info_disclosure_low",
    group: "Common noise / no-impact",
    label: "Low-impact information disclosure",
    defaultDisposition: "low_value",
    defaultPriority: "noise",
    help: "Version banners, usernames, debug messages, directory listings, non-sensitive metadata, etc.",
  },
  {
    id: "security_headers",
    group: "Common noise / no-impact",
    label: "Missing headers / hardening gaps",
    defaultDisposition: "no_bounty",
    defaultPriority: "noise",
    help: "CSP, X-Frame-Options, cookie flags, autocomplete, tabnabbing, etc. are often excluded alone.",
  },
  {
    id: "version_disclosure",
    group: "Common noise / no-impact",
    label: "Version disclosure / banner grabbing",
    defaultDisposition: "no_bounty",
    defaultPriority: "noise",
    help: "Usually invalid unless paired with working exploitability in current config.",
  },
  {
    id: "scanner_only",
    group: "Common noise / no-impact",
    label: "Scanner-only reports",
    defaultDisposition: "no_bounty",
    defaultPriority: "noise",
    help: "Reports without manual validation, reproduction, and impact are often invalid.",
  },
  {
    id: "mobile_hardening",
    group: "Mobile-specific",
    label: "Mobile hardening / local device issues",
    defaultDisposition: "no_bounty",
    defaultPriority: "noise",
    help: "Root/jailbreak detection, obfuscation, screenshot leakage, clipboard, TLS-only findings, etc.",
  },
  {
    id: "cve_known_vulns",
    group: "Known CVE / N-day",
    label: "Known CVEs / N-day vulnerability checks",
    defaultDisposition: "conditional",
    defaultPriority: "medium",
    help: "Track whether public PoCs, active exploitation, or newly published CVEs are allowed or duplicate-prone.",
  },
];

const STEP_IDS = ["program", "assets", "limits", "rewards", "policy", "known", "modules", "advanced"];
const STEPS = [
  { id: "program", label: "1 Program", hint: "Platform, notes, raw policy." },
  { id: "assets", label: "2 Assets", hint: "Tiers, no-bounty, out-of-scope." },
  { id: "limits", label: "3 ROE", hint: "Rate limits and guardrails." },
  { id: "rewards", label: "4 Rewards", hint: "Caps and payout logic." },
  { id: "policy", label: "5 Vuln Policy", hint: "What matters and what does not." },
  { id: "known", label: "6 Known/Excluded", hint: "Known issues and invalid classes." },
  { id: "modules", label: "7 Modules", hint: "Project defaults." },
  { id: "advanced", label: "8 JSON", hint: "Escape hatch." },
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

function textFromList(value) {
  return normalizeList(value).join("\n");
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

function normalizePolicyMap(roe) {
  const raw = getPath(roe, ["program_policy", "vulnerabilities"], {});
  const out = {};
  for (const item of VULN_POLICY_CLASSES) {
    const prev = raw && typeof raw === "object" && raw[item.id] && typeof raw[item.id] === "object" ? raw[item.id] : {};
    out[item.id] = {
      id: item.id,
      label: item.label,
      group: item.group,
      disposition: prev.disposition || item.defaultDisposition || "conditional",
      priority: prev.priority || item.defaultPriority || "medium",
      tier1_cap: prev.tier1_cap || "",
      tier2_cap: prev.tier2_cap || "",
      tier3_cap: prev.tier3_cap || "",
      requires: prev.requires || "",
      invalid_if: prev.invalid_if || "",
      notes: prev.notes || "",
    };
  }

  if (raw && typeof raw === "object") {
    for (const [id, prev] of Object.entries(raw)) {
      if (out[id] || !prev || typeof prev !== "object") continue;
      out[id] = {
        id,
        label: prev.label || id,
        group: prev.group || "Custom",
        disposition: prev.disposition || "conditional",
        priority: prev.priority || "medium",
        tier1_cap: prev.tier1_cap || "",
        tier2_cap: prev.tier2_cap || "",
        tier3_cap: prev.tier3_cap || "",
        requires: prev.requires || "",
        invalid_if: prev.invalid_if || "",
        notes: prev.notes || "",
      };
    }
  }

  return out;
}

function dispositionPill(disposition, pillStyle) {
  if (disposition === "target") return pillStyle("#1f2c1f", "#c9ffd0");
  if (disposition === "valid") return pillStyle("#1c2430", "#cfe0ff");
  if (disposition === "conditional") return pillStyle("#2f2a17", "#ffe9a8");
  if (disposition === "low_value") return pillStyle("#252525", "#ddd");
  if (disposition === "known_issue") return pillStyle("#2a2020", "#ffd2d2");
  if (disposition === "no_bounty") return pillStyle("#2a2020", "#ffd2d2");
  if (disposition === "out_of_scope") return pillStyle("#3b1f1f", "#ffd2d2");
  if (disposition === "prohibited") return pillStyle("#3b1f1f", "#ffd2d2");
  return pillStyle("#222", "#eee");
}

function hasAnyProfileShape(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  return !!(
    obj.schema ||
    obj.pwnyhub_profile ||
    obj.project ||
    obj.roe ||
    obj.policy_profile ||
    obj.program_policy_profile ||
    obj.scope_allow ||
    obj.scope_deny ||
    obj.scope ||
    obj.program ||
    obj.program_policy ||
    obj.network ||
    obj.constraints ||
    obj.enabled_modules ||
    obj.module_configs ||
    obj.modules
  );
}

function extractPolicyProfile(raw) {
  const root = raw?.pwnyhub_profile && typeof raw.pwnyhub_profile === "object" ? raw.pwnyhub_profile : raw;
  const project = root?.project && typeof root.project === "object" ? root.project : {};

  let roe = root?.roe || project?.roe || root?.policy_profile || root?.program_policy_profile || null;

  if (!roe && (root?.program || root?.program_policy || root?.network || root?.constraints)) {
    roe = { ...root };
    delete roe.project;
    delete roe.scope_allow;
    delete roe.scope_deny;
    delete roe.scope;
    delete roe.enabled_modules;
    delete roe.module_configs;
    delete roe.modules;
    delete roe.qps;
    delete roe.schema;
    delete roe.exported_at;
  }

  if (!roe && hasAnyProfileShape(root)) roe = root;
  if (!roe || typeof roe !== "object" || Array.isArray(roe)) roe = {};

  const allow =
    root?.scope_allow ??
    root?.scope?.allow ??
    project?.scope_allow ??
    project?.scope?.allow ??
    roe?.scope_allow ??
    roe?.scope?.allow ??
    [];
  const deny =
    root?.scope_deny ??
    root?.scope?.deny ??
    project?.scope_deny ??
    project?.scope?.deny ??
    roe?.scope_deny ??
    roe?.scope?.deny ??
    [];
  const qps =
    root?.qps ??
    project?.qps ??
    roe?.network?.qps ??
    roe?.network?.automated_tooling_max_qps ??
    "";
  const enabledModules = root?.enabled_modules ?? project?.enabled_modules ?? root?.modules?.enabled ?? [];
  const moduleConfigs = root?.module_configs ?? project?.module_configs ?? root?.modules?.configs ?? {};

  return {
    allow: normalizeList(allow),
    deny: normalizeList(deny),
    qps: qps === "" || qps === undefined || qps === null ? "" : String(qps),
    roe,
    enabledModules: Array.isArray(enabledModules) ? enabledModules.map(String) : [],
    moduleConfigs:
      moduleConfigs && typeof moduleConfigs === "object" && !Array.isArray(moduleConfigs)
        ? moduleConfigs
        : {},
  };
}

function downloadJsonFile(filename, obj) {
  const blob = new Blob([prettyJson(obj)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  const [activeStep, setActiveStep] = useState("program");
  const [policyFilter, setPolicyFilter] = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  const importInputRef = useRef(null);

  if (!open) return null;

  const enabledSet = new Set(Array.isArray(wizEnabledModules) ? wizEnabledModules.map((x) => String(x)) : []);
  const roe = parseJsonObject(wizRoeText);
  const policyMap = normalizePolicyMap(roe);
  const policyRows = Object.values(policyMap);

  const policyStats = useMemo(() => {
    const stats = {};
    for (const row of policyRows) stats[row.disposition] = (stats[row.disposition] || 0) + 1;
    return stats;
  }, [wizRoeText]);

  const roeInvalid = (() => {
    try {
      JSON.parse(wizRoeText || "{}");
      return false;
    } catch {
      return true;
    }
  })();

  const markDirty = () => {
    if (typeof setWizardDirty === "function") setWizardDirty(true);
  };

  const commitRoe = (next) => {
    const cleaned = {
      version: 1,
      ...next,
      program: {
        name: String(getPath(next, ["program", "name"], "") || ""),
        platform: String(getPath(next, ["program", "platform"], "") || ""),
        url: String(getPath(next, ["program", "url"], "") || ""),
        safe_harbor: boolFromPath(next, ["program", "safe_harbor"], false),
        disclosure_requires_consent: boolFromPath(next, ["program", "disclosure_requires_consent"], true),
        raw_policy_text: String(getPath(next, ["program", "raw_policy_text"], "") || ""),
        notes: String(getPath(next, ["program", "notes"], "") || ""),
        ...(next.program || {}),
      },
      network: {
        qps: Number(getPath(next, ["network", "qps"], Number(wizQps || 3) || 3)) || 3,
        burst: Number(getPath(next, ["network", "burst"], Math.max(1, Math.round(Number(wizQps || 3) || 3)))) || 1,
        timeout_s: Number(getPath(next, ["network", "timeout_s"], 20)) || 20,
        retries: Number(getPath(next, ["network", "retries"], 0)) || 0,
        automated_tooling_max_qps: Number(getPath(next, ["network", "automated_tooling_max_qps"], Number(wizQps || 3) || 3)) || 3,
        user_agent_required: String(getPath(next, ["network", "user_agent_required"], "") || ""),
        required_headers_text: String(getPath(next, ["network", "required_headers_text"], "") || ""),
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
      program_policy: {
        assets_text: String(getPath(next, ["program_policy", "assets_text"], "") || ""),
        no_bounty_assets_text: String(getPath(next, ["program_policy", "no_bounty_assets_text"], "") || ""),
        out_of_scope_assets_text: String(getPath(next, ["program_policy", "out_of_scope_assets_text"], "") || ""),
        reward_policy_text: String(getPath(next, ["program_policy", "reward_policy_text"], "") || ""),
        bounty_caps_text: String(getPath(next, ["program_policy", "bounty_caps_text"], "") || ""),
        known_issues_text: String(getPath(next, ["program_policy", "known_issues_text"], "") || ""),
        exclusions_text: String(getPath(next, ["program_policy", "exclusions_text"], "") || ""),
        hardening_exclusions_text: String(getPath(next, ["program_policy", "hardening_exclusions_text"], "") || ""),
        evidence_requirements_text: String(getPath(next, ["program_policy", "evidence_requirements_text"], "") || ""),
        duplicate_policy_text: String(getPath(next, ["program_policy", "duplicate_policy_text"], "") || ""),
        vulnerabilities: normalizePolicyMap(next),
        ...(next.program_policy || {}),
      },
    };

    setWizRoeText(prettyJson(cleaned));
    markDirty();
  };

  const currentProfilePayload = () => ({
    schema: "pwnyhub.policy_profile.v1",
    exported_at: new Date().toISOString(),
    project: {
      scope_allow: parseLinesToList(wizAllowText),
      scope_deny: parseLinesToList(wizDenyText),
      qps: Number(wizQps || getPath(roe, ["network", "qps"], 3)) || 3,
      enabled_modules: Array.isArray(wizEnabledModules) ? wizEnabledModules.map(String) : [],
      module_configs:
        wizModuleConfigs && typeof wizModuleConfigs === "object" && !Array.isArray(wizModuleConfigs)
          ? wizModuleConfigs
          : {},
      roe: parseJsonObject(wizRoeText),
    },
  });

  const handleExportProfile = () => {
    const programName =
      String(getPath(roe, ["program", "name"], "pwnyhub") || "pwnyhub")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "pwnyhub";

    downloadJsonFile(`${programName}_policy_profile.json`, currentProfilePayload());
    setProfileMsg("Exported current policy profile JSON.");
  };

  const handleProfileJsonImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const rawText = await file.text();
      const rawJson = JSON.parse(rawText);

      if (!hasAnyProfileShape(rawJson)) {
        throw new Error("This JSON does not look like a PwnyHub policy profile.");
      }

      const imported = extractPolicyProfile(rawJson);

      if (imported.allow.length) setWizAllowText(imported.allow.join("\n"));
      if (imported.deny.length || rawJson.scope_deny || rawJson?.project?.scope_deny) {
        setWizDenyText(imported.deny.join("\n"));
      }
      if (imported.qps) setWizQps(imported.qps);

      setWizRoeText(prettyJson(imported.roe));

      if (typeof setWizEnabledModules === "function") {
        setWizEnabledModules(imported.enabledModules);
      }
      if (typeof setWizModuleConfigs === "function") {
        setWizModuleConfigs(imported.moduleConfigs || {});
      }

      setActiveStep("program");
      setProfileMsg(`Imported ${file.name}. Review it, then click Save setup.`);
      markDirty();
    } catch (e) {
      setProfileMsg(`Import failed: ${String(e?.message || e)}`);
    } finally {
      event.target.value = "";
    }
  };

  const updateRoePath = (path, value) => commitRoe(setPath(roe, path, value));

  const updatePolicy = (id, patch) => {
    const nextPolicies = {
      ...policyMap,
      [id]: {
        ...(policyMap[id] || { id }),
        ...patch,
      },
    };
    updateRoePath(["program_policy", "vulnerabilities"], nextPolicies);
  };

  const setPolicyGroupDisposition = (group, disposition) => {
    const nextPolicies = { ...policyMap };
    for (const row of policyRows) {
      if (row.group === group) nextPolicies[row.id] = { ...row, disposition };
    }
    updateRoePath(["program_policy", "vulnerabilities"], nextPolicies);
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
      const prevForModule = base[mid] && typeof base[mid] === "object" && !Array.isArray(base[mid]) ? base[mid] : {};
      return { ...base, [mid]: { ...prevForModule, [pkey]: rawValue } };
    });
    markDirty();
  };

  const renderSchemaInput = (mod, paramKey, schema) => {
    const mid = String(mod?.id || "");
    const type = String(schema?.type || "string").toLowerCase();
    const title = schema?.description || schema?.label || "";
    const moduleCfg = wizModuleConfigs && typeof wizModuleConfigs === "object" && !Array.isArray(wizModuleConfigs) ? wizModuleConfigs[mid] || {} : {};
    const currentValue = moduleCfg && Object.prototype.hasOwnProperty.call(moduleCfg, paramKey) ? moduleCfg[paramKey] : schema?.default;

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
        <input className="ph-input" value={currentValue ?? ""} inputMode={inputMode} onChange={(e) => updateModuleParam(mid, paramKey, e.target.value)} placeholder={schema?.default !== undefined && schema?.default !== null ? String(schema.default) : ""} />
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

  const textAreaStyle = { width: "100%", minHeight: 150, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };

  const stepHeader = (
    <div style={{ ...sectionCard, marginBottom: 14 }}>
      <div className="ph-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
        {STEPS.map((step) => {
          const active = activeStep === step.id;
          return (
            <button key={step.id} className={`ph-btn ${active ? "ph-btn-active" : ""}`} onClick={() => setActiveStep(step.id)} style={{ textAlign: "left", minWidth: 145, border: active ? "1px solid rgba(120,180,255,0.8)" : undefined }} type="button">
              <div style={{ fontWeight: 900 }}>{step.label}</div>
              <div className="ph-small" style={{ opacity: 0.68 }}>{step.hint}</div>
            </button>
          );
        })}
      </div>
      <div className="ph-row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <span style={pillStyle("#1f2c1f", "#c9ffd0")}>targets: {policyStats.target || 0}</span>
        <span style={pillStyle("#2f2a17", "#ffe9a8")}>conditional: {policyStats.conditional || 0}</span>
        <span style={pillStyle("#2a2020", "#ffd2d2")}>no bounty/oos/prohibited: {(policyStats.no_bounty || 0) + (policyStats.out_of_scope || 0) + (policyStats.prohibited || 0)}</span>
        <span style={pillStyle("#222", "#eee")}>modules: {Array.isArray(wizEnabledModules) ? wizEnabledModules.length : 0}</span>
      </div>
    </div>
  );

  const renderProgramStep = () => (
    <div style={sectionCard}>
      <div className="ph-h2" style={{ marginTop: 0 }}>Program profile</div>
      <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
        Store the program context and paste the raw BBP/VDP policy here. Later we can build assisted parsing, but the structured fields below are the source of truth for triage.
      </div>

      <div className="ph-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 220px" }}>
          Program name
          <input className="ph-input" value={String(getPath(roe, ["program", "name"], ""))} onChange={(e) => updateRoePath(["program", "name"], e.target.value)} placeholder="Capital.com" />
        </label>
        <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 180px" }}>
          Platform
          <input className="ph-input" value={String(getPath(roe, ["program", "platform"], ""))} onChange={(e) => updateRoePath(["program", "platform"], e.target.value)} placeholder="Intigriti / HackerOne / Bugcrowd / VDP" />
        </label>
        <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 280px" }}>
          Policy URL
          <input className="ph-input" value={String(getPath(roe, ["program", "url"], ""))} onChange={(e) => updateRoePath(["program", "url"], e.target.value)} placeholder="https://..." />
        </label>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={boolFromPath(roe, ["program", "safe_harbor"], false)} onChange={(e) => updateRoePath(["program", "safe_harbor"], e.target.checked)} />
          Safe harbour applies
        </label>
        <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={boolFromPath(roe, ["program", "disclosure_requires_consent"], true)} onChange={(e) => updateRoePath(["program", "disclosure_requires_consent"], e.target.checked)} />
          Disclosure requires written consent
        </label>
      </div>

      <label className="ph-small" style={{ display: "grid", gap: 6, marginTop: 12 }}>
        Raw program text / policy paste
        <textarea className="ph-input" style={{ ...textAreaStyle, minHeight: 260 }} value={String(getPath(roe, ["program", "raw_policy_text"], ""))} onChange={(e) => updateRoePath(["program", "raw_policy_text"], e.target.value)} placeholder="Paste the BBP/VDP policy text here so it stays with the project." />
      </label>

      <label className="ph-small" style={{ display: "grid", gap: 6, marginTop: 12 }}>
        Program notes
        <textarea className="ph-input" style={{ minHeight: 90 }} value={String(getPath(roe, ["program", "notes"], ""))} onChange={(e) => updateRoePath(["program", "notes"], e.target.value)} placeholder="Anything important about payout logic, triage behavior, credentials, demo accounts, etc." />
      </label>
    </div>
  );

  const renderAssetsStep = () => (
    <div style={sectionCard}>
      <div className="ph-h2" style={{ marginTop: 0 }}>Assets, tiers, no-bounty, and out-of-scope</div>
      <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
        Use a simple line format for now: <span className="ph-mono">asset | tier | type | notes</span>. This keeps it fast to enter BBP scope tables.
      </div>

      <div className="ph-row" style={{ gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 420px", minWidth: 320 }}>
          In-scope assets / tiers
          <textarea className="ph-input" style={{ ...textAreaStyle, minHeight: 260 }} value={String(getPath(roe, ["program_policy", "assets_text"], ""))} onChange={(e) => updateRoePath(["program_policy", "assets_text"], e.target.value)} placeholder={"payment.backend-capital.com | Tier 1 | URL | highest priority\n*.backend-capital.com | Tier 2 | Wildcard | backend scope\n*.capital.com | Tier 3 | Wildcard | lower bounty"} />
        </label>

        <div style={{ flex: "1 1 420px", minWidth: 320, display: "grid", gap: 12 }}>
          <label className="ph-small" style={{ display: "grid", gap: 6 }}>
            No-bounty assets
            <textarea className="ph-input" style={{ ...textAreaStyle, minHeight: 120 }} value={String(getPath(roe, ["program_policy", "no_bounty_assets_text"], ""))} onChange={(e) => updateRoePath(["program_policy", "no_bounty_assets_text"], e.target.value)} placeholder={"aff.capital.com\ngo.capital.com\nregister.capital.com"} />
          </label>
          <label className="ph-small" style={{ display: "grid", gap: 6 }}>
            Out-of-scope assets
            <textarea className="ph-input" style={{ ...textAreaStyle, minHeight: 120 }} value={String(getPath(roe, ["program_policy", "out_of_scope_assets_text"], ""))} onChange={(e) => updateRoePath(["program_policy", "out_of_scope_assets_text"], e.target.value)} placeholder={"help.capital.com\n*education.backend-capital.com\n3cxby.itcapital.io"} />
          </label>
        </div>
      </div>
    </div>
  );

  const renderLimitsStep = () => (
    <div style={sectionCard}>
      <div className="ph-h2" style={{ marginTop: 0 }}>Rules of engagement and automated tooling limits</div>
      <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
        Capture the explicit rate limits and global constraints from the program. These should later gate active modules.
      </div>

      <div className="ph-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <label className="ph-small" style={{ display: "grid", gap: 6 }}>
          Project QPS
          <input className="ph-input" style={{ width: 130 }} value={wizQps} onChange={(e) => { setWizQps(e.target.value); markDirty(); }} inputMode="decimal" />
        </label>
        <label className="ph-small" style={{ display: "grid", gap: 6 }}>
          Automated tooling max QPS
          <input className="ph-input" style={{ width: 180 }} value={String(getPath(roe, ["network", "automated_tooling_max_qps"], wizQps || 3))} onChange={(e) => updateRoePath(["network", "automated_tooling_max_qps"], Number(e.target.value || 0))} inputMode="decimal" />
        </label>
        <label className="ph-small" style={{ display: "grid", gap: 6 }}>
          Timeout seconds
          <input className="ph-input" style={{ width: 150 }} value={String(getPath(roe, ["network", "timeout_s"], 20))} onChange={(e) => updateRoePath(["network", "timeout_s"], Number(e.target.value || 20))} inputMode="numeric" />
        </label>
        <label className="ph-small" style={{ display: "grid", gap: 6 }}>
          Retries
          <input className="ph-input" style={{ width: 120 }} value={String(getPath(roe, ["network", "retries"], 0))} onChange={(e) => updateRoePath(["network", "retries"], Number(e.target.value || 0))} inputMode="numeric" />
        </label>
      </div>

      <div className="ph-row" style={{ gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 360px", minWidth: 300, display: "grid", gap: 10 }}>
          {[
            ["respect_scope", "Respect scope allow/deny lists", true],
            ["include_third_party", "Include third-party hosts in analysis", false],
            ["require_manual_review_for_active_tests", "Require manual review before active tests", true],
            ["no_destructive_actions", "Block destructive actions", true],
            ["no_pii_exfiltration", "Block PII exfiltration / bulk data dumping", true],
          ].map(([key, label, fallback]) => (
            <label key={key} className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={boolFromPath(roe, ["constraints", key], fallback)} onChange={(e) => updateRoePath(["constraints", key], e.target.checked)} />
              {label}
            </label>
          ))}
        </div>

        <div style={{ flex: "1 1 420px", minWidth: 320, display: "grid", gap: 12 }}>
          <label className="ph-small" style={{ display: "grid", gap: 6 }}>
            Required user-agent
            <input className="ph-input" value={String(getPath(roe, ["network", "user_agent_required"], ""))} onChange={(e) => updateRoePath(["network", "user_agent_required"], e.target.value)} placeholder="Not applicable / specific UA value" />
          </label>
          <label className="ph-small" style={{ display: "grid", gap: 6 }}>
            Required request headers / special ROE notes
            <textarea className="ph-input" style={{ minHeight: 110 }} value={String(getPath(roe, ["network", "required_headers_text"], ""))} onChange={(e) => updateRoePath(["network", "required_headers_text"], e.target.value)} placeholder="Any required headers, researcher email, test-account markings, etc." />
          </label>
        </div>
      </div>

      <div className="ph-row" style={{ gap: 8, marginTop: 12 }}>
        <button className="ph-btn" type="button" onClick={onLoadDefaultRoe} disabled={!engineOk || wizardSaving}>Load engine ROE defaults</button>
      </div>
    </div>
  );

  const renderRewardsStep = () => (
    <div style={sectionCard}>
      <div className="ph-h2" style={{ marginTop: 0 }}>Reward policy and bounty caps</div>
      <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
        This is where you encode what pays. Use this to prioritize bugs by asset tier, vulnerability class, and business impact instead of raw CVSS alone.
      </div>

      <label className="ph-small" style={{ display: "grid", gap: 6 }}>
        Reward policy summary
        <textarea className="ph-input" style={{ minHeight: 130 }} value={String(getPath(roe, ["program_policy", "reward_policy_text"], ""))} onChange={(e) => updateRoePath(["program_policy", "reward_policy_text"], e.target.value)} placeholder="Bounty depends on demonstrated business impact, affected data/functionality, exploitability, privilege level, scope/trust boundary crossed, scalability, and report quality." />
      </label>

      <label className="ph-small" style={{ display: "grid", gap: 6, marginTop: 12 }}>
        Bounty caps by vulnerability class / tier
        <textarea className="ph-input" style={{ ...textAreaStyle, minHeight: 260 }} value={String(getPath(roe, ["program_policy", "bounty_caps_text"], ""))} onChange={(e) => updateRoePath(["program_policy", "bounty_caps_text"], e.target.value)} placeholder={"RCE | Tier 1: 15000 | Tier 2: 7500 | Tier 3: 2250\nServer-side injection | Tier 1: 9000 | Tier 2: 6000 | Tier 3: 1500\nIDOR/BAC | Tier 1: 4500 | Tier 2: 1500 | Tier 3: 500"} />
      </label>
    </div>
  );

  const renderPolicyStep = () => {
    const q = policyFilter.trim().toLowerCase();
    const filteredRows = policyRows.filter((row) => !q || `${row.group} ${row.label} ${row.id}`.toLowerCase().includes(q));
    const groups = Array.from(new Set(filteredRows.map((row) => row.group)));

    return (
      <div style={sectionCard}>
        <div className="ph-h2" style={{ marginTop: 0 }}>Vulnerability policy</div>
        <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
          This is the money filter. Mark each class as high-value, valid, conditional, low-value, known, no-bounty, out-of-scope, or prohibited.
        </div>

        <input className="ph-input" style={{ width: "100%", marginBottom: 12 }} value={policyFilter} onChange={(e) => setPolicyFilter(e.target.value)} placeholder="Filter policy classes: CORS, IDOR, SSRF, XSS, scanner, headers..." />

        <div style={{ display: "grid", gap: 12 }}>
          {groups.map((group) => (
            <div key={group} className="ph-card" style={{ padding: 12 }}>
              <div className="ph-row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <div className="ph-h2" style={{ margin: 0 }}>{group}</div>
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                  <button className="ph-btn" type="button" onClick={() => setPolicyGroupDisposition(group, "target")}>Target group</button>
                  <button className="ph-btn" type="button" onClick={() => setPolicyGroupDisposition(group, "conditional")}>Conditional group</button>
                  <button className="ph-btn" type="button" onClick={() => setPolicyGroupDisposition(group, "no_bounty")}>No-bounty group</button>
                  <button className="ph-btn" type="button" onClick={() => setPolicyGroupDisposition(group, "prohibited")}>Prohibit group</button>
                </span>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {filteredRows.filter((row) => row.group === group).map((row) => (
                  <details key={row.id} className="ph-card" style={{ padding: 10 }}>
                    <summary style={{ cursor: "pointer" }}>
                      <span className="ph-row" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <strong>{row.label}</strong>
                        <span style={dispositionPill(row.disposition, pillStyle)}>{row.disposition}</span>
                        <span style={pillStyle("#222", "#eee")}>{row.priority}</span>
                        <span className="ph-mono" style={{ opacity: 0.55 }}>{row.id}</span>
                      </span>
                    </summary>

                    <div className="ph-small" style={{ opacity: 0.75, marginTop: 8 }}>{VULN_POLICY_CLASSES.find((x) => x.id === row.id)?.help || "Custom policy class."}</div>

                    <div className="ph-row" style={{ gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                      <label className="ph-small" style={{ display: "grid", gap: 6 }}>
                        Disposition
                        <select className="ph-select" value={row.disposition} onChange={(e) => updatePolicy(row.id, { disposition: e.target.value })}>
                          {DISPOSITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label className="ph-small" style={{ display: "grid", gap: 6 }}>
                        Priority
                        <select className="ph-select" value={row.priority} onChange={(e) => updatePolicy(row.id, { priority: e.target.value })}>
                          {PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label className="ph-small" style={{ display: "grid", gap: 6 }}>
                        Tier 1 cap
                        <input className="ph-input" value={row.tier1_cap} onChange={(e) => updatePolicy(row.id, { tier1_cap: e.target.value })} placeholder="15000" />
                      </label>
                      <label className="ph-small" style={{ display: "grid", gap: 6 }}>
                        Tier 2 cap
                        <input className="ph-input" value={row.tier2_cap} onChange={(e) => updatePolicy(row.id, { tier2_cap: e.target.value })} placeholder="7500" />
                      </label>
                      <label className="ph-small" style={{ display: "grid", gap: 6 }}>
                        Tier 3 cap
                        <input className="ph-input" value={row.tier3_cap} onChange={(e) => updatePolicy(row.id, { tier3_cap: e.target.value })} placeholder="2250" />
                      </label>
                    </div>

                    <div className="ph-row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginTop: 10 }}>
                      <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 280px" }}>
                        Requires / valid only if
                        <textarea className="ph-input" style={{ minHeight: 90 }} value={row.requires} onChange={(e) => updatePolicy(row.id, { requires: e.target.value })} placeholder="Evidence required for this class to be accepted." />
                      </label>
                      <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 280px" }}>
                        Invalid if / filter out
                        <textarea className="ph-input" style={{ minHeight: 90 }} value={row.invalid_if} onChange={(e) => updatePolicy(row.id, { invalid_if: e.target.value })} placeholder="Conditions that make this noise, duplicate, or not accepted." />
                      </label>
                    </div>

                    <label className="ph-small" style={{ display: "grid", gap: 6, marginTop: 10 }}>
                      Notes
                      <textarea className="ph-input" style={{ minHeight: 75 }} value={row.notes} onChange={(e) => updatePolicy(row.id, { notes: e.target.value })} placeholder="Program-specific language, examples, or payout notes." />
                    </label>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderKnownStep = () => (
    <div style={sectionCard}>
      <div className="ph-h2" style={{ marginTop: 0 }}>Known issues, exclusions, and evidence requirements</div>
      <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
        Paste exact program language here. This lets PwnyHub filter noise and remind you what proof is required before a report is worth writing.
      </div>

      <div className="ph-row" style={{ gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 420px", minWidth: 320 }}>
          Known issues / already tracked
          <textarea className="ph-input" style={textAreaStyle} value={String(getPath(roe, ["program_policy", "known_issues_text"], ""))} onChange={(e) => updateRoePath(["program_policy", "known_issues_text"], e.target.value)} placeholder={"YouTube API token\nAbility to enable 2FA w/o email verification"} />
        </label>
        <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 420px", minWidth: 320 }}>
          Exclusions / invalid without impact
          <textarea className="ph-input" style={textAreaStyle} value={String(getPath(roe, ["program_policy", "exclusions_text"], ""))} onChange={(e) => updateRoePath(["program_policy", "exclusions_text"], e.target.value)} placeholder={"Scanner-only reports without manual validation\nCORS without browser PoC + sensitive impact\nOpen redirect without token theft/auth bypass"} />
        </label>
      </div>

      <div className="ph-row" style={{ gap: 14, alignItems: "flex-start", flexWrap: "wrap", marginTop: 12 }}>
        <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 420px", minWidth: 320 }}>
          Missing best-practice / hardening exclusions
          <textarea className="ph-input" style={textAreaStyle} value={String(getPath(roe, ["program_policy", "hardening_exclusions_text"], ""))} onChange={(e) => updateRoePath(["program_policy", "hardening_exclusions_text"], e.target.value)} placeholder={"Missing security headers\nMissing cookie flags\nVersion disclosure\nLack of certificate pinning"} />
        </label>
        <label className="ph-small" style={{ display: "grid", gap: 6, flex: "1 1 420px", minWidth: 320 }}>
          Evidence requirements / proof standards
          <textarea className="ph-input" style={textAreaStyle} value={String(getPath(roe, ["program_policy", "evidence_requirements_text"], ""))} onChange={(e) => updateRoePath(["program_policy", "evidence_requirements_text"], e.target.value)} placeholder={"Business impact must be demonstrated\nManual validation required\nCORS requires malicious-origin browser PoC with automatic credentials and sensitive data/action access"} />
        </label>
      </div>

      <label className="ph-small" style={{ display: "grid", gap: 6, marginTop: 12 }}>
        Duplicate / public 0-day / 1-day policy
        <textarea className="ph-input" style={{ minHeight: 110 }} value={String(getPath(roe, ["program_policy", "duplicate_policy_text"], ""))} onChange={(e) => updateRoePath(["program_policy", "duplicate_policy_text"], e.target.value)} placeholder="Public 0-day/1-day issues may be duplicate for several weeks if the company is aware/remediating." />
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
        Existing module controls are preserved. Later module execution should read this project policy profile and refuse or warn on blocked classes.
      </div>

      {modulesBusy ? <div className="ph-small">Loading modules…</div> : !modules.length ? <div className="ph-small">No modules available yet.</div> : (
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
                  {Array.isArray(mod?.targets) ? mod.targets.map((t) => <span key={t} style={pillStyle("#1f2230", "#cfd7ff")}>{t}</span>) : null}
                </div>
                {mod?.description ? <div className="ph-small" style={{ opacity: 0.85, marginTop: 6 }}>{mod.description}</div> : null}
                {enabled ? (
                  <div style={{ marginTop: 10 }}>
                    {!schemaKeys.length ? <div className="ph-small" style={{ opacity: 0.75 }}>No configurable params for this module.</div> : <div style={{ display: "grid", gap: 10 }}>{schemaKeys.map((paramKey) => <div key={`${mid}:${paramKey}`}>{renderSchemaInput(mod, paramKey, schema[paramKey] || {})}</div>)}</div>}
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
      <div className="ph-h2" style={{ marginTop: 0 }}>Advanced policy / ROE JSON</div>
      <div className="ph-small" style={{ opacity: 0.82, marginBottom: 12 }}>
        Escape hatch for weird programs and exact rules. Structured controls update this JSON; manual edits are still allowed.
      </div>
      <label className="ph-small" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <input type="checkbox" checked={wizUseAdvanced} onChange={(e) => { setWizUseAdvanced(e.target.checked); markDirty(); }} />
        Show advanced JSON editor
      </label>
      {wizUseAdvanced ? (
        <textarea className="ph-input" style={{ width: "100%", minHeight: 520, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} value={wizRoeText} onChange={(e) => { setWizRoeText(e.target.value); markDirty(); }} placeholder={"{\n  \"version\": 1,\n  \"program\": {},\n  \"program_policy\": {}\n}"} />
      ) : null}
    </div>
  );

  const renderActiveStep = () => {
    if (activeStep === "program") return renderProgramStep();
    if (activeStep === "assets") return renderAssetsStep();
    if (activeStep === "limits") return renderLimitsStep();
    if (activeStep === "rewards") return renderRewardsStep();
    if (activeStep === "policy") return renderPolicyStep();
    if (activeStep === "known") return renderKnownStep();
    if (activeStep === "modules") return renderModulesStep();
    return renderAdvancedStep();
  };

  const card = (
    <div className="ph-card" style={{ width: modal ? "min(1380px, 96vw)" : "100%", marginTop: modal ? 22 : 0, boxShadow: modal ? "0 16px 60px rgba(0,0,0,0.35)" : undefined, padding: 14 }} onMouseDown={modal ? (e) => e.stopPropagation() : undefined}>
      <div className="ph-h2" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        Setup Wizard
        {!setupComplete ? <span style={pillStyle("#2a2020", "#ffd2d2")}>Required</span> : null}
        <span style={{ marginLeft: "auto", opacity: 0.75 }} className="ph-small">Project: {projectCfg?.project?.name || `id=${projectId || "?"}`}</span>
      </div>

      <div className="ph-small" style={{ opacity: 0.85, marginBottom: 10 }}>
        {subtitle || <><strong>Program policy</strong>, <strong>scope</strong>, <strong>ROE</strong>, payout logic, vulnerability rules, and project defaults.</>}
      </div>

      {wizardErr ? <div className="ph-err" style={{ marginBottom: 10 }}><div style={{ whiteSpace: "pre-wrap" }}>{wizardErr}</div></div> : null}
      {roeInvalid ? <div className="ph-err" style={{ marginBottom: 10 }}>ROE JSON is invalid. Structured controls will rebuild it into valid JSON when changed.</div> : null}

      <div style={{ ...sectionCard, marginBottom: 14 }}>
        <div className="ph-row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong>Policy profile JSON</strong>
          <span className="ph-small" style={{ opacity: 0.75 }}>
            Import a generated full setup profile, or export this setup for backup/reuse.
          </span>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={handleProfileJsonImport}
          />
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
            <button className="ph-btn" type="button" onClick={() => importInputRef.current?.click()} disabled={wizardSaving}>
              ⬆ Import JSON
            </button>
            <button className="ph-btn" type="button" onClick={handleExportProfile} disabled={wizardSaving}>
              ⬇ Export JSON
            </button>
          </span>
        </div>
        {profileMsg ? (
          <div className="ph-small" style={{ opacity: 0.82, marginTop: 8 }}>
            {profileMsg}
          </div>
        ) : null}
      </div>

      {stepHeader}
      {renderActiveStep()}

      <div className="ph-row" style={{ marginTop: 12, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <button className="ph-btn" type="button" onClick={() => goStep(-1)} disabled={stepIndex <= 0}>Back</button>
        <button className="ph-btn" type="button" onClick={() => goStep(1)} disabled={stepIndex >= STEP_IDS.length - 1}>Next</button>

        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          <button className="ph-btn" onClick={onSave} disabled={!engineOk || wizardSaving}>{wizardSaving ? "Saving…" : saveLabel}</button>
          {modal ? <button className="ph-btn" onClick={onClose} disabled={!wizardCanClose || wizardSaving} title={!wizardCanClose ? "Setup is required before continuing" : "Close"}>Close</button> : null}
          <button className="ph-btn" onClick={() => {
            const allow = parseLinesToList(wizAllowText);
            const deny = parseLinesToList(wizDenyText);
            if (typeof onValidate === "function") onValidate({ allow, deny, enabled_modules: Array.isArray(wizEnabledModules) ? wizEnabledModules : [], module_configs: wizModuleConfigs && typeof wizModuleConfigs === "object" ? wizModuleConfigs : {}, roe: parseJsonObject(wizRoeText) });
          }} disabled={wizardSaving} title="Quick sanity check">Validate</button>
        </span>

        {wizardDirty ? <span className="ph-small" style={{ opacity: 0.75 }}>Unsaved changes</span> : null}
      </div>

      <div className="ph-small" style={{ marginTop: 12, opacity: 0.75 }}>{tip || <>Tip: You can reopen this anytime via <strong>Settings</strong>.</>}</div>
    </div>
  );

  if (!modal) return card;

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 18, overflow: "auto" }} onMouseDown={(e) => { if (e.target === e.currentTarget && wizardCanClose && typeof onClose === "function") onClose(); }}>
      {card}
    </div>
  );
}
