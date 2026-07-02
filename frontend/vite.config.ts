import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        // Vite 的 http-proxy 預設不轉發 client abort:瀏覽器 abort 只斷
        // browser↔vite,vite→backend 的 upstream request 繼續跑完。實測
        // (2026-07-03 quota side-channel):直連 :8000 abort 後 FinMind
        // fan-out 停在 ~36 req,過 proxy 卻跑滿 62。沒這段,前端
        // AbortSignal + backend disconnect-cancel 全部失效。
        // res 沒寫完就 close = client abort → destroy upstream request,
        // uvicorn 才收得到 http.disconnect。
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, _req, res) => {
            res.on("close", () => {
              if (!res.writableEnded) proxyReq.destroy();
            });
          });
        },
      },
    },
  },
});
