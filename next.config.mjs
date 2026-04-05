import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  /**
   * Service workers survive Cmd+Shift+R and keep serving cached shells / stale behavior.
   * Disable PWA during `next dev` unless ENABLE_PWA_IN_DEV=true. Production still uses PWA.
   */
  disable:
    process.env.DISABLE_PWA === "true" ||
    (process.env.NODE_ENV === "development" && process.env.ENABLE_PWA_IN_DEV !== "true"),
  register: true,
  skipWaiting: true,
  /** Push handler lives in public/push-handler.js and is loaded into the generated SW */
  workboxOptions: {
    importScripts: ["/push-handler.js"],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["mapbox-gl", "@vis.gl/react-mapbox"],
  async redirects() {
    return [{ source: "/manifest.json", destination: "/manifest.webmanifest", permanent: false }];
  },
};

export default withPWA(nextConfig);
