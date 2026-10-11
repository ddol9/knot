import type { NextConfig } from "next";

/**
 * When the app is served behind another host's path prefix — thezonebio.com
 * proxies /knot/app to this deployment — set KNOT_BASE_PATH so Next emits
 * links and _next asset URLs under that prefix. Left empty for local dev and
 * for the root-served Cloud Run deployment, so neither changes.
 */
const basePath = process.env.KNOT_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  // Mirrors KNOT_BASE_PATH into the client bundle at build time so browser-side
  // fetch() calls (ProductApiClient, /api/knot/* proxies) can prefix it — Next's
  // basePath rewriting only covers next/link, next/router and next/image, not
  // hardcoded fetch() paths.
  env: {
    NEXT_PUBLIC_KNOT_BASE_PATH: basePath,
  },
  output: "standalone",
  // 라이브 데모 화면 녹화 시 좌하단 dev 인디케이터가 잡히지 않도록.
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
