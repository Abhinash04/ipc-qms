import React, { useState } from "react";
import {
  Zap,
  FlaskConical,
  FileText,
  ShieldCheck,
  Clock,
  X,
  Info,
  Gauge,
  CheckCircle2,
} from "lucide-react";

const IPC_ANNOUNCEMENTS = [
  {
    id: "ann-1",
    category: "IP 2026 Monograph",
    categoryHi: "भेषज संहिता 2026",
    title: "Indian Pharmacopoeia (IP 2026) Addendum Draft Release",
    titleHi: "भारतीय भेषज संहिता (IP 2026) परिशिष्ट प्रारूप जारी",
    summary:
      "Draft addendum containing 48 new API & formulation monographs is open for stakeholder feedback.",
    date: "2026-08-25",
    priority: "high",
    icon: FileText,
    badgeColor: "bg-amber-500/15 text-amber-700 border-amber-300/50",
    dotColor: "bg-amber-500",
    refCode: "IPC/IP-ADD/2026/04",
  },
  {
    id: "ann-2",
    category: "24H SLA Policy",
    categoryHi: "24H एसएलए नीति",
    title:
      "Strict 24-Hour SLA Mandatory for High Priority (P1) Technical Queries",
    titleHi: "उच्च प्राथमिकता (P1) प्रश्नों हेतु 24 घंटे की एसएलए अनिवार्य",
    summary:
      "All P1 queries submitted via IPC-QMS must be acknowledged, assigned, and verified within 24 hours.",
    date: "2026-08-26",
    priority: "high",
    icon: Zap,
    badgeColor: "bg-rose-500/15 text-rose-700 border-rose-300/50",
    dotColor: "bg-rose-500",
    refCode: "SOP-IPC-QMS-V4.2",
  },
  {
    id: "ann-3",
    category: "Reference Standards",
    categoryHi: "संदर्भ मानक",
    title: "Updated Reference Standards & Impurities Catalog Released",
    titleHi: "अद्यतन संदर्भ मानक और अशुद्धता सूची जारी",
    summary:
      "National Pharmacopoeia Laboratory (NPL) has published new reference standard batches for active drug ingredients.",
    date: "2026-08-24",
    priority: "medium",
    icon: FlaskConical,
    badgeColor: "bg-blue-500/15 text-blue-700 border-blue-300/50",
    dotColor: "bg-blue-500",
    refCode: "IPC/QC-STD/2026/89",
  },
  {
    id: "ann-4",
    category: "MoHFW Directive",
    categoryHi: "स्वास्थ्य मंत्रालय निर्देश",
    title: "Mandatory Digital Query Submission via IPC-QMS Portal",
    titleHi: "IPC-QMS पोर्टल के माध्यम से डिजिटल प्रश्न पंजीकरण अनिवार्य",
    summary:
      "Ministry of Health & Family Welfare directs all drug manufacturers to submit official technical queries online.",
    date: "2026-08-22",
    priority: "high",
    icon: ShieldCheck,
    badgeColor: "bg-purple-500/15 text-purple-700 border-purple-300/50",
    dotColor: "bg-purple-500",
    refCode: "MOHFW-DIR-2026/IPC-01",
  },
  {
    id: "ann-5",
    category: "KPI Benchmark",
    categoryHi: "केपीआई बेंचमार्क",
    title: "Quarterly Target Resolution Time: ≤ 2.5 Business Days",
    titleHi: "त्रैमासिक औसत समाधान समय लक्ष्य: ≤ 2.5 कार्य दिवस",
    summary:
      "Division heads and reviewers are urged to process pending reviews promptly to maintain 98%+ SLA compliance.",
    date: "2026-08-20",
    priority: "medium",
    icon: Gauge,
    badgeColor: "bg-emerald-500/15 text-emerald-700 border-emerald-300/50",
    dotColor: "bg-emerald-500",
    refCode: "IPC-KPI-Q3-2026",
  },
  {
    id: "ann-6",
    category: "ISO Audit",
    categoryHi: "आईएसओ लेखा परीक्षा",
    title: "ISO/IEC 17025:2017 Internal Laboratory Audit Scheduled",
    titleHi: "ISO/IEC 17025:2017 आंतरिक गुणवत्ता लेखा परीक्षा",
    summary:
      "Annual quality assurance audit for IPC laboratories scheduled from 15th to 20th September 2026.",
    date: "2026-08-18",
    priority: "info",
    icon: Clock,
    badgeColor: "bg-cyan-500/15 text-cyan-700 border-cyan-300/50",
    dotColor: "bg-cyan-500",
    refCode: "AUD-ISO-17025-2026",
  },
];

export function ScrollingMarquee({ className = "" }) {
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);

  const marqueeItems = [...IPC_ANNOUNCEMENTS, ...IPC_ANNOUNCEMENTS];

  return (
    <div className={`px-3 sm:px-5 lg:px-7 mb-3 select-none ${className}`}>
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-r from-white/95 via-slate-50/90 to-indigo-50/85 backdrop-blur-xl border border-white/90 shadow-[0_4px_20px_rgba(37,99,235,0.06)] group">
        <div className="h-0.5 w-full bg-linear-to-r from-blue-500 via-indigo-500 to-purple-500 opacity-80" />

        <div className="flex items-center min-h-11.5 py-1.5 px-3">
          <div className="relative flex-1 overflow-hidden py-1">
            <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-12 bg-linear-to-r from-white/95 to-transparent z-10" />
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 bg-linear-to-l from-indigo-50/95 to-transparent z-10" />

            <div
              style={{ animationDuration: "130s" }}
              className="animate-marquee-scroll flex items-center gap-6 whitespace-nowrap"
            >
              {marqueeItems.map((item, idx) => {
                const IconComponent = item.icon;
                return (
                  <div
                    key={`${item.id}-${idx}`}
                    onClick={() => setSelectedAnnouncement(item)}
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white/80 hover:bg-white border border-slate-200/70 hover:border-indigo-300 shadow-2xs hover:shadow-md transition-all duration-200 cursor-pointer shrink-0 group/item hover:-translate-y-0.5"
                  >
                    <span className="flex items-center justify-center h-6 w-6 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 group-hover/item:scale-110 transition-transform">
                      <IconComponent className="h-3.5 w-3.5" />
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-0.5 rounded-full border ${item.badgeColor}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${item.dotColor}`}
                      />
                      {item.category}
                    </span>

                    <span className="text-[13px] font-bold text-slate-800 tracking-tight group-hover/item:text-indigo-700 transition-colors">
                      {item.title}
                    </span>

                    <span className="text-slate-400 text-xs hidden md:inline font-medium">
                      —{" "}
                      {item.summary.length > 55
                        ? item.summary.slice(0, 55) + "..."
                        : item.summary}
                    </span>

                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/80 ml-1">
                      {item.refCode}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {selectedAnnouncement && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSelectedAnnouncement(null)}
        >
          <div
            className="relative w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-3xl bg-white p-4 sm:p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                  {React.createElement(selectedAnnouncement.icon, {
                    className: "h-5 w-5",
                  })}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border ${selectedAnnouncement.badgeColor}`}
                    >
                      {selectedAnnouncement.category} (
                      {selectedAnnouncement.categoryHi})
                    </span>
                    <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                      {selectedAnnouncement.refCode}
                    </span>
                  </div>
                  <h3 className="text-base font-extrabold text-slate-900 mt-1">
                    {selectedAnnouncement.title}
                  </h3>
                  <p className="text-xs font-semibold text-indigo-600 mt-0.5">
                    {selectedAnnouncement.titleHi}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSelectedAnnouncement(null)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="py-5 space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4 border border-slate-100">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 text-indigo-500" /> Executive
                  Summary / विवरणी
                </h4>
                <p className="text-sm text-slate-700 leading-relaxed font-medium">
                  {selectedAnnouncement.summary}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-indigo-50/50 border border-indigo-100/60">
                  <span className="text-slate-400 font-semibold block mb-0.5">
                    Issue Date
                  </span>
                  <span className="font-extrabold text-slate-800">
                    {selectedAnnouncement.date}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-purple-50/50 border border-purple-100/60">
                  <span className="text-slate-400 font-semibold block mb-0.5">
                    Authority
                  </span>
                  <span className="font-extrabold text-slate-800">
                    IPC MoHFW, Govt of India
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                onClick={() => setSelectedAnnouncement(null)}
                className="px-4 py-2 text-xs font-extrabold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={() => setSelectedAnnouncement(null)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-all cursor-pointer"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Acknowledge Bulletin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
