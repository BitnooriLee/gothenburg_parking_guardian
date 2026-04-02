import type { MetadataRoute } from "next";

/** Next.js serves this as `/manifest.webmanifest` (not `public/manifest.json`). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gothenburg Parking Guardian",
    short_name: "GPG",
    description: "Parking and street cleaning safety for Göteborg",
    start_url: "/",
    display: "standalone",
    background_color: "#F9FAFB",
    theme_color: "#10B981",
    orientation: "portrait-primary",
    icons: [{ src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  };
}
