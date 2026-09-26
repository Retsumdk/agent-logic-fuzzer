import { writeFileSync } from "node:fs";
import type { FuzzReport } from "./types.js";

/** Render a human-readable report block for the terminal. */
export function renderReport(report: FuzzReport): string {
  const lines: string[] = [];
  const verdict = report.failureCount === 0 ? "PASS" : "FAIL";
  lines.push(`${verdict}: ${report.failureCount} failure(s) across ${report.runs} run(s) in ${report.durationMs}ms`);
  lines.push(`target: ${report.target} | seed: ${report.seed}`);

  const genEntries = Object.entries(report.perGenerator);
  if (genEntries.length > 0) {
    lines.push("per-generator:");
    for (const [kind, stat] of genEntries.sort()) {
      lines.push(`  ${kind.padEnd(18)} ${String(stat.cases).padStart(5)} cases, ${stat.failures} failures`);
    }
  }

  const oracleEntries = Object.entries(report.oracleBreakdown);
  if (oracleEntries.length > 0) {
    lines.push("oracle failures:");
    for (const [oracle, count] of oracleEntries.sort()) {
      lines.push(`  ${oracle.padEnd(18)} ${count}`);
    }
  }

  for (const failure of report.failures.slice(0, 10)) {
    lines.push(`--- failure #${failure.caseId} (generator: ${failure.generator}) ---`);
    lines.push(`oracle: ${failure.failedOracle} | ${failure.detail}`);
    lines.push(`input: ${preview(failure.minimizedInput !== undefined ? failure.minimizedInput : failure.input)}`);
    lines.push(`reproduce: rerun with --seed ${report.seed} (case ${failure.caseId}, case-seed ${failure.caseSeed})`);
  }
  if (report.failures.length > 10) {
    lines.push(`... and ${report.failures.length - 10} more (see --out report.json for the full list)`);
  }
  return lines.join("\n");
}

/** Write the machine-readable report to disk as JSON. */
export function writeReport(report: FuzzReport, outPath: string): void {
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
}

function preview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  if (text.length > 200) text = `${text.slice(0, 197)}...`;
  return text;
}
