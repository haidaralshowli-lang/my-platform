import type { Metadata, Viewport } from "next";
import "./globals.css";

// ديناميكي بالكامل حتى تحمل كل صفحة معرّف CSP nonce الخاص بالطلب
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "منصة إدارة المخالفات", template: "%s | منصة إدارة المخالفات" },
  description: "منصة إدارة المخالفات – هيئة الإعلام والاتصالات العراقية",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2a314d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
