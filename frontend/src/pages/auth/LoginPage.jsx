import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  LogIn,
  Loader2,
  ChevronDown,
  Zap,
  Sparkles,
  ShieldCheck,
} from "lucide-react";

import { ROUTE_PATHS, roleHome } from "@/constants/routePaths";
import { useAuthStore } from "@/store/useAuthStore";
import { useResolvedMode } from "@/components/theme/themeRuntime";
import { MOCK_USERS } from "@/constants/mockUsers";
import { HeroBackdrop } from "@/components/common/HeroBackdrop";
import { PageBackdrop } from "@/components/common/PageBackdrop";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { IPC_FRONT_OFFICE_NAME } from "@/constants/orgBranding";
import { notify } from "@/services/notify";

const FIELD =
  "w-full rounded-lg border border-line bg-surface py-3 ps-11 text-[15px] text-ink placeholder:text-ink-muted outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

export function LoginPage() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const login = useAuthStore((state) => state.login);
  const devLogin = useAuthStore((state) => state.devLogin);
  const googleLogin = useAuthStore((state) => state.googleLogin);
  const resolved = useResolvedMode();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [devOpen, setDevOpen] = useState(false);

  const nicFrontOfficeEmail = (
    import.meta.env.VITE_NIC_FRONT_OFFICE_EMAIL || ""
  ).trim();
  const googleEnabled = Boolean(
    (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim(),
  );
  const isDark = resolved === "dark";

  const home = currentUser ? roleHome(currentUser.role) : null;
  if (home && home !== ROUTE_PATHS.LOGIN) return <Navigate to={home} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const user = await login(email, password);
      notify.success(`Welcome back, ${user.name || user.email}`);
      navigate(roleHome(user.role), { replace: true });
    } catch (caught) {
      const message =
        caught?.response?.data?.error || "Incorrect email or password.";
      setError(message);
      notify.error("Sign-in failed", message);
    } finally {
      setLoading(false);
    }
  };

  const googleSubmit = async (credential) => {
    setLoading(true);
    setError(null);

    try {
      const user = await googleLogin(credential);
      notify.success(`Welcome back, ${user.name || user.email}`);
      navigate(roleHome(user.role), { replace: true });
    } catch (caught) {
      const message =
        caught?.response?.data?.error ||
        "Google sign-in failed. Please try again.";
      setError(message);
      notify.error("Sign-in failed", message);
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = async (accountEmail) => {
    if (!accountEmail) return;
    setDevOpen(false);
    setLoading(true);
    setError(null);

    try {
      const user = await devLogin(accountEmail);
      notify.success(`Signed in as ${user.name}`);
      navigate(roleHome(user.role), { replace: true });
    } catch (caught) {
      const message = caught?.response?.data?.error || "Dev sign-in failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-surface-muted text-ink">
      <aside className="relative hidden w-1/2 overflow-hidden bg-primary text-white lg:flex lg:flex-col lg:items-center lg:justify-center lg:py-12">
        <HeroBackdrop />

        <div className="relative z-10 max-w-xl px-10 text-center xl:px-12">
          <div className="flex flex-col items-center justify-center gap-3">
            <img
              src="/imageFile1.png"
              alt="IPC Emblem Logo"
              width="103"
              height="199"
              className="h-24 w-auto object-contain drop-shadow-lg brightness-110"
            />
            <div className="text-center leading-tight">
              <div className="text-[17px] font-semibold tracking-wide text-white/95 xl:text-[18px]">
                भारतीय भेषज संहिता आयोग
              </div>
              <div className="mt-1 font-heading text-[19px] font-extrabold uppercase tracking-wider text-white xl:text-[21px]">
                Indian Pharmacopoeia Commission
              </div>
            </div>
          </div>

          <h1 className="mt-9 font-heading text-[40px] font-extrabold leading-[1.15] tracking-tight text-white xl:text-[46px]">
            <span className="block">AI-powered IP</span>{" "}
            <span className="block">Stakeholder’s</span>{" "}
            <span className="block bg-linear-to-r from-[#bae6fd] via-[#a5f3fc] to-status-indigo-line bg-clip-text text-transparent">
              BRIDGETECH
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-lg text-[15.5px] leading-relaxed text-white/90">
            Indian Pharmacopoeia Commission — official AI-powered IP Stakeholder’s BRIDGETECH for handling technical enquiries, monograph reviews, reference standards, and automated dispatch operations.
          </p>

          <div className="mx-auto mt-8 flex max-w-lg flex-wrap items-center justify-center gap-3.5">
            <div className="flex items-center gap-2.5 rounded-full border border-white/25 bg-white/10 px-5 py-3 text-[15px] font-bold text-white shadow-sm backdrop-blur-md transition-transform hover:scale-105">
              <Sparkles className="h-5 w-5 text-amber-300" />
              <span>IP 2026 Monographs</span>
            </div>
            <div className="flex items-center gap-2.5 rounded-full border border-white/25 bg-white/10 px-5 py-3 text-[15px] font-bold text-white shadow-sm backdrop-blur-md transition-transform hover:scale-105">
              <ShieldCheck className="h-5 w-5 text-emerald-300" />
              <span>ISO 17025 Certified</span>
            </div>
            <div className="flex items-center gap-2.5 rounded-full border border-white/25 bg-white/10 px-5 py-3 text-[15px] font-bold text-white shadow-sm backdrop-blur-md transition-transform hover:scale-105">
              <Zap className="h-5 w-5 text-sky-300" />
              <span>24H SLA Protocol</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="relative isolate flex w-full flex-col items-center justify-center overflow-y-auto px-5 py-10 sm:px-10 lg:w-1/2">
        <PageBackdrop />

        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-transparent bg-surface p-6 pt-5 shadow-card sm:p-8 sm:pt-5 dark:border-line/60">
            <div className="flex items-end justify-between gap-4">
              <h2 className="font-heading text-[28px] font-bold leading-tight text-ink sm:text-[30px]">
                Sign in
              </h2>
              <img
                src="/imageFile1.png"
                alt="IPC Emblem Logo"
                width="103"
                height="199"
                className="h-20 w-auto shrink-0 object-contain sm:h-22"
              />
            </div>
            <p className="mt-1.5 text-[13.5px] text-ink-muted">
              Enter your credentials to continue to your workspace.
            </p>

            <form onSubmit={submit} className="mt-7 space-y-5">
              <div>
                <label
                  htmlFor="login-email"
                  className="mb-2 block text-[14px] font-medium text-ink-soft"
                >
                  Email
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute inset-s-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted"
                    strokeWidth={2}
                  />
                  <input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@ipc.example"
                    required
                    className={`${FIELD} pe-4`}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="mb-2 block text-[14px] font-medium text-ink-soft"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute inset-s-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted"
                    strokeWidth={2}
                  />
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className={`${FIELD} pe-12`}
                  />
                  <button
                    type="button"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-e-2 top-1/2 -translate-y-1/2 cursor-pointer p-2 text-ink-muted transition-colors hover:text-ink"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-[13.5px] font-medium text-red-700"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg bg-primary px-8 py-3 text-[15px] font-semibold text-white shadow-[0_10px_20px_-8px] shadow-primary/60 transition-[background-color,transform] hover:bg-primary-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Signing in…</span>
                  </>
                ) : (
                  <>
                    <LogIn
                      className="h-5 w-5 rtl:rotate-180"
                      strokeWidth={2.2}
                    />
                    <span>Sign in</span>
                  </>
                )}
              </button>
            </form>

            {googleEnabled && (
              <div className="mt-5">
                <div className="mb-4 flex items-center gap-3 text-[12px] font-medium uppercase tracking-widest text-ink-muted">
                  <span className="h-px flex-1 bg-line" aria-hidden="true" />
                  or
                  <span className="h-px flex-1 bg-line" aria-hidden="true" />
                </div>
                <GoogleSignInButton
                  onCredential={googleSubmit}
                  onError={setError}
                  dark={isDark}
                />
              </div>
            )}

            {import.meta.env.DEV && (
              <div className="mt-7 border-t border-dashed border-line pt-5">
                <div className="mb-2.5 flex items-center justify-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />
                  <span className="text-[11.5px] font-semibold uppercase tracking-widest text-ink-muted">
                    Dev quick login
                  </span>
                </div>

                <div className="relative">
                  {devOpen && (
                    <button
                      type="button"
                      aria-label="Close dev quick login menu"
                      className="fixed inset-0 z-20 cursor-default"
                      onClick={() => setDevOpen(false)}
                    />
                  )}

                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setDevOpen((open) => !open)}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted py-3 ps-4 pe-3 text-[14px] font-medium text-ink-muted outline-none transition-colors hover:border-primary-300 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span>Sign in as…</span>
                    <ChevronDown
                      className={`h-5 w-5 transition-transform ${devOpen ? "rotate-180" : ""}`}
                      strokeWidth={2.2}
                    />
                  </button>

                  {devOpen && (
                    <div className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
                      {nicFrontOfficeEmail && (
                        <button
                          type="button"
                          onClick={() => {
                            setEmail(nicFrontOfficeEmail);
                            setPassword("");
                            setDevOpen(false);
                            setError(null);
                            document.getElementById("login-password")?.focus();
                          }}
                          className="group mb-1.5 flex w-full cursor-pointer items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-start transition-colors hover:bg-emerald-50"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[12.5px] font-semibold text-white">
                            IPC
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[14px] font-semibold text-ink group-hover:text-emerald-700">
                                {IPC_FRONT_OFFICE_NAME}
                              </span>
                              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                NICeMail
                              </span>
                            </div>
                            <div className="truncate text-[12.5px] text-ink-muted">
                              {nicFrontOfficeEmail} · needs its password
                            </div>
                          </div>
                        </button>
                      )}

                      {MOCK_USERS.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => quickLogin(user.email)}
                          className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-start transition-colors hover:bg-primary-50"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[12.5px] font-semibold text-primary">
                            {user.name
                              .split(" ")
                              .map((part) => part[0])
                              .slice(0, 2)
                              .join("")}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[14px] font-semibold text-ink group-hover:text-primary">
                                {user.name}
                              </span>
                              <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                {user.role.replaceAll("_", " ")}
                              </span>
                            </div>
                            <div className="truncate text-[12.5px] text-ink-muted">
                              {user.email}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <footer className="mt-6 flex flex-col items-center gap-2 text-center">
            <p className="text-[12px] text-ink-muted">
              © 2026 Integrated Processing Centre · Indian Pharmacopoeia
              Commission
            </p>
            <div className="flex items-center gap-2.5">
              <span className="text-[13.5px] font-semibold text-ink-soft">
                Powered by
              </span>
              <span className="brand-plate">
                <img
                  src="/anuvadini_new_logo 2.png"
                  alt="Anuvadini"
                  width="512"
                  height="288"
                  className="h-11 w-36 object-cover"
                />
              </span>
            </div>
          </footer>
        </div>
      </main>

    </div>
  );
}
