import type { Metadata } from "next";
import { ResidentZoneProvider } from "@/contexts/ResidentZoneContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gothenburg Parking Guardian",
  description: "Cleaning safety map — Gothenburg",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>
        <ResidentZoneProvider>{children}</ResidentZoneProvider>
      </body>
    </html>
  );
}
