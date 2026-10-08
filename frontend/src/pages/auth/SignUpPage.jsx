import { useState, useEffect, useRef } from "react";
import { Navigate, useNavigate, Link } from "react-router-dom";
import {
  User,
  Mail,
  Building2,
  Briefcase,
  Lock,
  Eye,
  EyeOff,
  UserPlus,
  Loader2,
  Sparkles,
  ShieldCheck,
  Zap,
  ChevronDown,
  Check,
} from "lucide-react";

import { ROUTE_PATHS, roleHome } from "@/constants/routePaths";
import { useAuthStore } from "@/store/useAuthStore";
import { HeroBackdrop } from "@/components/common/HeroBackdrop";
import { PageBackdrop } from "@/components/common/PageBackdrop";
import { notify } from "@/services/notify";
import { register } from "@/services/api/authService";

const FIELD_BASE =
  "w-full rounded-lg border bg-surface py-2 ps-9 text-[13px] text-ink placeholder:text-ink-muted outline-none transition-colors focus:ring-2";
const FIELD_NORMAL =
  "border-line focus:border-primary focus:ring-primary/20";
const FIELD_ERROR =
  "border-red-400 focus:border-red-500 focus:ring-red-500/20";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same limits as the server: bcrypt only reads the first 72 bytes of a password.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72;
const PENDING_APPROVAL = "An administrator approves new accounts before they can sign in.";

const DEPARTMENTS = [
  "Quality Assurance & Standards",
  "Analytical & Quality Control",
  "Pharmacopoeial Standards",
];

const DESIGNATIONS = [
  "Officer-in-Charge",
  "Assigned Official",
  "Reviewer",
  "Admin",
  "Super Admin",
];

function CustomSelect({
  id,
  name,
  label,
  value,
  options,
  placeholder,
  icon: Icon,
  error,
  onChange,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <label
        htmlFor={id}
        className="mb-1 block text-[13px] font-medium text-ink-soft"
      >
        {label}
      </label>
      <div className="relative">
        <Icon
          className="pointer-events-none absolute inset-s-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted z-10"
          strokeWidth={2}
        />
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((prev) => !prev)}
          className={`${FIELD_BASE} ${error ? FIELD_ERROR : FIELD_NORMAL} flex items-center justify-between cursor-pointer pe-9 ${
            !value ? "text-ink-muted" : "text-ink"
          }`}
        >
          <span className={`w-full truncate ${!value ? "text-center" : "text-start"}`}>
            {value || placeholder}
          </span>
        </button>
        <ChevronDown
          className={`pointer-events-none absolute inset-e-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          strokeWidth={2}
        />
      </div>

      {isOpen && (
        <div
          role="listbox"
          className="absolute top-full inset-x-0 z-50 mt-1 max-h-52 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              role="option"
              aria-selected={value === opt}
              onClick={() => {
                onChange({ target: { name, value: opt } });
                setIsOpen(false);
              }}
              className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-[13px] text-start transition-colors ${
                value === opt
                  ? "bg-primary-50 font-semibold text-primary"
                  : "text-ink hover:bg-surface-muted"
              }`}
            >
              <span>{opt}</span>
              {value === opt && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-1 text-[12px] font-medium text-red-600">{error}</p>
      )}
    </div>
  );
}

export function SignUpPage() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    department: "",
    designation: "",
    password: "",
    confirmPassword: "",
  });

  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generalError, setGeneralError] = useState(null);

  const home = currentUser ? roleHome(currentUser.role) : null;
  if (home && home !== ROUTE_PATHS.LOGIN) return <Navigate to={home} replace />;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
    if (generalError) {
      setGeneralError(null);
    }
  };

  const validate = () => {
    const newErrors = {};

    if (!formData.fullName.trim()) {
      newErrors.fullName = "Full Name is required.";
    }

    if (!formData.email.trim()) {
      newErrors.email = "Email is required.";
    } else if (!EMAIL_REGEX.test(formData.email.trim())) {
      newErrors.email = "Please enter a valid email address.";
    }

    if (!formData.department.trim()) {
      newErrors.department = "Department is required.";
    }

    if (!formData.designation.trim()) {
      newErrors.designation = "Designation is required.";
    }

    if (!formData.password) {
      newErrors.password = "Password is required.";
    } else if (formData.password.length < MIN_PASSWORD_LENGTH) {
      newErrors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    } else if (new TextEncoder().encode(formData.password).length > MAX_PASSWORD_BYTES) {
      newErrors.password = `Password must be at most ${MAX_PASSWORD_BYTES} bytes.`;
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = "Confirm Password is required.";
    } else if (formData.password && formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Password and Confirm Password must match.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setGeneralError(null);

    if (!validate()) {
      setGeneralError("Please fix the validation errors below to proceed.");
      return;
    }

    setLoading(true);

    try {
      const payload = {
        name: formData.fullName.trim(),
        email: formData.email.trim(),
        department: formData.department.trim(),
        designation: formData.designation.trim(),
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      };

      const response = await register(payload);
      notify.success(response?.message || `Account created. ${PENDING_APPROVAL}`);
      navigate(ROUTE_PATHS.LOGIN, { replace: true });
    } catch (caught) {
      const status = caught?.response?.status;
      const message = caught?.response?.data?.message || caught?.response?.data?.error;

      if (status === 409) {
        const dupMessage = "An account with this email already exists. Please sign in.";
        setGeneralError(dupMessage);
        notify.error("Registration Failed", dupMessage);
      } else if (message) {
        setGeneralError(message);
        notify.error("Registration Failed", message);
      } else {
        const netMessage = "Unable to create your account. Please try again.";
        setGeneralError(netMessage);
        notify.error("Registration Failed", netMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-surface-muted text-ink">
      <aside className="relative hidden w-1/2 overflow-hidden bg-primary text-white lg:flex lg:flex-col lg:items-center lg:justify-center lg:py-12">
        <HeroBackdrop />

        <div className="relative z-10 max-w-xl px-10 text-center xl:px-12 -mt-12 xl:-mt-16">
          <div className="flex flex-col items-center justify-center gap-2.5">
            <img
              src="/imageFile1.png"
              alt="IPC Emblem Logo"
              width="103"
              height="199"
              className="h-24 w-auto object-contain drop-shadow-lg brightness-110"
            />
            <div className="text-center leading-tight">
              <div className="text-[16px] font-semibold tracking-wide text-white/95 xl:text-[17px]">
                भारतीय भेषज संहिता आयोग
              </div>
              <div className="mt-1 font-heading text-[18px] font-extrabold uppercase tracking-wider text-white xl:text-[20px]">
                Indian Pharmacopoeia Commission
              </div>
            </div>
          </div>

          <h1 className="mt-6 font-heading text-[38px] font-extrabold leading-[1.15] tracking-tight text-white xl:text-[44px]">
            <span className="block">Join the AI-powered</span>{" "}
            <span className="block">IP Stakeholders’</span>{" "}
            <span className="block bg-linear-to-r from-sky-200 via-cyan-200 to-indigo-200 bg-clip-text text-transparent">
              BRIDGETECH
            </span>
          </h1>

          <p className="mx-auto mt-4 max-w-lg text-[14.5px] leading-relaxed text-white/90">
            Create your IPC QMS user account to request monograph reviews, track technical enquiries, and access official pharmacopoeia workflows.
          </p>

          <div className="mx-auto mt-6 flex max-w-lg flex-wrap items-center justify-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2.5 text-[14px] font-bold text-white shadow-sm backdrop-blur-md transition-transform hover:scale-105">
              <Sparkles className="h-4.5 w-4.5 text-amber-300" />
              <span>IP 2026 Monographs</span>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2.5 text-[14px] font-bold text-white shadow-sm backdrop-blur-md transition-transform hover:scale-105">
              <ShieldCheck className="h-4.5 w-4.5 text-emerald-300" />
              <span>ISO 17025 Certified</span>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2.5 text-[14px] font-bold text-white shadow-sm backdrop-blur-md transition-transform hover:scale-105">
              <Zap className="h-4.5 w-4.5 text-sky-300" />
              <span>24H SLA Protocol</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="relative isolate flex w-full flex-col items-center justify-center overflow-y-auto px-5 py-8 sm:px-10 lg:w-1/2">
        <PageBackdrop />

        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-transparent bg-surface p-5 pt-4 shadow-card sm:p-7 sm:pt-5">
            <div className="flex items-center justify-center gap-3">
              <h2 className="font-heading text-[22px] font-bold leading-tight text-center text-primary sm:text-[24px]">
                Sign Up
              </h2>
            </div>
            <p className="mt-1 text-[12.5px] text-center text-ink-muted">
              Enter your registration details below to create your account.
            </p>

            <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-3">
              <div>
                <label
                  htmlFor="signup-fullname"
                  className="mb-1 block text-[13px] font-medium text-ink-soft"
                >
                  Full Name
                </label>
                <div className="relative">
                  <User
                    className="pointer-events-none absolute inset-s-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                    strokeWidth={2}
                  />
                  <input
                    id="signup-fullname"
                    name="fullName"
                    type="text"
                    value={formData.fullName}
                    onChange={handleChange}
                    placeholder="e.g. Dr. Rajesh Sharma"
                    className={`${FIELD_BASE} ${errors.fullName ? FIELD_ERROR : FIELD_NORMAL} pe-4`}
                  />
                </div>
                {errors.fullName && (
                  <p className="mt-1 text-[12px] font-medium text-red-600">
                    {errors.fullName}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="signup-email"
                  className="mb-1 block text-[13px] font-medium text-ink-soft"
                >
                  Email
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute inset-s-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                    strokeWidth={2}
                  />
                  <input
                    id="signup-email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="you@ipc.example"
                    className={`${FIELD_BASE} ${errors.email ? FIELD_ERROR : FIELD_NORMAL} pe-4`}
                  />
                </div>
                {errors.email && (
                  <p className="mt-1 text-[12px] font-medium text-red-600">
                    {errors.email}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <CustomSelect
                  id="signup-department"
                  name="department"
                  label="Department"
                  value={formData.department}
                  options={DEPARTMENTS}
                  placeholder="Select Department"
                  icon={Building2}
                  error={errors.department}
                  onChange={handleChange}
                />

                <CustomSelect
                  id="signup-designation"
                  name="designation"
                  label="Designation"
                  value={formData.designation}
                  options={DESIGNATIONS}
                  placeholder="Select Designation"
                  icon={Briefcase}
                  error={errors.designation}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label
                  htmlFor="signup-password"
                  className="mb-1 block text-[13px] font-medium text-ink-soft"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute inset-s-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                    strokeWidth={2}
                  />
                  <input
                    id="signup-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    className={`${FIELD_BASE} ${errors.password ? FIELD_ERROR : FIELD_NORMAL} pe-10`}
                  />
                  <button
                    type="button"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-e-2 top-1/2 -translate-y-1/2 cursor-pointer p-1.5 text-ink-muted transition-colors hover:text-ink"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-[12px] font-medium text-red-600">
                    {errors.password}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="signup-confirm-password"
                  className="mb-1 block text-[13px] font-medium text-ink-soft"
                >
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute inset-s-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                    strokeWidth={2}
                  />
                  <input
                    id="signup-confirm-password"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="••••••••"
                    className={`${FIELD_BASE} ${errors.confirmPassword ? FIELD_ERROR : FIELD_NORMAL} pe-10`}
                  />
                  <button
                    type="button"
                    aria-label={
                      showConfirmPassword ? "Hide confirm password" : "Show confirm password"
                    }
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-e-2 top-1/2 -translate-y-1/2 cursor-pointer p-1.5 text-ink-muted transition-colors hover:text-ink"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="mt-1 text-[12px] font-medium text-red-600">
                    {errors.confirmPassword}
                  </p>
                )}
              </div>

              <p className="text-[12px] text-ink-muted">{PENDING_APPROVAL}</p>

              {generalError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-[12.5px] font-medium text-red-700"
                >
                  {generalError}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-6 py-2 text-[13.5px] font-semibold text-white shadow-[0_10px_20px_-8px] shadow-primary/60 transition-[background-color,transform] hover:bg-primary-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Creating account…</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" strokeWidth={2.2} />
                    <span>Create Account</span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-4 border-t border-line/60 pt-3.5 text-center text-[13px] text-ink-muted">
              Already have an account?{" "}
              <Link
                to={ROUTE_PATHS.LOGIN}
                className="font-semibold text-primary transition-colors hover:text-primary-hover hover:underline"
              >
                Sign In
              </Link>
            </div>
          </div>

          <footer className="mt-5 flex flex-col items-center gap-1.5 text-center">
            <p className="text-[11.5px] text-ink-muted">
              © 2026 Integrated Processing Centre · Indian Pharmacopoeia
              Commission
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-semibold text-ink-soft">
                Powered by
              </span>
              <span className="brand-plate">
                <img
                  src="/anuvadini_new_logo 2.png"
                  alt="Anuvadini"
                  width="512"
                  height="288"
                  className="h-10 w-32 object-cover"
                />
              </span>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
