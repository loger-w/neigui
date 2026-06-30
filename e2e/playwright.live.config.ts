import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

export default defineConfig({
  ...base,
  grep: /@live/,
  retries: 0, // live tests 不該 flake;紅 = 真 upstream contract drift
});
