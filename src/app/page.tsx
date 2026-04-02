import dynamic from "next/dynamic";

const CleaningSafetyMap = dynamic(() => import("@/components/CleaningSafetyMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-[#F9FAFB] text-sm text-neutral-500">
      Loading map…
    </div>
  ),
});

export default function HomePage() {
  return <CleaningSafetyMap />;
}
