import { bandPath, BANDS_VIEWBOX } from "@/components/common/heroBands";

const BANDS = [
  { x: -520, w: 260, fill: "black", opacity: 0.16, motion: "hero-band-a" },
  { x: -170, w: 170, fill: "white", opacity: 0.07, motion: "hero-band-b" },
  { x: 140, w: 330, fill: "white", opacity: 0.10, motion: "hero-band-c" },
  { x: 520, w: 190, fill: "black", opacity: 0.12, motion: "hero-band-a" },
  { x: 810, w: 380, fill: "white", opacity: 0.08, motion: "hero-band-b" },
  { x: 1260, w: 230, fill: "black", opacity: 0.14, motion: "hero-band-c" },
];

const BASE_GRADIENT = [
  "linear-gradient(115deg",
  "color-mix(in oklab, var(--color-primary-600) 85%, black) 0%",
  "var(--color-primary-600) 35%",
  "var(--color-primary-500) 55%",
  "color-mix(in oklab, var(--color-primary-500) 92%, white) 75%",
  "color-mix(in oklab, var(--color-primary-700) 80%, black) 100%)",
].join(", ");

export function HeroBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ backgroundImage: BASE_GRADIENT }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={BANDS_VIEWBOX}
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="white" stopOpacity="0.3" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse className="hero-glow" cx="1040" cy="140" rx="420" ry="300" fill="url(#hero-glow)" />

        {BANDS.map((band) => (
          <path
            key={band.x}
            className={band.motion}
            d={bandPath(band.x, band.w)}
            fill={band.fill}
            fillOpacity={band.opacity}
          />
        ))}
      </svg>
    </div>
  );
}
