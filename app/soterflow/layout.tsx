import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "SoterFlow",
  description: "Unified developer inbox",
};

export default function SoterFlowLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
      </head>
      <body className="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen overscroll-none">
        {children}
      </body>
    </html>
  );
}
