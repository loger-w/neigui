/**
 * Visual regression helpers — design.md v6 §3 SC-9 / §5。
 *
 * 痛點:Windows 本機 vs Linux CI 字型差異,baseline 跨 OS 一定紅。
 * 政策:baseline 只在 Linux CI 生成 + commit;Win32 spec auto-skip。
 */
import { test } from "@playwright/test";
import os from "node:os";

export const VISUAL_THRESHOLD = { maxDiffPixelRatio: 0.01 };

export function skipOnWin32(): void {
  test.skip(
    os.platform() === "win32",
    "Visual baseline 只在 Linux CI 生成 — 字型差異會使 Windows 本機 diff 必爆",
  );
}
