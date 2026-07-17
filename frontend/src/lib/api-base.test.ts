import { describe, it, expect } from "vitest";
import { apiOrigin, RAILWAY_ORIGIN } from "./api-base";

// prd cancel 鏈斷點修復(fix/prd-cancel-propagation):Vercel rewrite 不轉發
// client abort,prd 正式域名必須直連 Railway 讓 abort 直達 origin。
describe("apiOrigin", () => {
  it("prd 正式域名 neigui.vercel.app → 直連 Railway(abort 直達,繞過 rewrite)", () => {
    expect(
      apiOrigin({ hostname: "neigui.vercel.app", origin: "https://neigui.vercel.app" }),
    ).toBe(RAILWAY_ORIGIN);
  });

  it("localhost(dev / e2e)→ 同源(vite proxy cancel 鏈已通,行為不變)", () => {
    expect(
      apiOrigin({ hostname: "localhost", origin: "http://localhost:5173" }),
    ).toBe("http://localhost:5173");
  });

  it("preview deploy(neigui-git-*.vercel.app)→ 同源(origin 不在 CORS 名單,留 rewrite fallback)", () => {
    expect(
      apiOrigin({
        hostname: "neigui-git-feat-x-loger.vercel.app",
        origin: "https://neigui-git-feat-x-loger.vercel.app",
      }),
    ).toBe("https://neigui-git-feat-x-loger.vercel.app");
  });
});
