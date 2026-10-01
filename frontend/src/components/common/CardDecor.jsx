import { cn } from "@/utils/cn";
import { bandPath, BANDS_VIEWBOX } from "@/components/common/heroBands";

const BANDS = [
  { x: 380, w: 190, opacity: 0.08, motion: "hero-band-b" },
  { x: 700, w: 300, opacity: 0.13, motion: "hero-band-c" },
  { x: 1120, w: 220, opacity: 0.07, motion: "hero-band-a" },
  { x: 1400, w: 340, opacity: 0.11, motion: "hero-band-b" },
];

export function CardDecor({ colorClass = "text-primary" }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        "[mask-image:linear-gradient(to_right,transparent_30%,black_85%)] rtl:[mask-image:linear-gradient(to_left,transparent_30%,black_85%)]",
        "[--band-k:1]",
        colorClass,
      )}
    >
      <svg
        className="absolute inset-0 h-full w-full rtl:-scale-x-100"
        viewBox={BANDS_VIEWBOX}
        preserveAspectRatio="xMidYMid slice"
      >
        {BANDS.map((band) => (
          <path
            key={band.x}
            className={band.motion}
            d={bandPath(band.x, band.w)}
            fill="currentColor"
            style={{ fillOpacity: `calc(var(--band-k) * ${band.opacity})` }}
          />
        ))}
      </svg>
    </div>
  );
}
