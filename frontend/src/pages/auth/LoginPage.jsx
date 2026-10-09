import { useState } from "react";
import { Navigate, useNavigate, Link } from "react-router-dom";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  User,
  LogIn,
  Loader2,
  ChevronDown,
  Zap,
  Sparkles,
  ShieldCheck,
} from "lucide-react";

import { ROUTE_PATHS, roleHome } from "@/constants/routePaths";
import { useAuthStore } from "@/store/useAuthStore";
import { MOCK_USERS } from "@/constants/mockUsers";
import { HeroBackdrop } from "@/components/common/HeroBackdrop";
import { IPC_FRONT_OFFICE_NAME } from "@/constants/orgBranding";
import { notify } from "@/services/notify";

const FIELD =
  "w-full rounded-xl border border-slate-200 bg-slate-50/70 py-3 ps-11 text-[14px] font-medium text-slate-800 placeholder:text-slate-400 outline-none transition-all duration-200 focus:bg-white focus:border-sky-500 focus:ring-4 focus:ring-sky-400/20 shadow-xs";

/** The sign in actions sharing loading flag and error handling. */
function useLoginActions() {
  const login = useAuthStore((state) => state.login);
  const devLogin = useAuthStore((state) => state.devLogin);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (email, password) => {
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

  const quickLogin = async (accountEmail) => {
    if (!accountEmail) return;
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

  return { loading, error, setError, submit, quickLogin };
}

function LoginHero() {
  return (
    <aside className="relative z-10 hidden h-full flex-1 flex-col items-center justify-center overflow-hidden px-6 lg:flex max-w-xl">
      <div className="relative z-10 my-auto flex max-w-xl flex-col items-center justify-center text-center">
        <div className="flex flex-col items-center justify-center gap-2.5">
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
            <div className="mt-0.5 font-heading text-[18px] font-extrabold uppercase tracking-wider text-white xl:text-[20px]">
              Indian Pharmacopoeia Commission
            </div>
          </div>
        </div>

        <h1 className="mt-6 font-heading text-[36px] font-extrabold leading-[1.15] tracking-tight text-white xl:text-[42px]">
          <span className="block">Join the AI-powered</span>{" "}
          <span className="block">IP Stakeholders’</span>{" "}
          <span className="block bg-linear-to-r from-sky-200 via-cyan-200 to-indigo-200 bg-clip-text text-transparent">
            BRIDGETECH
          </span>
        </h1>

        <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-white/90">
          Create your IPC QMS user account to request monograph reviews, track technical enquiries, and access official pharmacopoeia workflows.
        </p>

        <div className="mx-auto mt-6 flex max-w-lg flex-wrap items-center justify-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-[14px] font-bold text-white shadow-sm backdrop-blur-md transition-transform hover:scale-105">
            <Sparkles className="h-4.5 w-4.5 text-amber-300" />
            <span>IP 2026 Monographs</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-[14px] font-bold text-white shadow-sm backdrop-blur-md transition-transform hover:scale-105">
            <ShieldCheck className="h-4.5 w-4.5 text-emerald-300" />
            <span>ISO 17025 Certified</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-[14px] font-bold text-white shadow-sm backdrop-blur-md transition-transform hover:scale-105">
            <Zap className="h-4.5 w-4.5 text-sky-300" />
            <span>24H SLA Protocol</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function PasswordField({ password, onChange }) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div>
      <label
        htmlFor="login-password"
        className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-bold text-slate-700"
      >
        <Lock className="h-4 w-4 text-slate-600" strokeWidth={2} />
        <span>Password</span>
      </label>
      <div className="relative">
        <Lock
          className="pointer-events-none absolute inset-s-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400"
          strokeWidth={2}
        />
        <input
          id="login-password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          required
          className={`${FIELD} pe-11`}
        />
        <button
          type="button"
          aria-label={
            showPassword ? "Hide password" : "Show password"
          }
          onClick={() => setShowPassword(!showPassword)}
          className="absolute inset-e-2 top-1/2 -translate-y-1/2 cursor-pointer p-1.5 text-slate-400 transition-colors hover:text-slate-600"
        >
          {showPassword ? (
            <EyeOff className="h-4.5 w-4.5" />
          ) : (
            <Eye className="h-4.5 w-4.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function SubmitButton({ loading }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="mt-1.5 flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 py-3.5 px-6 text-[15px] font-bold text-white shadow-lg shadow-blue-600/30 transition-all duration-200 hover:from-blue-700 hover:via-indigo-700 hover:to-blue-800 hover:shadow-blue-600/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
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
  );
}

function DevQuickLogin({ loading, nicFrontOfficeEmail, onPickNicAccount, onQuickLogin }) {
  const [devOpen, setDevOpen] = useState(false);

  return (
    <div className="mt-4 border-t border-slate-200/80 pt-3">
      <div className="mb-1.5 flex items-center justify-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-blue-600" strokeWidth={2.5} />
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
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
          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 py-2 ps-3.5 pe-3 text-[13.5px] font-medium text-slate-600 outline-none transition-colors hover:border-sky-300 hover:bg-slate-100/80 focus:border-sky-500 focus:ring-2 focus:ring-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span>Sign in as…</span>
          <ChevronDown
            className={`h-4.5 w-4.5 transition-transform ${devOpen ? "rotate-180" : ""}`}
            strokeWidth={2.2}
          />
        </button>

        {devOpen && (
          <div className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-60 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl">
            {nicFrontOfficeEmail && (
              <button
                type="button"
                onClick={() => {
                  setDevOpen(false);
                  onPickNicAccount();
                }}
                className="group mb-1 flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-2.5 py-2 text-start transition-colors hover:bg-emerald-50"
              >
                <div className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[12px] font-semibold text-white">
                  IPC
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-semibold text-slate-800 group-hover:text-emerald-700">
                      {IPC_FRONT_OFFICE_NAME}
                    </span>
                    <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      NICeMail
                    </span>
                  </div>
                  <div className="truncate text-[12px] text-slate-500">
                    {nicFrontOfficeEmail} · needs password
                  </div>
                </div>
              </button>
            )}

            {MOCK_USERS.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => {
                  if (!user.email) return;
                  setDevOpen(false);
                  onQuickLogin(user.email);
                }}
                className="group flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-start transition-colors hover:bg-sky-50"
              >
                <div className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[12px] font-semibold text-sky-700">
                  {user.name
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-semibold text-slate-800 group-hover:text-sky-700">
                      {user.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-sky-100/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                      {user.role.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div className="truncate text-[12px] text-slate-500">
                    {user.email}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LoginFooter() {
  return (
    <footer className="mt-4 flex flex-col items-center gap-1 text-center">
      <p className="text-[11.5px] text-white/80">
        © 2026 Integrated Processing Centre · Indian Pharmacopoeia Commission
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-semibold text-white/95">
          Powered by
        </span>
        <span className="brand-plate">
          <img
            src="/anuvadini_new_logo 2.png"
            alt="Anuvadini"
            width="512"
            height="288"
            className="h-9 w-30 object-cover"
          />
        </span>
      </div>
    </footer>
  );
}

export function LoginPage() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const { loading, error, setError, submit, quickLogin } = useLoginActions();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const nicFrontOfficeEmail = (
    import.meta.env.VITE_NIC_FRONT_OFFICE_EMAIL || ""
  ).trim();

  const home = currentUser ? roleHome(currentUser.role) : null;
  if (home && home !== ROUTE_PATHS.LOGIN) return <Navigate to={home} replace />;

  const onSubmit = (event) => {
    event.preventDefault();
    return submit(email, password);
  };

  const pickNicAccount = () => {
    setEmail(nicFrontOfficeEmail);
    setPassword("");
    setError(null);
    document.getElementById("login-password")?.focus();
  };

  return (
    <div className="relative flex h-screen max-h-screen w-full items-center justify-center overflow-hidden bg-primary text-white">
      <HeroBackdrop />

      <div className="relative z-10 flex h-full w-full max-w-[1440px] items-center justify-center gap-20 lg:gap-32 xl:gap-44 px-6 lg:px-14">
        <LoginHero />

        <main className="flex h-full w-full flex-col items-center justify-center overflow-hidden lg:flex-1 max-w-xl">
          <div className="my-auto flex w-full max-w-[490px] flex-col items-center justify-center">
            {/* Form Container with Premium Layered Borders & Badge */}
            <div className="relative w-full pt-7">
              {/* Top Badge Icon floating centered over top edge */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 flex items-center justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600/20 p-1.5 backdrop-blur-md shadow-lg shadow-blue-500/20 ring-4 ring-white">
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-500 text-white shadow-inner">
                    <User className="h-6 w-6" strokeWidth={2.2} />
                  </div>
                </div>
              </div>

              {/* Outer Cyan-to-Violet Layered Border Wrapper */}
              <div className="relative rounded-[26px] p-[2px] bg-gradient-to-b from-cyan-300 via-blue-500/60 to-indigo-500/90 shadow-[0_20px_50px_-10px_rgba(15,23,42,0.35),0_0_25px_rgba(56,189,248,0.2)]">
                {/* Inner White Card */}
                <div className="relative overflow-hidden rounded-[24px] bg-white/95 px-8 pt-9 pb-8 sm:px-10 sm:pt-10 sm:pb-9 backdrop-blur-xl">
                  {/* Top Accent Gradient Bar */}
                  <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-sky-400 via-indigo-500 to-cyan-400" />

                  {/* Heading & Subtitle */}
                  <div className="mb-6 text-center">
                    <h2 className="font-heading text-[26px] sm:text-[28px] font-extrabold tracking-tight text-[#0f172a] whitespace-nowrap">
                      Sign in
                    </h2>
                    <p className="mt-1 text-[13px] sm:text-[13.5px] text-slate-500 font-medium leading-relaxed max-w-none whitespace-nowrap mx-auto">
                      Enter your credentials to continue to your workspace.
                    </p>
                  </div>

                  <form onSubmit={onSubmit} className="space-y-4">
                    <div>
                      <label
                        htmlFor="login-email"
                        className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-bold text-slate-700"
                      >
                        <Mail className="h-4 w-4 text-slate-600" strokeWidth={2} />
                        <span>Email</span>
                      </label>
                      <div className="relative">
                        <Mail
                          className="pointer-events-none absolute inset-s-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400"
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

                    <PasswordField password={password} onChange={setPassword} />

                    {error && (
                      <div
                        role="alert"
                        className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-[12.5px] font-medium text-red-700"
                      >
                        {error}
                      </div>
                    )}

                    <SubmitButton loading={loading} />
                  </form>

                  <div className="mt-5 border-t border-slate-200/60 pt-4 text-center text-[14px] font-medium text-slate-500">
                    Don&apos;t have an account?{" "}
                    <Link
                      to={ROUTE_PATHS.SIGNUP}
                      className="font-semibold text-blue-600 transition-colors hover:text-blue-700 hover:underline"
                    >
                      Sign Up
                    </Link>
                  </div>

                  {import.meta.env.DEV && (
                    <DevQuickLogin
                      loading={loading}
                      nicFrontOfficeEmail={nicFrontOfficeEmail}
                      onPickNicAccount={pickNicAccount}
                      onQuickLogin={quickLogin}
                    />
                  )}
                </div>
              </div>
            </div>

            <LoginFooter />
          </div>
        </main>
      </div>
    </div>
  );
}
