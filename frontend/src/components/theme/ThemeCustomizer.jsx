import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Check, RotateCcw } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useThemeStore } from "@/store/useThemeStore";
import { useSidebarCollapsed } from "@/components/layout/sidebarState";
import { useT } from "@/i18n/useT";
import { cn } from "@/utils/cn";

const PRESET_SWATCHES = {
  hope: "#3a57e8",
  indigo: "#4f46e5",
  teal: "#079aa2",
  violet: "#7c3aed",
  amber: "#d97706",
};

const OPTION_CARD =
  "group relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-line bg-surface p-2.5 text-[12px] font-medium text-ink-soft transition-colors outline-none hover:border-primary-300 focus-visible:ring-2 focus-visible:ring-primary/50 data-[state=checked]:border-primary data-[state=checked]:text-primary aria-pressed:border-primary aria-pressed:text-primary";

function Section({ title, children }) {
  return (
    <section className="border-b border-line px-5 py-5 last:border-b-0">
      <h3 className="mb-3 text-[13px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function OptionGroup({ label, value, onChange, columns = 3, children }) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value}
      onValueChange={onChange}
      className={cn("grid gap-2.5", columns === 2 ? "grid-cols-2" : columns === 4 ? "grid-cols-4" : "grid-cols-3")}
    >
      {children}
    </RadioGroupPrimitive.Root>
  );
}

function Option({ value, label, children }) {
  return (
    <RadioGroupPrimitive.Item value={value} className={OPTION_CARD} aria-label={label}>
      {children}
      <span>{label}</span>
    </RadioGroupPrimitive.Item>
  );
}

function Sketch({ side = "bg-slate-200", nav = "bg-slate-100", active, pill, oneSide, boxed }) {
  return (
    <span className="flex h-12 w-full overflow-hidden rounded-md border border-line bg-surface-muted" aria-hidden="true">
      <span className={cn("flex w-1/3 flex-col gap-1 p-1", side, boxed && "m-1 rounded-sm")}>
        <span className="h-1 w-3/4 rounded-full bg-white/60" />
        {active && (
          <span
            className={cn(
              "h-1.5 bg-primary",
              pill ? "rounded-full" : "rounded-[2px]",
              oneSide ? "-ms-1 w-[calc(100%+0.25rem)] rounded-s-none" : "w-full",
            )}
          />
        )}
        <span className="h-1 w-2/3 rounded-full bg-white/60" />
      </span>
      <span className="flex flex-1 flex-col gap-1 p-1">
        <span className={cn("h-1.5 w-full rounded-[2px]", nav)} />
        <span className="flex-1 rounded-[2px] bg-surface" />
      </span>
    </span>
  );
}

export function ThemeCustomizer({ open, onOpenChange }) {
  const theme = useThemeStore();
  const set = useThemeStore((state) => state.setOption);
  const reset = useThemeStore((state) => state.reset);
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const t = useT();

  const toggles = [
    { key: "mini", label: "Mini", pressed: collapsed, onClick: () => setCollapsed(!collapsed) },
    { key: "hover", label: "Hover", pressed: theme.sidebarHover, onClick: () => set("sidebarHover", !theme.sidebarHover) },
    { key: "boxed", label: "Boxed", pressed: theme.sidebarBoxed, onClick: () => set("sidebarBoxed", !theme.sidebarBoxed) },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={theme.dir === "rtl" ? "left" : "right"}
        className="w-full gap-0 border-line bg-surface p-0 text-ink sm:max-w-sm"
      >
        <SheetHeader className="border-b border-line px-5 py-4">
          <SheetTitle className="text-lg font-semibold text-ink">{t("customizer.title")}</SheetTitle>
          <SheetDescription className="text-ink-muted">{t("customizer.subtitle")}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <Section title={t("customizer.preset")}>
            <RadioGroupPrimitive.Root
              aria-label={t("customizer.preset")}
              value={theme.preset}
              onValueChange={(v) => set("preset", v)}
              className="flex flex-wrap gap-3"
            >
              {Object.entries(PRESET_SWATCHES).map(([name, color]) => (
                <RadioGroupPrimitive.Item
                  key={name}
                  value={name}
                  aria-label={`${name} colour`}
                  title={name}
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full ring-offset-2 ring-offset-surface outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ink data-[state=checked]:ring-2 data-[state=checked]:ring-[var(--swatch)]"
                  style={{ background: color, "--swatch": color }}
                >
                  <RadioGroupPrimitive.Indicator>
                    <Check className="h-4.5 w-4.5 text-white" strokeWidth={3} />
                  </RadioGroupPrimitive.Indicator>
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
          </Section>

          <Section title={t("customizer.direction")}>
            <OptionGroup label={t("customizer.direction")} value={theme.dir} onChange={(v) => set("dir", v)} columns={2}>
              <Option value="ltr" label="LTR">
                <Sketch side="bg-primary-200" active />
              </Option>
              <Option value="rtl" label="RTL">
                <span className="flex w-full -scale-x-100">
                  <Sketch side="bg-primary-200" active />
                </span>
              </Option>
            </OptionGroup>
          </Section>

          <Section title={t("customizer.sidebarColor")}>
            <OptionGroup label={t("customizer.sidebarColor")} value={theme.sidebarColor} onChange={(v) => set("sidebarColor", v)} columns={2}>
              <Option value="default" label="Default">
                <Sketch side="bg-surface border-e border-line" />
              </Option>
              <Option value="dark" label="Dark">
                <Sketch side="bg-[#151824]" />
              </Option>
              <Option value="color" label="Colour">
                <Sketch side="bg-primary" />
              </Option>
              <Option value="transparent" label="Transparent">
                <Sketch side="bg-transparent" />
              </Option>
            </OptionGroup>
          </Section>

          <Section title={t("customizer.sidebarType")}>
            <div className="grid grid-cols-3 gap-2.5" role="group" aria-label={t("customizer.sidebarType")}>
              {toggles.map((toggle) => (
                <button
                  key={toggle.key}
                  type="button"
                  aria-pressed={toggle.pressed}
                  onClick={toggle.onClick}
                  className={OPTION_CARD}
                >
                  <Sketch
                    side={cn("bg-primary-200", toggle.key === "mini" && "w-1/6")}
                    boxed={toggle.key === "boxed"}
                  />
                  <span>{toggle.label}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title={t("customizer.sidebarActive")}>
            <OptionGroup label={t("customizer.sidebarActive")} value={theme.sidebarActive} onChange={(v) => set("sidebarActive", v)} columns={2}>
              <Option value="rounded-one" label="Rounded one side">
                <Sketch side="bg-primary-100" active oneSide />
              </Option>
              <Option value="rounded-all" label="Rounded all">
                <Sketch side="bg-primary-100" active />
              </Option>
              <Option value="pill-one" label="Pill one side">
                <Sketch side="bg-primary-100" active pill oneSide />
              </Option>
              <Option value="pill-all" label="Pill all">
                <Sketch side="bg-primary-100" active pill />
              </Option>
            </OptionGroup>
          </Section>

          <Section title={t("customizer.navbar")}>
            <OptionGroup label={t("customizer.navbar")} value={theme.navbarStyle} onChange={(v) => set("navbarStyle", v)}>
              <Option value="glass" label="Glass">
                <Sketch nav="bg-primary-200/60" />
              </Option>
              <Option value="sticky" label="Sticky">
                <Sketch nav="bg-primary-300" />
              </Option>
              <Option value="default" label="Default">
                <Sketch nav="bg-slate-200" />
              </Option>
            </OptionGroup>
          </Section>
        </div>

        <div className="border-t border-line p-4">
          <button
            type="button"
            onClick={() => {
              reset();
              setCollapsed(false);
            }}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line py-2.5 text-[13px] font-semibold text-ink-soft transition-colors hover:border-primary hover:text-primary"
          >
            <RotateCcw className="h-4 w-4" />
            {t("customizer.reset")}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
