/**
 * SC-11 live test hard cap — design.md v6 SC-11 + R5-P1。
 *
 * 痛點:e2e/specs/live-contract.spec.ts 是唯一真打 FinMind 的 spec,自然
 * 會被 add-more-tests pressure(每個新功能想多打一個 live)。一旦超過 3,
 * CI quota 燒、token expiry 紅、test slowness 失控。本 guard 在 globalSetup
 * 階段機械化 cap。
 *
 * R5-P1 修正:用 fs.readFileSync + regex,**不**用 Playwright test.list()
 * (不是 public API)。globalSetup 一次 fire(非 per-worker)。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC = join(__dirname, "..", "specs", "live-contract.spec.ts");
const CAP = 3;

export function assertLiveCap(): void {
  const src = readFileSync(SPEC, "utf-8");
  const count = (src.match(/^\s*test\s*\(/gm) ?? []).length;
  if (count > CAP) {
    throw new Error(
      `live-contract.spec.ts has ${count} tests (cap ${CAP}). ` +
        `縮 scope OR 升 SC-11 brainstorm。`,
    );
  }
}
