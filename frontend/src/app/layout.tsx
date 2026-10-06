import type { Metadata } from "next";
import { Manrope, Sora } from "next/font/google";
import "./globals.css";
import "./fiducia.css";

const manrope = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-manrope" });
const sora = Sora({ subsets: ["latin"], display: "swap", variable: "--font-sora" });

export const metadata: Metadata = {
  title: "Fiducia | iPhone en confiance",
  description: "Acheter et vendre des iPhone avec des vérifications claires au Bénin.",
  applicationName: "Fiducia",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Fiducia", statusBarStyle: "default" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${manrope.variable} ${sora.variable}`} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `const preferred=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";try{const saved=localStorage.getItem("fiducia-theme");document.documentElement.dataset.theme=saved==="light"||saved==="dark"?saved:preferred}catch{document.documentElement.dataset.theme=preferred}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
