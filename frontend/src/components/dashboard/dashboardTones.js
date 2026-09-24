
const RULES =
  "repeating-linear-gradient(-38deg, rgba(255,255,255,0.55) 0 1px, rgba(255,255,255,0) 1px 7px)";

const ARC =
  "repeating-radial-gradient(circle at 106% -6%, rgba(255,255,255,0) 0 44px, rgba(255,255,255,0.6) 44px 45px, rgba(255,255,255,0) 45px 53px)";

const BASE = {
  variant: "tinted",
  cardBorder: "rgba(255,255,255,0.85)",
};

export const TONES = {
  total: "blue",
  open: "amber",
  incoming: "blue",
  assigned: "blue",
  inProgress: "sky",
  pendingAssignment: "amber",
  awaitingAssignment: "amber",
  awaitingFinalApproval: "purple",
  awaitingReview: "amber",
  drafting: "amber",
  awaitingDispatch: "purple",
  submitted: "purple",
  returned: "rose",
  returnedByMe: "rose",
  closed: "emerald",
  dispatched: "emerald",
  approved: "emerald",
  approvedByMe: "emerald",
  completed: "emerald",
};

export const TONE_STYLES = {
  blue: {
    ...BASE,
    cardBg: [
      ARC,
      RULES,
      "linear-gradient(150deg, var(--color-tone-blue-surface) 0%, var(--color-tone-blue-surface-to) 100%)",
    ].join(", "),
    numColor: "var(--color-tone-blue-figure)",
    accent: "var(--color-tone-blue-figure)",
    glow: "var(--color-tone-blue-surface-to)",
    subtextColor: "text-tone-blue-ink",
    iconBg:
      "bg-linear-to-tr from-tone-blue-chip to-tone-blue-chip-to text-white",
  },
  amber: {
    ...BASE,
    cardBg: [
      ARC,
      RULES,
      "linear-gradient(150deg, var(--color-tone-amber-surface) 0%, var(--color-tone-amber-surface-to) 100%)",
    ].join(", "),
    numColor: "var(--color-tone-amber-figure)",
    accent: "var(--color-tone-amber-figure)",
    glow: "var(--color-tone-amber-surface-to)",
    subtextColor: "text-tone-amber-ink",
    iconBg:
      "bg-linear-to-tr from-tone-amber-chip to-tone-amber-chip-to text-white",
  },
  sky: {
    ...BASE,
    cardBg: [
      ARC,
      RULES,
      "linear-gradient(150deg, var(--color-tone-sky-surface) 0%, var(--color-tone-sky-surface-to) 100%)",
    ].join(", "),
    numColor: "var(--color-tone-sky-figure)",
    accent: "var(--color-tone-sky-figure)",
    glow: "var(--color-tone-sky-surface-to)",
    subtextColor: "text-tone-sky-ink",
    iconBg:
      "bg-linear-to-tr from-tone-sky-chip to-tone-sky-chip-to text-white",
  },
  purple: {
    ...BASE,
    cardBg: [
      ARC,
      RULES,
      "linear-gradient(150deg, var(--color-tone-purple-surface) 0%, var(--color-tone-purple-surface-to) 100%)",
    ].join(", "),
    numColor: "var(--color-tone-purple-figure)",
    accent: "var(--color-tone-purple-figure)",
    glow: "var(--color-tone-purple-surface-to)",
    subtextColor: "text-tone-purple-ink",
    iconBg:
      "bg-linear-to-tr from-tone-purple-chip to-tone-purple-chip-to text-white",
  },
  rose: {
    ...BASE,
    cardBg: [
      ARC,
      RULES,
      "linear-gradient(150deg, var(--color-tone-rose-surface) 0%, var(--color-tone-rose-surface-to) 100%)",
    ].join(", "),
    numColor: "var(--color-tone-rose-figure)",
    accent: "var(--color-tone-rose-figure)",
    glow: "var(--color-tone-rose-surface-to)",
    subtextColor: "text-tone-rose-ink",
    iconBg:
      "bg-linear-to-tr from-tone-rose-chip to-tone-rose-chip-to text-white",
  },
  emerald: {
    ...BASE,
    cardBg: [
      ARC,
      RULES,
      "linear-gradient(150deg, var(--color-tone-emerald-surface) 0%, var(--color-tone-emerald-surface-to) 100%)",
    ].join(", "),
    numColor: "var(--color-tone-emerald-figure)",
    accent: "var(--color-tone-emerald-figure)",
    glow: "var(--color-tone-emerald-surface-to)",
    subtextColor: "text-tone-emerald-ink",
    iconBg:
      "bg-linear-to-tr from-tone-emerald-chip to-tone-emerald-chip-to text-white",
  },
  slate: {
    ...BASE,
    cardBg: [
      ARC,
      RULES,
      "linear-gradient(150deg, var(--color-tone-slate-surface) 0%, var(--color-tone-slate-surface-to) 100%)",
    ].join(", "),
    numColor: "var(--color-tone-slate-figure)",
    accent: "var(--color-tone-slate-figure)",
    glow: "var(--color-tone-slate-surface-to)",
    subtextColor: "text-tone-slate-ink",
    iconBg:
      "bg-linear-to-tr from-tone-slate-chip to-tone-slate-chip-to text-white",
  },
};

export const styleFor = (key) => TONE_STYLES[TONES[key]] || TONE_STYLES.slate;
