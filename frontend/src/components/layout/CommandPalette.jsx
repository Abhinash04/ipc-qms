import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog as DialogPrimitive } from "radix-ui";
import { CornerDownLeft, FileText, Search } from "lucide-react";

import { SECTIONS, SECTION_ORDER } from "@/constants/routeSections";
import { buildPath, pathsForRole } from "@/constants/routePaths";
import { visibleQueries } from "@/constants/queryBuckets";
import { useAuthStore } from "@/store/useAuthStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useT } from "@/i18n/useT";
import { cn } from "@/utils/cn";

const MAX_QUERY_RESULTS = 8;

function pagesForRole(role) {
  const paths = pathsForRole(role);
  return SECTION_ORDER.filter(
    (section) => paths[section] && SECTIONS[section].label && !paths[section].includes(":"),
  ).map((section) => ({
    kind: "page",
    id: `page-${section}`,
    label: SECTIONS[section].label,
    hint: SECTIONS[section].description,
    icon: SECTIONS[section].icon,
    to: paths[section],
  }));
}

function matches(text, needle) {
  return String(text || "").toLowerCase().includes(needle);
}

export function CommandPalette({ open, onOpenChange }) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const queries = useWorkflowStore((state) => state.queries);
  const workflowSteps = useWorkflowStore((state) => state.workflowSteps);
  const reviews = useWorkflowStore((state) => state.reviews);
  const navigate = useNavigate();
  const t = useT();

  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef(null);

  const role = currentUser?.role;

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === "k") {
        event.preventDefault();
        if (open) {
          setTerm("");
          setActive(0);
        }
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const results = useMemo(() => {
    if (!role) return [];
    const needle = term.trim().toLowerCase();
    const pages = pagesForRole(role).filter(
      (page) => !needle || matches(page.label, needle) || matches(page.hint, needle),
    );

    const detail = pathsForRole(role).QUERY_DETAIL;
    let found = [];
    if (needle && detail) {
      const ctx = { user: currentUser, workflowSteps, reviews };
      found = visibleQueries(queries, role, ctx)
        .filter((q) => matches(q.queryId, needle) || matches(q.subject, needle))
        .slice(0, MAX_QUERY_RESULTS)
        .map((q) => ({
          kind: "query",
          id: `query-${q.queryId}`,
          label: q.subject || q.queryId,
          hint: q.queryId,
          icon: FileText,
          to: buildPath(detail, { queryId: q.queryId }),
        }));
    }
    return [...found, ...pages];
  }, [role, term, queries, workflowSteps, reviews, currentUser]);

  const safeActive = Math.min(active, Math.max(results.length - 1, 0));

  const close = () => {
    onOpenChange(false);
    setTerm("");
    setActive(0);
  };

  const go = (item) => {
    if (!item) return;
    close();
    navigate(item.to);
  };

  const onInputKey = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[safeActive]);
    }
  };

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${safeActive}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [safeActive]);

  const queryResults = results.filter((r) => r.kind === "query");
  const pageResults = results.filter((r) => r.kind === "page");

  const renderItem = (item) => {
    const index = results.indexOf(item);
    const Icon = item.icon;
    const selected = index === safeActive;
    return (
      <li
        key={item.id}
        id={item.id}
        role="option"
        aria-selected={selected}
        data-index={index}
        onMouseMove={() => setActive(index)}
        onClick={() => go(item)}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5",
          selected ? "bg-primary text-white" : "text-ink-soft",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            selected ? "bg-white/20" : "bg-primary-50 text-primary",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium">{item.label}</span>
          {item.hint && (
            <span
              className={cn(
                "block truncate text-[11.5px]",
                selected ? "text-white/75" : "text-ink-muted",
              )}
            >
              {item.hint}
            </span>
          )}
        </span>
        {selected && <CornerDownLeft className="h-4 w-4 shrink-0 opacity-80" />}
      </li>
    );
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="dialog-overlay"
          className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs"
        />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          aria-describedby={undefined}
          className="fixed inset-s-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rtl:translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="h-5 w-5 shrink-0 text-ink-muted" />
            <input
              autoFocus
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKey}
              placeholder={t("navbar.search")}
              aria-label="Search queries and pages"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-activedescendant={results[safeActive]?.id}
              className="h-14 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted"
            />
            <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-muted sm:block">
              Esc
            </kbd>
          </div>

          <ul
            ref={listRef}
            id="command-palette-results"
            role="listbox"
            aria-label="Results"
            className="max-h-[55vh] overflow-y-auto p-2"
          >
            {results.length === 0 && (
              <li className="px-3 py-10 text-center text-sm text-ink-muted">
                No matches for “{term}”.
              </li>
            )}
            {queryResults.length > 0 && (
              <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                Queries
              </li>
            )}
            {queryResults.map(renderItem)}
            {pageResults.length > 0 && (
              <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                Pages
              </li>
            )}
            {pageResults.map(renderItem)}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
