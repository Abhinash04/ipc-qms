import { m } from "framer-motion";
import {
  ShieldCheck,
  Sparkles,
  Compass,
  Mail,
  CheckCircle,
  Send,
  Zap,
} from "lucide-react";

export function HeroBannerCard() {
  return (
    <div className="relative overflow-hidden rounded-3xl sm:rounded-[30px] border border-white/90 bg-linear-to-r from-white/95 via-slate-50/90 to-blue-50/85 p-5 sm:p-7 shadow-[0_12px_36px_rgba(37,99,235,0.08)] backdrop-blur-xl mb-6 group">
      <m.div
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl"
      />
      <m.div
        animate={{
          scale: [1.2, 1, 1.2],
          opacity: [0.2, 0.4, 0.2],
        }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute -left-16 -bottom-16 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl"
      />

      <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3.5 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-linear-to-r from-blue-50 to-indigo-50 px-3.5 py-1 text-[11.5px] font-extrabold text-blue-700 border border-blue-200/70 shadow-2xs">
            <Compass className="h-3.5 w-3.5 text-blue-600 animate-spin-slow" />
            <span className="uppercase tracking-wider">
              Indian Pharmacopoeia Commission — QMS Portal
            </span>
          </div>
          <h1 className="font-heading text-2xl sm:text-3xl lg:text-[34px] font-black tracking-tight text-slate-900 leading-tight wrap-break-word whitespace-normal">
            IPC QMS —{" "}
            <span className="bg-linear-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent block sm:inline">
              Query Management System
            </span>
          </h1>
          <p className="text-xs sm:text-sm font-medium leading-relaxed text-slate-600 max-w-xl">
            Indian Pharmacopoeia Commission (IPC QMS) — official Query
            Management System for handling technical enquiries, monograph
            reviews, reference standards, and automated dispatch operations.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/90 px-3 py-1 text-[11.5px] font-bold text-slate-700 border border-slate-200/80 shadow-2xs">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              IP 2026 Monographs
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/90 px-3 py-1 text-[11.5px] font-bold text-slate-700 border border-slate-200/80 shadow-2xs">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              ISO 17025 Certified
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/90 px-3 py-1 text-[11.5px] font-bold text-blue-700 border border-blue-200/80 shadow-2xs">
              <Zap className="h-3.5 w-3.5 text-blue-600" />
              24H SLA Protocol
            </span>
          </div>
        </div>

        <div className="shrink-0 pt-3 lg:pt-0 self-center lg:self-auto w-full lg:w-auto">
          <div className="relative flex flex-col sm:flex-row items-center justify-center p-5 sm:p-7 rounded-3xl sm:rounded-4xl bg-linear-to-br from-white/80 via-blue-50/70 to-indigo-50/80 border border-white/90 shadow-xl backdrop-blur-2xl">
            <m.div
              animate={{ rotate: 360 }}
              transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
              className="pointer-events-none absolute -inset-1 rounded-[34px] bg-linear-to-r from-blue-500/20 via-indigo-500/30 to-purple-500/20 blur-md"
            />

            <div className="relative z-10 flex items-center gap-5">
              <m.div
                animate={{ y: [0, -8, 0] }}
                transition={{
                  duration: 3.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-linear-to-tr from-blue-600 via-indigo-600 to-purple-600 text-white shadow-[0_12px_30px_rgba(37,99,235,0.4)] border border-white/40"
              >
                <Mail
                  className="h-9 w-9 text-white drop-shadow-md"
                  strokeWidth={2.2}
                />

                <m.span
                  animate={{ scale: [1, 1.4, 1], opacity: [0.8, 0, 0.8] }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                  className="absolute inset-0 rounded-3xl border-2 border-cyan-400"
                />

                <m.div
                  animate={{ scale: [0.9, 1.1, 0.9] }}
                  transition={{
                    duration: 2.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                  className="absolute -top-2.5 -right-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md border-2 border-white"
                >
                  <CheckCircle className="h-4 w-4" strokeWidth={2.8} />
                </m.div>
              </m.div>

              <div className="space-y-1.5 min-w-0 flex-1 text-center sm:text-left mt-3 sm:mt-0">
                <p className="text-sm font-black text-slate-900 leading-snug flex items-center justify-center sm:justify-start gap-1.5 m-0">
                  <span>Digital Query Ingestion</span>
                  <Send className="h-3.5 w-3.5 text-indigo-600" />
                </p>

                <p className="m-0 text-[11.5px] font-semibold text-slate-500">
                  Enquiries arrive by email in the IPC mailbox and are registered by the Front Office.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
