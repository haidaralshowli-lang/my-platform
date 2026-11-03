import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // التطبيق مستقل عن المنصة الأخرى في المستودع نفسه
  outputFileTracingRoot: path.join(__dirname),
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  reactStrictMode: true,
  serverExternalPackages: ["@node-rs/argon2", "playwright-core"],
  // خطوط التقرير تُقرأ من القرص عند توليد PDF
  outputFileTracingIncludes: { "/api/reports/**": ["./node_modules/@fontsource/ibm-plex-sans-arabic/files/*-normal.woff2"] },
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
