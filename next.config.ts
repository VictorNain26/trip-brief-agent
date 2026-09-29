import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Without a nonce, `script-src`/`style-src` need 'unsafe-inline': the App Router ships inline
// bootstrap and flight scripts, and Radix writes inline styles. A nonce would mean running
// middleware on every request (https://nextjs.org/docs/app/guides/content-security-policy).
// Dev adds 'unsafe-eval' for React Refresh and `ws:` for the HMR socket.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Photos come from Wikimedia Commons only (lib/agent/photos.ts), served from these two hosts.
  "img-src 'self' data: https://upload.wikimedia.org https://thumb.wikimedia.org",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "frame-src https://www.openstreetmap.org",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/chat": ["./guides/**/*"],
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: CSP },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    },
  ],
};

export default nextConfig;
