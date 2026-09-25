import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";

const VERSION = "production-safety-v1";
const REPORT_PATH = "data/production-safety-last-run.json";

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function semverTuple(value) {
  const match = String(value ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function gteVersion(actual, minimum) {
  const a = semverTuple(actual);
  const b = semverTuple(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

function auditDependencies() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  let payload = null;
  try {
    payload = JSON.parse(result.stdout || "{}");
  } catch {
    return {
      ok: false,
      error: "NPM_AUDIT_OUTPUT_NOT_JSON",
      exit_code: result.status,
      stderr: String(result.stderr || "").slice(0, 1000),
      counts: null,
      blocking_vulnerabilities: [],
    };
  }

  const counts = payload?.metadata?.vulnerabilities ?? {};
  const high = Number(counts.high ?? 0);
  const critical = Number(counts.critical ?? 0);
  const vulnerabilities = payload?.vulnerabilities ?? {};
  const blocking = Object.values(vulnerabilities)
    .filter((item) => ["high", "critical"].includes(String(item?.severity ?? "").toLowerCase()))
    .map((item) => ({
      name: item?.name ?? null,
      severity: item?.severity ?? null,
      direct: Boolean(item?.isDirect),
      range: item?.range ?? null,
      fix_available: Boolean(item?.fixAvailable),
    }));

  return {
    ok: high === 0 && critical === 0,
    exit_code: result.status,
    counts: {
      info: Number(counts.info ?? 0),
      low: Number(counts.low ?? 0),
      moderate: Number(counts.moderate ?? 0),
      high,
      critical,
      total: Number(counts.total ?? 0),
    },
    blocking_vulnerabilities: blocking,
  };
}

function trackedEnvironmentFiles() {
  const result = spawnSync("git", ["ls-files"], { encoding: "utf8" });
  if (result.status !== 0) return { ok: false, files: [], error: "GIT_LS_FILES_FAILED" };
  const files = String(result.stdout || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => {
      const name = basename(path);
      if (name.endsWith(".example") || name === ".env.example") return false;
      return name === ".env" || name.startsWith(".env.");
    });
  return { ok: files.length === 0, files };
}

const packageJson = readJson("package.json", {});
const packageLock = readJson("package-lock.json", {});
const qualityGate = readJson("data/quality-gate.json", {});
const distributionLastRun = readJson("data/distribution-last-run.json", {});
const metaLastRun = readJson("data/meta-delivery-last-run.json", {});

const sharpDeclared = packageJson?.dependencies?.sharp ?? null;
const sharpLocked = packageLock?.packages?.["node_modules/sharp"]?.version ?? null;
const sharpDeclaredSafe = gteVersion(sharpDeclared, "0.35.4");
const sharpLockedSafe = gteVersion(sharpLocked, "0.35.4");
const dependencyAudit = auditDependencies();
const envFiles = trackedEnvironmentFiles();

const checks = {
  package_private: packageJson?.private === true,
  package_lock_present: existsSync("package-lock.json"),
  sharp_declared: sharpDeclared,
  sharp_locked: sharpLocked,
  sharp_minimum_safe_version: "0.35.4",
  sharp_declared_safe: sharpDeclaredSafe,
  sharp_locked_safe: sharpLockedSafe,
  npm_audit: dependencyAudit,
  no_tracked_environment_files: envFiles,
  quality_gate_fail_closed:
    qualityGate?.policy?.default_on_uncertainty === "QUARANTINED" &&
    qualityGate?.policy?.requires_verified_investigation === true &&
    qualityGate?.policy?.requires_investigation_publishable === true &&
    qualityGate?.policy?.contradicted_claims_allowed === false,
  quality_gate_automated: qualityGate?.policy?.human_approval_required === false,
  distribution_last_run_clean: Number(distributionLastRun?.failed ?? 0) === 0,
  meta_facebook_configured: metaLastRun?.facebook_configured === true,
  meta_instagram_configured: metaLastRun?.instagram_configured === true,
  meta_identity_resolution_clean: metaLastRun?.identity_resolution_error == null,
  meta_delivery_currently_enabled: metaLastRun?.enabled === true,
};

const blockingIssues = [];
if (!checks.package_private) blockingIssues.push("PACKAGE_NOT_PRIVATE");
if (!checks.package_lock_present) blockingIssues.push("PACKAGE_LOCK_MISSING");
if (!checks.sharp_declared_safe) blockingIssues.push("SHARP_DECLARATION_BELOW_0_35_4");
if (!checks.sharp_locked_safe) blockingIssues.push("SHARP_LOCK_BELOW_0_35_4");
if (!checks.npm_audit.ok) blockingIssues.push("HIGH_OR_CRITICAL_NPM_VULNERABILITY");
if (!checks.no_tracked_environment_files.ok) blockingIssues.push("TRACKED_ENVIRONMENT_FILE");
if (!checks.quality_gate_fail_closed) blockingIssues.push("QUALITY_GATE_NOT_FAIL_CLOSED");
if (!checks.quality_gate_automated) blockingIssues.push("QUALITY_GATE_HUMAN_DEPENDENCY");
if (!checks.distribution_last_run_clean) blockingIssues.push("DISTRIBUTION_HAS_FAILURES");
if (!checks.meta_facebook_configured) blockingIssues.push("FACEBOOK_NOT_CONFIGURED");
if (!checks.meta_instagram_configured) blockingIssues.push("INSTAGRAM_NOT_CONFIGURED");
if (!checks.meta_identity_resolution_clean) blockingIssues.push("META_IDENTITY_RESOLUTION_ERROR");

const passed = blockingIssues.length === 0;
const report = {
  engine: "CALPE ONE ENGINE",
  module: "PRODUCTION_SAFETY",
  version: VERSION,
  generated_at: new Date().toISOString(),
  status: passed ? "PASS" : "FAIL",
  ready_for_meta_activation: passed,
  policy: {
    blocks_high_or_critical_dependency_vulnerabilities: true,
    minimum_sharp_version: "0.35.4",
    requires_reproducible_dependency_lock: true,
    requires_fail_closed_editorial_gate: true,
    requires_clean_distribution_state: true,
    requires_meta_identity_configuration: true,
    requires_no_tracked_env_files: true,
    activates_meta_automatically: false,
  },
  blocking_issues: blockingIssues,
  checks,
};

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

if (!passed) process.exit(1);
