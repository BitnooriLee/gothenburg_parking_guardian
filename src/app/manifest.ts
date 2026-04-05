import type { MetadataRoute } from "next";

/**
 * Served as `/manifest.webmanifest`. `/manifest.json` redirects here (next.config).
 * Install: Chrome/Android “Install app”; Safari “Add to Home Screen”.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Gothenburg Parking Guardian",
    short_name: "GPG",
    description: "Parking and street cleaning safety for Göteborg",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "browser"],
    background_color: "#F9FAFB",
    theme_color: "#10B981",
    orientation: "portrait-primary",
    lang: "sv",
    categories: ["navigation", "utilities", "travel"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
