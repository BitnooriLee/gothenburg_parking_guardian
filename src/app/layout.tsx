import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { ResidentZoneProvider } from "@/contexts/ResidentZoneContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#10B981",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Gothenburg Parking Guardian",
  description: "Cleaning safety map — Gothenburg",
  applicationName: "GPG",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "GPG",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv" suppressHydrationWarning>
      <body>
        <Script id="gpg-theme-init" strategy="beforeInteractive">
          {`(function(){try{var k='gpg-theme-preference';var p=localStorage.getItem(k);var dark=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',dark);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',dark?'#0f172a':'#10B981');}catch(e){}})();`}
        </Script>
        <ThemeProvider>
          <ResidentZoneProvider>{children}</ResidentZoneProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
