export function bandPath(x, w) {
  return [
    `M ${x} 560`,
    `C ${x + 90} 300 ${x + 480} 20 ${x + 1150} -60`,
    `L ${x + 1150 + w} -60`,
    `C ${x + 480 + w} 20 ${x + 90 + w} 300 ${x + w} 560`,
    "Z",
  ].join(" ");
}

export const BANDS_VIEWBOX = "0 0 1600 500";
