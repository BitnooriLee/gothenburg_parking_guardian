import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.DISABLE_PWA === "true",
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
};

export default withPWA(nextConfig);
