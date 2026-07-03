import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Signal Analyzer",
  description:
    "Technical + ML + sentiment analysis for stocks, with historical backtesting. Educational tool, not financial advice.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
