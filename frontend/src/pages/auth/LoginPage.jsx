import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  LogIn,
  LayoutGrid,
  ChevronDown,
  CheckCircle2,
  Loader2,
} from "lucide-react";

import {
  MOCK_USERS,
  MOCK_PASSWORD,
  findUserByEmail,
} from "@/constants/mockUsers";
import { ROLE_LABELS } from "@/constants/roles";
import { roleHome } from "@/constants/routePaths";
import { useAuthStore } from "@/store/useAuthStore";

const roleColors = {
  Inquirer: { bg: "#eff6ff", text: "#2563eb", border: "#bfdbfe" },
  "Front Office": { bg: "#f0fdf4", text: "#16a34a", border: "#bbf7d0" },
  "Officer-in-Charge": { bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
  "Assigned Official": { bg: "#f5f3ff", text: "#7c3aed", border: "#ddd6fe" },
  Reviewer: { bg: "#fdf2f8", text: "#db2777", border: "#fbcfe8" },
  Admin: { bg: "#fff1f2", text: "#e11d48", border: "#fecdd3" },
  "Super Admin": { bg: "#fff7ed", text: "#ea580c", border: "#fed7aa" },
};

function getInitials(name) {
  return (name || "")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
}

export function LoginPage() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeUser, setActiveUser] = useState(null);
  const [error, setError] = useState(null);
  const [showMocks, setShowMocks] = useState(false);

  if (currentUser) return <Navigate to={roleHome(currentUser.role)} replace />;

  const submit = (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    setTimeout(() => {
      setLoading(false);
      const user = findUserByEmail(email);

      if (!user || password !== MOCK_PASSWORD) {
        setError("Incorrect email or password.");
        return;
      }

      login(user.id);
      navigate(roleHome(user.role), { replace: true });
    }, 600);
  };

  const applyCredentials = (user) => {
    setEmail(user.email);
    setPassword(MOCK_PASSWORD);
    setActiveUser(user.name);
    setError(null);
    setShowMocks(false);
  };

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row overflow-hidden bg-white select-none">
      <div className="w-full md:w-5/12 lg:w-5/12 h-full bg-linear-to-br from-[#0f172a] via-[#1e1b4b] to-[#312e81] text-white p-8 sm:p-12 lg:p-16 flex flex-col justify-between items-center text-center relative overflow-hidden shrink-0 shadow-2xl z-10">
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

      <div className="w-full md:w-7/12 lg:w-7/12 h-full bg-white p-8 sm:p-12 lg:p-16 flex flex-col justify-center items-center overflow-y-auto">
        <div className="w-full max-w-120 my-auto space-y-7">
          <div className="text-center">
            <h2 className="font-heading text-[44px] sm:text-[52px] font-black text-slate-900 leading-none mb-3 tracking-tight text-center">
              Sign in
            </h2>
            <p className="text-[17.5px] font-bold text-slate-500 text-center">
              Enter your credentials to continue to your workspace.
            </p>
          </div>

          <div className="relative z-30">
            <button
              type="button"
              onClick={() => setShowMocks(!showMocks)}
              className="w-full flex items-center justify-between px-4.5 py-4 rounded-2xl bg-indigo-50/70 hover:bg-indigo-100/70 border border-indigo-200/90 text-[15.5px] font-black text-slate-800 transition-all shadow-2xs cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-8.5 h-8.5 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <LayoutGrid className="w-5 h-5" strokeWidth={2.2} />
                </div>
                <div className="flex items-center gap-2">
                  <span>Mock Credentials</span>
                  <span className="text-[11.5px] font-black uppercase px-2.5 py-0.5 rounded-full bg-indigo-200/80 text-indigo-900 tracking-wider">
                    Dev Only
                  </span>
                </div>
              </div>
              <ChevronDown
                className={`w-5.5 h-5.5 text-indigo-600 transition-transform duration-200 ${showMocks ? "rotate-180" : ""}`}
              />
            </button>

            {showMocks && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl border border-slate-200/90 shadow-2xl p-3.5 z-50 animate-in fade-in-50 zoom-in-95">
                <div className="p-2 border-b border-slate-100 mb-2 flex justify-between items-center">
                  <span className="text-[13px] font-extrabold text-slate-600">
                    Quick select demo user:
                  </span>
                  <span className="text-[12px] font-mono font-black bg-slate-100 px-2.5 py-1 rounded-lg text-indigo-700">
                    Password: {MOCK_PASSWORD}
                  </span>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {MOCK_USERS.map((user) => {
                    const roleLabel = ROLE_LABELS[user.role] || user.role;
                    const c = roleColors[roleLabel] ?? {
                      bg: "#f8fafc",
                      text: "#64748b",
                      border: "#e2e8f0",
                    };
                    const isActive = activeUser === user.name;

                    return (
                      <div
                        key={user.id}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                          isActive
                            ? "bg-indigo-50/90 border-indigo-200 shadow-2xs"
                            : "bg-white border-slate-200/60 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="w-8.5 h-8.5 rounded-full flex items-center justify-center font-black text-[12.5px] shrink-0 border shadow-2xs"
                            style={{
                              backgroundColor: c.bg,
                              color: c.text,
                              borderColor: c.border,
                            }}
                          >
                            {getInitials(user.name)}
                          </span>
                          <div className="min-w-0 flex-1 truncate">
                            <div className="text-[14.5px] font-black text-slate-800 truncate leading-tight">
                              {user.name}
                            </div>
                            <div className="text-[12.5px] font-bold text-slate-500 truncate mt-0.5">
                              {roleLabel}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => applyCredentials(user)}
                          aria-label={`Use Credentials for ${user.name}`}
                          className={`px-3.5 py-1.5 rounded-lg text-[12.5px] font-black transition-all shrink-0 ml-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            isActive
                              ? "bg-indigo-600 text-white shadow-xs"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {isActive ? "✓ Selected" : "Use"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <form onSubmit={submit} className="space-y-6">
            <div>
              <label
                htmlFor="login-email"
                className="block text-[16px] font-black text-slate-800 mb-2.5"
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
                  className="w-full pl-13 pr-4 py-4.5 rounded-2xl border border-slate-200/90 bg-slate-50/50 hover:bg-white focus:bg-white text-[17px] sm:text-[18px] font-bold text-slate-900 placeholder-slate-400 outline-none transition-all focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-[16px] font-black text-slate-800 mb-2.5"
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
                  className="w-full pl-13 pr-12 py-4.5 rounded-2xl border border-slate-200/90 bg-slate-50/50 hover:bg-white focus:bg-white text-[17px] sm:text-[18px] font-bold text-slate-900 placeholder-slate-400 outline-none transition-all focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
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
              className="w-full py-4.5 px-8 rounded-2xl bg-linear-to-r from-[#4f46e5] via-ring to-[#8b5cf6] text-white font-black text-[17px] shadow-xl shadow-indigo-500/30 hover:opacity-95 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-3 mt-3 disabled:opacity-70 disabled:cursor-not-allowed"
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
