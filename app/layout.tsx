import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "streamdown/styles.css";
import "./globals.css";

const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const heading = Fraunces({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Assistant voyage sur mesure",
  description: "Prototype d’assistant qui prépare une demande de devis de voyage sur mesure.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${body.variable} ${heading.variable} h-full antialiased`}>
      <body className="flex h-full flex-col font-sans text-foreground">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </body>
    </html>
  );
}
