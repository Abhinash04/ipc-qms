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
  Plus,
  X,
} from "lucide-react";

import { ROUTE_PATHS, roleHome } from "@/constants/routePaths";
import { useAuthStore } from "@/store/useAuthStore";
import { HeroBackdrop } from "@/components/common/HeroBackdrop";
import { notify } from "@/services/notify";
import { register } from "@/services/api/authService";
import { EXPERTISE_AREAS, OFFICER_DESIGNATION } from "@/constants/expertise";

const FIELD_BASE =
  "w-full rounded-xl border bg-slate-50/70 py-2.5 ps-10 text-[13.5px] font-medium text-slate-800 placeholder:text-slate-400 outline-none transition-all duration-200 focus:bg-white focus:ring-4 shadow-xs";
const FIELD_NORMAL =
  "border-slate-200 focus:border-sky-500 focus:ring-sky-400/20";
const FIELD_ERROR =
  "border-red-300 bg-red-50/40 focus:border-red-500 focus:ring-red-500/20";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  OFFICER_DESIGNATION,
  "Reviewer",
  "Admin",
  "Super Admin",
];

const MAX_EXPERTISE_CHARS = 60;
const MAX_OTHER_EXPERTISE = 5;
const AREA_LABELS = EXPERTISE_AREAS.map((area) => area.label);
const sameText = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The areas an Assigned Official applicant works in: listed areas to pick, plus their own. */
function ExpertiseField({ value, error, onChange }) {
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState(null);
  const others = value.filter((entry) => !AREA_LABELS.some((label) => sameText(label, entry)));

  const toggle = (label) =>
    onChange(value.some((entry) => sameText(entry, label)) ? value.filter((entry) => !sameText(entry, label)) : [...value, label]);

  const addOther = () => {
    const phrase = draft.trim().replace(/\s+/g, " ");
    if (!phrase) return;
    if (phrase.length > MAX_EXPERTISE_CHARS) {
      setDraftError(`Keep each area to ${MAX_EXPERTISE_CHARS} characters.`);
      return;
    }
    const listed = AREA_LABELS.find((label) => sameText(label, phrase));
    if (!value.some((entry) => sameText(entry, phrase))) {
      if (!listed && others.length >= MAX_OTHER_EXPERTISE) {
        setDraftError(`Add at most ${MAX_OTHER_EXPERTISE} other areas.`);
        return;
      }
      onChange([...value, listed || phrase]);
    }
    setDraft("");
    setDraftError(null);
  };

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" aria-describedby="signup-expertise-hint">
      <legend className="mb-1 block p-0 text-[13px] font-bold text-slate-700">Areas of expertise</legend>
      <p id="signup-expertise-hint" className="mb-1.5 text-[12px] text-slate-500">
        Choose every area you work in. They are used to suggest you for matching queries once an administrator approves your account.
      </p>
      <div className="flex flex-wrap gap-1">
        {AREA_LABELS.map((label) => {
          const selected = value.some((entry) => sameText(entry, label));
          return (
            <button
              key={label}
              type="button"
              aria-pressed={selected}
              onClick={() => toggle(label)}
              className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors ${
                selected
                  ? "border-sky-500 bg-sky-50 text-sky-700 font-semibold"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
              }`}
            >
              {selected && <Check className="h-3 w-3 text-sky-600" aria-hidden="true" />}
              {label}
            </button>
          );
        })}
      </div>

      {others.length > 0 && (
        <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1 p-0" aria-label="Other areas of expertise">
          {others.map((entry) => (
            <li
              key={entry}
              className="inline-flex items-center gap-1 rounded-full border border-sky-400 bg-sky-50 py-0.5 ps-2.5 pe-1 text-[12px] font-medium text-sky-700"
            >
              {entry}
              <button
                type="button"
                aria-label={`Remove ${entry}`}
                onClick={() => onChange(value.filter((item) => item !== entry))}
                className="cursor-pointer rounded-full p-0.5 hover:bg-sky-100"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label htmlFor="signup-expertise-other" className="mb-1 mt-2 block text-[12px] font-medium text-slate-600">
        Other area (optional)
      </label>
      <div className="flex gap-1.5">
        <input
          id="signup-expertise-other"
          type="text"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addOther();
            }
          }}
          placeholder="e.g. Nitrosamine impurities"
          className={`${FIELD_BASE} ${draftError ? FIELD_ERROR : FIELD_NORMAL} ps-2.5 pe-2.5`}
        />
        <button
          type="button"
          onClick={addOther}
          disabled={!draft.trim()}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-[12.5px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Add
        </button>
      </div>
      {(draftError || error) && (
        <p className="mt-1 text-[12px] font-medium text-red-600">{draftError || error}</p>
      )}
    </fieldset>
  );
}

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
        className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-slate-700"
      >
        <Icon className="h-3.5 w-3.5 text-slate-600" strokeWidth={2} />
        <span>{label}</span>
      </label>
      <div className="relative">
        <Icon
          className="pointer-events-none absolute inset-s-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 z-10"
          strokeWidth={2}
        />
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((prev) => !prev)}
          className={`${FIELD_BASE} ${error ? FIELD_ERROR : FIELD_NORMAL} flex items-center justify-between cursor-pointer pe-9 ${
            !value ? "text-slate-400" : "text-slate-800"
          }`}
        >
          <span className="w-full truncate text-start">
            {value || placeholder}
          </span>
        </button>
        <ChevronDown
          className={`pointer-events-none absolute inset-e-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          strokeWidth={2}
        />
      </div>

      {isOpen && (
        <div
          role="listbox"
          className="absolute top-full inset-x-0 z-50 mt-1 max-h-50 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150"
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
              className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-[13px] text-start transition-colors ${
                value === opt
                  ? "bg-sky-50 font-bold text-sky-700"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span>{opt}</span>
              {value === opt && <Check className="h-3.5 w-3.5 text-sky-600 shrink-0" />}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-0.5 text-[11.5px] font-medium text-red-600">{error}</p>
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
    expertise: [],
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

  const isOfficer = formData.designation === OFFICER_DESIGNATION;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
      ...(name === "designation" && value !== OFFICER_DESIGNATION && { expertise: [] }),
    }));
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

    if (isOfficer && formData.expertise.length === 0) {
      newErrors.expertise = "Choose at least one area of expertise.";
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
        ...(isOfficer && {
          expertise: [...new Set(formData.expertise.map((entry) => entry.trim().toLowerCase()))],
        }),
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
    <div className="relative flex h-screen max-h-screen w-full items-center justify-center overflow-hidden bg-primary text-white">
      <HeroBackdrop />

      <div className="relative z-10 flex h-full w-full max-w-[1440px] items-center justify-center gap-20 lg:gap-32 xl:gap-44 px-6 lg:px-14">
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

        <main className="flex h-full w-full flex-col items-center justify-center overflow-hidden lg:flex-1 max-w-xl">
          <div className="my-auto flex w-full max-w-[500px] flex-col items-center justify-center">
            {/* Form Container with Premium Layered Borders & Badge */}
            <div className="relative w-full pt-7">
              {/* Top Badge Icon floating centered over top edge */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 flex items-center justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600/20 p-1.5 backdrop-blur-md shadow-lg shadow-blue-500/20 ring-4 ring-white">
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-500 text-white shadow-inner">
                    <UserPlus className="h-6 w-6" strokeWidth={2.2} />
                  </div>
                </div>
              </div>

              {/* Outer Cyan-to-Violet Layered Border Wrapper */}
              <div className="relative rounded-[26px] p-[2px] bg-gradient-to-b from-cyan-300 via-blue-500/60 to-indigo-500/90 shadow-[0_20px_50px_-10px_rgba(15,23,42,0.35),0_0_25px_rgba(56,189,248,0.2)]">
                {/* Inner White Card */}
                <div className="relative overflow-hidden rounded-[24px] bg-white/95 px-7 pt-8 pb-5.5 sm:px-9 sm:pt-9 sm:pb-6.5 backdrop-blur-xl">
                  {/* Top Accent Gradient Bar */}
                  <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-sky-400 via-indigo-500 to-cyan-400" />

                  {/* Heading & Subtitle */}
                  <div className="mb-4.5 text-center">
                    <h2 className="font-heading text-[26px] sm:text-[28px] font-extrabold tracking-tight text-[#0f172a] whitespace-nowrap">
                      Sign Up
                    </h2>
                    <p className="mt-1 text-[13px] sm:text-[13.5px] text-slate-500 font-medium leading-relaxed max-w-none whitespace-nowrap mx-auto">
                      Enter your registration details below to create your account.
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} noValidate className="space-y-3">
                    <div>
                      <label
                        htmlFor="signup-fullname"
                        className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-slate-700"
                      >
                        <User className="h-3.5 w-3.5 text-slate-600" strokeWidth={2} />
                        <span>Full Name</span>
                      </label>
                      <div className="relative">
                        <User
                          className="pointer-events-none absolute inset-s-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
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
                        <p className="mt-0.5 text-[11.5px] font-medium text-red-600">
                          {errors.fullName}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="signup-email"
                        className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-slate-700"
                      >
                        <Mail className="h-3.5 w-3.5 text-slate-600" strokeWidth={2} />
                        <span>Email</span>
                      </label>
                      <div className="relative">
                        <Mail
                          className="pointer-events-none absolute inset-s-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
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
                        <p className="mt-0.5 text-[11.5px] font-medium text-red-600">
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

                    {isOfficer && (
                      <ExpertiseField
                        value={formData.expertise}
                        error={errors.expertise}
                        onChange={(expertise) => handleChange({ target: { name: "expertise", value: expertise } })}
                      />
                    )}

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="signup-password"
                          className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-slate-700"
                        >
                          <Lock className="h-3.5 w-3.5 text-slate-600" strokeWidth={2} />
                          <span>Password</span>
                        </label>
                        <div className="relative">
                          <Lock
                            className="pointer-events-none absolute inset-s-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
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
                            className="absolute inset-e-2 top-1/2 -translate-y-1/2 cursor-pointer p-1 text-slate-400 transition-colors hover:text-slate-600"
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        {errors.password && (
                          <p className="mt-0.5 text-[11.5px] font-medium text-red-600">
                            {errors.password}
                          </p>
                        )}
                      </div>

                      <div>
                        <label
                          htmlFor="signup-confirm-password"
                          className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-slate-700"
                        >
                          <Lock className="h-3.5 w-3.5 text-slate-600" strokeWidth={2} />
                          <span>Confirm Password</span>
                        </label>
                        <div className="relative">
                          <Lock
                            className="pointer-events-none absolute inset-s-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
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
                            className="absolute inset-e-2 top-1/2 -translate-y-1/2 cursor-pointer p-1 text-slate-400 transition-colors hover:text-slate-600"
                          >
                            {showConfirmPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        {errors.confirmPassword && (
                          <p className="mt-0.5 text-[11.5px] font-medium text-red-600">
                            {errors.confirmPassword}
                          </p>
                        )}
                      </div>
                    </div>

                    <p className="text-[12px] text-slate-500 font-medium">{PENDING_APPROVAL}</p>

                    {generalError && (
                      <div
                        role="alert"
                        className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-[12.5px] font-medium text-red-700"
                      >
                        {generalError}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="mt-1 flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 py-3 px-6 text-[14.5px] font-bold text-white shadow-lg shadow-blue-600/30 transition-all duration-200 hover:from-blue-700 hover:via-indigo-700 hover:to-blue-800 hover:shadow-blue-600/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4.5 w-4.5 animate-spin" />
                          <span>Creating account…</span>
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4.5 w-4.5" strokeWidth={2.2} />
                          <span>Create Account</span>
                        </>
                      )}
                    </button>
                  </form>

                  <div className="mt-4 border-t border-slate-200/60 pt-3 text-center text-[13.5px] font-medium text-slate-500">
                    Already have an account?{" "}
                    <Link
                      to={ROUTE_PATHS.LOGIN}
                      className="font-semibold text-blue-600 transition-colors hover:text-blue-700 hover:underline"
                    >
                      Sign In
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            <footer className="mt-3.5 flex flex-col items-center gap-1 text-center">
              <p className="text-[11px] text-white/80">
                © 2026 Integrated Processing Centre · Indian Pharmacopoeia Commission
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-white/95">
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
          </div>
        </main>
      </div>
    </div>
  );
}
