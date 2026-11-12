import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// latin-ext: Türkçe harfler (ğ, ş, ı, İ...) için gerekli.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "İÜC AI – Öğrenci Destek Asistanı",
  description: "İÜC öğrencileri için gayriresmî yapay zekâ asistanı.",
};

// Telefonda tarayıcı çubuğunun rengi (açık/koyu temaya göre).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
