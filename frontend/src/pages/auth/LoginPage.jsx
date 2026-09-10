import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  LogIn,
  CheckCircle2,
  Loader2,
} from "lucide-react";

import { roleHome } from "@/constants/routePaths";
import { useAuthStore } from "@/store/useAuthStore";
import { notify } from "@/services/notify";

export function LoginPage() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (currentUser) return <Navigate to={roleHome(currentUser.role)} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const user = await login(email, password);
      notify.success(`Welcome back, ${user.name || user.email}`);
      navigate(roleHome(user.role), { replace: true });
    } catch (caught) {
      // The server answers with one message for an unknown address and a wrong
      // password alike, so that a failed sign-in cannot enumerate accounts.
      const message =
        caught?.response?.data?.error || "Incorrect email or password.";
      setError(message);
      notify.error("Sign-in failed", message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row overflow-hidden bg-white select-none">
      <div className="hidden md:flex w-full md:w-5/12 lg:w-5/12 h-full bg-linear-to-br from-[#0f172a] via-[#1e1b4b] to-[#312e81] text-white p-8 sm:p-12 lg:p-16 flex-col justify-between items-center text-center relative overflow-hidden shrink-0 shadow-2xl z-10">
        <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-purple-500/15 blur-3xl" />

        <div className="relative z-10 w-full flex flex-col items-center text-center my-auto">
          <div className="text-[13.5px] font-black tracking-[0.3em] text-indigo-300 uppercase mb-3 text-center">
            Query Management System
          </div>

          <h1 className="font-heading text-[52px] sm:text-[62px] font-black tracking-tight text-white leading-none mb-5 text-center drop-shadow-md">
            Welcome back!
          </h1>

          <p className="text-[17.5px] font-medium text-slate-300/90 leading-relaxed max-w-120 mx-auto text-center mb-10">
            Sign in to access your dashboard, track query workflows, review
            drafting documents, and manage Indian Pharmacopoeia Commission
            operations.
          </p>

          <div className="w-full max-w-115 mx-auto space-y-4 border-t border-white/10 pt-8 text-left">
            <div className="flex items-center gap-3.5 bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg">
              <div className="w-8.5 h-8.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 flex items-center justify-center shrink-0 shadow-inner">
                <CheckCircle2
                  className="h-5 w-5 text-indigo-300"
                  strokeWidth={2.5}
                />
              </div>
              <span className="text-[16px] font-bold text-white">
                Real-time multi-role workflow tracking
              </span>
            </div>

            <div className="flex items-center gap-3.5 bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg">
              <div className="w-8.5 h-8.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 flex items-center justify-center shrink-0 shadow-inner">
                <CheckCircle2
                  className="h-5 w-5 text-indigo-300"
                  strokeWidth={2.5}
                />
              </div>
              <span className="text-[16px] font-bold text-white">
                Role-based access control (RBAC) security
              </span>
            </div>

            <div className="flex items-center gap-3.5 bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-lg">
              <div className="w-8.5 h-8.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 flex items-center justify-center shrink-0 shadow-inner">
                <CheckCircle2
                  className="h-5 w-5 text-indigo-300"
                  strokeWidth={2.5}
                />
              </div>
              <span className="text-[16px] font-bold text-white">
                Automated dispatch & audit trail history
              </span>
            </div>
          </div>
        </div>

        <div className="relative z-10 pt-6 border-t border-white/10 text-[13.5px] font-semibold text-slate-400/80 text-center w-full">
          © 2026 Integrated Processing Centre • Indian Pharmacopoeia Commission
        </div>
      </div>

      <div className="w-full md:w-7/12 lg:w-7/12 h-full bg-white p-5 sm:p-12 lg:p-16 flex flex-col justify-center items-center overflow-y-auto">
        <div className="w-full max-w-120 my-auto space-y-5 sm:space-y-7">
          <div className="text-center">
            <h2 className="font-heading text-4xl sm:text-[52px] font-black text-slate-900 leading-none mb-2 sm:mb-3 tracking-tight text-center">
              Sign in
            </h2>
            <p className="text-[15px] sm:text-[17.5px] font-bold text-slate-500 text-center px-1 sm:px-0">
              Enter your credentials to continue to your workspace.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4 sm:space-y-6 pt-1 sm:pt-0">
            <div>
              <label
                htmlFor="login-email"
                className="block text-[15px] sm:text-[16px] font-black text-slate-800 mb-1.5 sm:mb-2.5"
              >
                Email
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  <Mail className="w-5.5 h-5.5" strokeWidth={2.2} />
                </div>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@ipc.example"
                  required
                  className="w-full pl-11 sm:pl-13 pr-4 py-3.5 sm:py-4.5 rounded-2xl border border-slate-200/90 bg-slate-50/50 hover:bg-white focus:bg-white text-base sm:text-[18px] font-bold text-slate-900 placeholder-slate-400 outline-none transition-all focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-[15px] sm:text-[16px] font-black text-slate-800 mb-1.5 sm:mb-2.5"
              >
                Password
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="w-5.5 h-5.5" strokeWidth={2.2} />
                </div>
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-11 sm:pl-13 pr-12 py-3.5 sm:py-4.5 rounded-2xl border border-slate-200/90 bg-slate-50/50 hover:bg-white focus:bg-white text-base sm:text-[18px] font-bold text-slate-900 placeholder-slate-400 outline-none transition-all focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer p-2"
                >
                  {showPassword ? (
                    <EyeOff className="w-5.5 h-5.5" />
                  ) : (
                    <Eye className="w-5.5 h-5.5" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-600 text-[13.5px] font-bold"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 sm:py-4.5 px-8 rounded-2xl bg-linear-to-r from-[#4f46e5] via-ring to-[#8b5cf6] text-white font-black text-base sm:text-[17px] shadow-xl shadow-indigo-500/30 hover:opacity-95 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-3 mt-4 sm:mt-5 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5.5 h-5.5 animate-spin" />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <LogIn className="w-5.5 h-5.5" strokeWidth={2.2} />
                  <span>Sign in</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
