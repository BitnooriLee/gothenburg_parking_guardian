import { MapErrorBoundary } from "@/components/MapErrorBoundary";
import { MapSection } from "@/components/MapSection";

/**
 * Map is client-only (Mapbox GL / WebGL). Loading is handled inside MapSection via dynamic import()
 * in useEffect — equivalent to next/dynamic(..., { ssr: false }) but always renders a real DOM node
 * (#gpg-map-loading or #gpg-map-shell) so Elements shows where the pipeline stopped.
 */
export default function HomePage() {
  return (
    <MapErrorBoundary>
      <MapSection />
    </MapErrorBoundary>
  );
}
