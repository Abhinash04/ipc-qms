import { useState } from "react";
import { Navigate, useNavigate, Link } from "react-router-dom";
import {
  User,
  Mail,
  Building2,
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  UserPlus,
  CheckCircle2,
  Loader2,
} from "lucide-react";

import { ROUTE_PATHS, roleHome } from "@/constants/routePaths";
import { ROLES, ROLE_LABELS } from "@/constants/roles";
import { useAuthStore } from "@/store/useAuthStore";
import { register } from "@/services/api/authService";
import { notify } from "@/services/notify";

export function SignUpPage() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const googleAuthStore = useAuthStore((state) => state.googleAuth);
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState(null);

  if (currentUser) return <Navigate to={roleHome(currentUser.role)} replace />;

  const loadGisScript = () => {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) {
        resolve(window.google.accounts.id);
        return;
      }
      const existingScript = document.getElementById("google-gsi-script");
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(window.google?.accounts?.id));
        existingScript.addEventListener("error", () => reject(new Error("Failed to load GIS script")));
        return;
      }
      const script = document.createElement("script");
      script.id = "google-gsi-script";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.google?.accounts?.id);
      script.onerror = () => reject(new Error("Failed to load GIS script"));
      document.head.appendChild(script);
    });
  };

  const processGoogleCredential = async (credentialToken) => {
    setGoogleLoading(true);
    setError(null);
    try {
      const res = await googleAuthStore(credentialToken, department.trim());
      if (res?.user) {
        notify.success(`Signed in with Google as ${res.user.name}`);
        navigate(roleHome(res.user.role), { replace: true });
      } else if (res?.code === "DEPARTMENT_REQUIRED") {
        setError("Please select your Department using the Department field above to complete registration.");
      } else if (res?.code === "LOCAL_ACCOUNT_EXISTS") {
        setError("An account with this email already exists. Please sign in using your existing account.");
      } else if (res?.code === "GOOGLE_NOT_CONFIGURED") {
        setError("Google Sign Up is not configured yet.");
      } else {
        setError(res?.message || "Google authentication failed. Please try again.");
      }
    } catch (caught) {
      const status = caught?.response?.status;
      const data = caught?.response?.data;
      const backendMessage = data?.message || data?.error;
      const code = data?.code;

      if (code === "DEPARTMENT_REQUIRED" || (status === 400 && code === "DEPARTMENT_REQUIRED")) {
        setError("Please select your Department using the Department field above to complete registration.");
      } else if (code === "LOCAL_ACCOUNT_EXISTS" || status === 409) {
        setError("An account with this email already exists. Please sign in using your existing account.");
      } else if (code === "GOOGLE_NOT_CONFIGURED" || status === 503) {
        setError("Google Sign Up is not configured yet.");
      } else if (backendMessage) {
        setError(backendMessage);
      } else {
        setError("Google authentication failed. Please try again.");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

    if (!clientId || !clientId.trim()) {
      setError("Google Sign Up is not configured yet.");
      return;
    }

    setGoogleLoading(true);
    try {
      const googleAccountsId = await loadGisScript();
      if (!googleAccountsId) {
        throw new Error("Google Identity Services unavailable");
      }

      googleAccountsId.initialize({
        client_id: clientId.trim(),
        callback: async (response) => {
          if (!response?.credential) {
            setError("Google authentication was cancelled or failed.");
            setGoogleLoading(false);
            return;
          }
          await processGoogleCredential(response.credential);
        },
        auto_select: false,
        use_fedcm_for_prompt: false,
      });

      googleAccountsId.prompt((notification) => {
        if (notification.isNotDisplayed()) {
          const reason = notification.getNotDisplayedReason();
          setGoogleLoading(false);
          if (reason === "unregistered_origin") {
            setError("Google Sign-In Error: http://localhost:5173 is not listed in Google Cloud Console 'Authorized JavaScript origins'.");
          } else if (reason === "opt_out_or_clear_opt_out") {
            setError("Google One Tap was closed previously. Please clear browser cookies/site settings or try Incognito mode.");
          } else {
            setError("Unable to display Google account selector. Please ensure http://localhost:5173 is authorized in Google Cloud Console.");
          }
        } else if (notification.isSkippedMoment()) {
          setGoogleLoading(false);
        }
      });
    } catch {
      setGoogleLoading(false);
      setError("Google Sign Up is not configured yet.");
    }
  };


  const validate = () => {
    if (
      !fullName.trim() ||
      !email.trim() ||
      !department.trim() ||
      !password ||
      !confirmPassword
    ) {
      return "All fields are required.";
    }

    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email.trim())) {
      return "Please enter a valid email address.";
    }

    if (password !== confirmPassword) {
      return "Password and Confirm Password do not match.";
    }

    return null;
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      await register({
        name: fullName.trim(),
        email: email.trim(),
        department: department.trim(),
        role: role || ROLES.INQUIRER,
        password,
        confirmPassword,
      });

      notify.success("Account created successfully! Please sign in.");
      navigate(ROUTE_PATHS.LOGIN);
    } catch (caught) {
      const status = caught?.response?.status;
      const backendMessage = caught?.response?.data?.message || caught?.response?.data?.error;

      if (status === 409) {
        setError("An account with this email already exists. Please sign in.");
      } else if (status === 400 && backendMessage) {
        setError(backendMessage);
      } else {
        setError("Unable to create your account. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row overflow-hidden bg-white select-none">
      <aside className="hidden md:flex w-full md:w-5/12 lg:w-5/12 h-full bg-linear-to-br from-[#0f172a] via-[#1e1b4b] to-[#312e81] text-white p-6 sm:p-10 lg:p-12 flex-col justify-between items-center text-center relative overflow-hidden shrink-0 shadow-2xl z-10">
        <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-purple-500/15 blur-3xl" />

        <div className="relative z-10 w-full flex flex-col items-center text-center my-auto">
          <div className="text-[12px] font-bold tracking-[0.25em] text-indigo-300 uppercase mb-2.5 text-center">
            Query Management System
          </div>

          <h1 className="font-heading text-[38px] sm:text-[46px] font-black tracking-tight text-white leading-none mb-4 text-center drop-shadow-md">
            Join IPC QMS
          </h1>

          <p className="text-[15px] font-medium text-slate-300/90 leading-relaxed max-w-105 mx-auto text-center mb-8">
            Create an account to submit enquiries, track query workflows, review
            pharmacopoeia documents, and collaborate with IPC officers.
          </p>

          <div className="w-full max-w-105 mx-auto space-y-3 border-t border-white/10 pt-6 text-left">
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-md p-3.5 rounded-xl border border-white/10 shadow-lg">
              <div className="w-7.5 h-7.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 flex items-center justify-center shrink-0 shadow-inner">
                <CheckCircle2
                  className="h-4.5 w-4.5 text-indigo-300"
                  strokeWidth={2.5}
                />
              </div>
              <span className="text-[14.5px] font-semibold text-white">
                Streamlined enquiry submission & tracking
              </span>
            </div>

            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-md p-3.5 rounded-xl border border-white/10 shadow-lg">
              <div className="w-7.5 h-7.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 flex items-center justify-center shrink-0 shadow-inner">
                <CheckCircle2
                  className="h-4.5 w-4.5 text-indigo-300"
                  strokeWidth={2.5}
                />
              </div>
              <span className="text-[14.5px] font-semibold text-white">
                Direct coordination with IPC officials
              </span>
            </div>

            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-md p-3.5 rounded-xl border border-white/10 shadow-lg">
              <div className="w-7.5 h-7.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 flex items-center justify-center shrink-0 shadow-inner">
                <CheckCircle2
                  className="h-4.5 w-4.5 text-indigo-300"
                  strokeWidth={2.5}
                />
              </div>
              <span className="text-[14.5px] font-semibold text-white">
                Real-time updates & status notifications
              </span>
            </div>
          </div>
        </div>

        <div className="relative z-10 pt-4 border-t border-white/10 text-[12.5px] font-medium text-slate-400/80 text-center w-full">
          © 2026 Integrated Processing Centre • Indian Pharmacopoeia Commission
        </div>
      </aside>

      <main className="w-full md:w-7/12 lg:w-7/12 h-full bg-white p-5 sm:p-8 lg:p-12 flex flex-col justify-center items-center overflow-y-auto">
        <div className="w-full max-w-110 my-auto space-y-3.5 sm:space-y-4 py-2">
          <div className="text-center mb-1 sm:mb-2">
            <h2 className="font-heading text-2xl sm:text-[34px] font-black text-slate-900 leading-none mb-1.5 tracking-tight text-center">
              Sign Up
            </h2>
            <p className="text-[13.5px] sm:text-[14.5px] font-medium text-slate-500 text-center px-1 sm:px-0">
              Enter your details to register for a QMS account.
            </p>
          </div>

          <form onSubmit={submit} noValidate className="space-y-3 sm:space-y-3.5">
            <div>
              <label
                htmlFor="signup-fullname"
                className="block text-[13px] sm:text-[14px] font-bold text-slate-700 mb-1"
              >
                Full Name
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <User className="w-4.5 h-4.5" strokeWidth={2} />
                </div>
                <input
                  id="signup-fullname"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full pl-10 sm:pl-11 pr-3.5 py-2.5 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-white focus:bg-white text-sm sm:text-[15px] font-medium text-slate-900 placeholder-slate-400 outline-none transition-colors focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="signup-email"
                className="block text-[13px] sm:text-[14px] font-bold text-slate-700 mb-1"
              >
                Email
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Mail className="w-4.5 h-4.5" strokeWidth={2} />
                </div>
                <input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@ipc.example"
                  className="w-full pl-10 sm:pl-11 pr-3.5 py-2.5 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-white focus:bg-white text-sm sm:text-[15px] font-medium text-slate-900 placeholder-slate-400 outline-none transition-colors focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
              <div>
                <label
                  htmlFor="signup-department"
                  className="block text-[13px] sm:text-[14px] font-bold text-slate-700 mb-1"
                >
                  Department
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <Building2 className="w-4.5 h-4.5" strokeWidth={2} />
                  </div>
                  <input
                    id="signup-department"
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="Quality Assurance"
                    className="w-full pl-10 sm:pl-11 pr-3.5 py-2.5 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-white focus:bg-white text-sm sm:text-[14.5px] font-medium text-slate-900 placeholder-slate-400 outline-none transition-colors focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="signup-role"
                  className="block text-[13px] sm:text-[14px] font-bold text-slate-700 mb-1"
                >
                  Role
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <ShieldCheck className="w-4.5 h-4.5" strokeWidth={2} />
                  </div>
                  <select
                    id="signup-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className={`w-full pl-10 sm:pl-11 pr-8 py-2.5 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-white focus:bg-white text-sm sm:text-[15px] font-medium outline-none transition-colors focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs cursor-pointer appearance-none ${
                      role ? "text-slate-900" : "text-slate-400"
                    }`}
                  >
                    <option value="" disabled hidden>
                      Role
                    </option>
                    {Object.entries(ROLE_LABELS).map(([key, label]) => (
                      <option key={key} value={key} className="text-slate-900">
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label
                htmlFor="signup-password"
                className="block text-[13px] sm:text-[14px] font-bold text-slate-700 mb-1"
              >
                Password
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="w-4.5 h-4.5" strokeWidth={2} />
                </div>
                <input
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 sm:pl-11 pr-10 py-2.5 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-white focus:bg-white text-sm sm:text-[15px] font-medium text-slate-900 placeholder-slate-400 outline-none transition-colors focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer p-1.5"
                >
                  {showPassword ? (
                    <EyeOff className="w-4.5 h-4.5" />
                  ) : (
                    <Eye className="w-4.5 h-4.5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="signup-confirm-password"
                className="block text-[13px] sm:text-[14px] font-bold text-slate-700 mb-1"
              >
                Confirm Password
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="w-4.5 h-4.5" strokeWidth={2} />
                </div>
                <input
                  id="signup-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 sm:pl-11 pr-10 py-2.5 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-white focus:bg-white text-sm sm:text-[15px] font-medium text-slate-900 placeholder-slate-400 outline-none transition-colors focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
                />
                <button
                  type="button"
                  aria-label={
                    showConfirmPassword
                      ? "Hide confirm password"
                      : "Show confirm password"
                  }
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer p-1.5"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4.5 h-4.5" />
                  ) : (
                    <Eye className="w-4.5 h-4.5" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="button"
              disabled={loading || googleLoading}
              onClick={handleGoogleSignIn}
              className="w-full py-2.5 sm:py-3 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm sm:text-[14.5px] shadow-2xs hover:border-slate-300 transition-all cursor-pointer flex items-center justify-center gap-2.5 mt-4 disabled:opacity-60"
            >
              {googleLoading ? (
                <>
                  <Loader2 className="w-4.5 h-4.5 animate-spin text-slate-600" />
                  <span>Signing in with Google...</span>
                </>
              ) : (
                <>
                  <svg className="w-4.5 h-4.5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </>
              )}
            </button>

            <div className="relative flex items-center justify-center my-3">
              <div className="border-t border-slate-200 w-full" />
              <span className="bg-white px-3 text-[11px] sm:text-[12px] font-bold text-slate-400 uppercase tracking-widest absolute">
                OR
              </span>
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-[13px] font-bold"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 sm:py-3.5 px-6 rounded-xl bg-linear-to-r from-[#4f46e5] via-ring to-[#8b5cf6] text-white font-bold text-sm sm:text-[15.5px] shadow-lg shadow-indigo-500/25 hover:opacity-95 active:scale-[0.99] transition-[opacity,transform] cursor-pointer flex items-center justify-center gap-2.5 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4.5 h-4.5 animate-spin" />
                  <span>Creating account…</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4.5 h-4.5" strokeWidth={2} />
                  <span>Create Account</span>
                </>
              )}
            </button>
          </form>

          <div className="text-center pt-1.5">
            <p className="text-[13.5px] sm:text-[14px] font-semibold text-slate-600">
              Already have an account?{" "}
              <Link
                to={ROUTE_PATHS.LOGIN}
                className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline transition-colors"
              >
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
