import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, LogOut, UserRound, X } from "lucide-react";
import { api, ApiError } from "@quan1/api-client";
import type { Locale, User } from "@quan1/contracts";

type AuthMode = "login" | "register";

function errorMessage(error: unknown, vi: boolean) {
  if (vi && error instanceof Error) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Your email or password is incorrect. Please try again.";
    if (error.status === 409)
      return "This email is already in use. Sign in or use another email.";
    if (error.status === 422)
      return "Enter a valid name, email and a password of 8–200 characters.";
    if (error.status === 429)
      return "Too many attempts. Please try again in 5 minutes.";
  }
  return vi
    ? "Chưa kết nối được máy chủ. Vui lòng thử lại."
    : "Could not connect to the server. Please try again.";
}

export function AuthControls({ locale }: { locale: Locale }) {
  const vi = locale === "vi";
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<AuthMode | null>(null);

  useEffect(() => {
    let ignore = false;
    setChecking(true);
    setError(null);
    api<User>("/auth/me")
      .then((current) => {
        if (!ignore) setUser(current);
      })
      .catch((e: unknown) => {
        if (!ignore) {
          setUser(null);
          if (!(e instanceof ApiError && e.status === 401)) setError(e);
        }
      })
      .finally(() => {
        if (!ignore) setChecking(false);
      });
    return () => {
      ignore = true;
    };
  }, [retry]);

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-controls">
      {checking ? (
        <span className="auth-checking" role="status">
          {vi ? "Đang kiểm tra tài khoản…" : "Checking your account…"}
        </span>
      ) : user ? (
        <>
          <span className="account-name" title={user.email}>
            <UserRound size={16} aria-hidden="true" />
            <span>{user.name}</span>
          </span>
          <button className="language" onClick={logout} disabled={busy}>
            <LogOut size={15} aria-hidden="true" />
            {busy
              ? vi
                ? "Đang đăng xuất…"
                : "Signing out…"
              : vi
                ? "Đăng xuất"
                : "Sign out"}
          </button>
        </>
      ) : (
        <>
          <button className="language" onClick={() => setMode("login")}>
            {vi ? "Đăng nhập" : "Sign in"}
          </button>
          <button
            className="button auth-register"
            onClick={() => setMode("register")}
          >
            {vi ? "Đăng ký" : "Sign up"}
          </button>
        </>
      )}
      {error != null && (
        <div className="auth-header-error" role="alert">
          {errorMessage(error, vi)}{" "}
          <button className="auth-link" onClick={() => setRetry((n) => n + 1)}>
            {vi ? "Thử lại" : "Try again"}
          </button>
        </div>
      )}
      {mode && (
        <AuthDialog
          key={mode}
          mode={mode}
          vi={vi}
          onSwitch={setMode}
          onClose={() => setMode(null)}
          onSuccess={(current) => {
            setUser(current);
            setError(null);
            setMode(null);
          }}
        />
      )}
    </div>
  );
}

function AuthDialog({
  mode,
  vi,
  onSwitch,
  onClose,
  onSuccess,
}: {
  mode: AuthMode;
  vi: boolean;
  onSwitch: (mode: AuthMode) => void;
  onClose: () => void;
  onSuccess: (user: User) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [mismatch, setMismatch] = useState(false);
  const registering = mode === "register";
  const title = registering
    ? vi
      ? "Tạo tài khoản"
      : "Create an account"
    : vi
      ? "Đăng nhập"
      : "Sign in";

  useEffect(() => {
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    const element = dialog.current;
    element?.showModal();
    element?.querySelector("input")?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setMismatch(false);
    if (registering && password !== confirmation) {
      setMismatch(true);
      return;
    }
    setBusy(true);
    try {
      const current = await api<User>(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(
          registering
            ? { name: name.trim(), email: email.trim(), password }
            : { email: email.trim(), password },
        ),
      });
      onSuccess(current);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="auth-dialog"
      aria-labelledby="auth-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <button
        className="auth-close"
        type="button"
        disabled={busy}
        onClick={onClose}
        aria-label={vi ? "Đóng" : "Close"}
      >
        <X size={20} />
      </button>
      <span className="eyebrow">SAIGON STORIES</span>
      <h2 id="auth-title">{title}</h2>
      <p className="auth-intro">
        {registering
          ? vi
            ? "Cùng khám phá những câu chuyện của Sài Gòn."
            : "Join us and discover the stories of Saigon."
          : vi
            ? "Chào mừng bạn trở lại với Saigon Stories."
            : "Welcome back to Saigon Stories."}
      </p>
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy}>
          {registering && (
            <label htmlFor="auth-name">
              {vi ? "Họ và tên" : "Full name"}
              <input
                id="auth-name"
                autoComplete="name"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label htmlFor="auth-email">
            Email
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label htmlFor="auth-password">{vi ? "Mật khẩu" : "Password"}</label>
          <div className="auth-password">
            <input
              id="auth-password"
              type={showPassword ? "text" : "password"}
              autoComplete={registering ? "new-password" : "current-password"}
              required
              minLength={registering ? 8 : undefined}
              maxLength={200}
              aria-describedby={registering ? "password-help" : undefined}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setMismatch(false);
              }}
            />
            <button
              type="button"
              aria-controls="auth-password"
              aria-pressed={showPassword}
              aria-label={vi ? "Hiện mật khẩu" : "Show password"}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {registering && (
            <>
              <small id="password-help">
                {vi ? "Từ 8 đến 200 ký tự." : "Use 8–200 characters."}
              </small>
              <label htmlFor="auth-confirmation">
                {vi ? "Nhập lại mật khẩu" : "Confirm password"}
                <input
                  id="auth-confirmation"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  maxLength={200}
                  aria-invalid={mismatch}
                  aria-describedby={mismatch ? "password-mismatch" : undefined}
                  value={confirmation}
                  onChange={(e) => {
                    setConfirmation(e.target.value);
                    setMismatch(false);
                  }}
                />
              </label>
            </>
          )}
          {mismatch && (
            <p id="password-mismatch" className="auth-error" role="alert">
              {vi
                ? "Mật khẩu nhập lại chưa khớp."
                : "Your passwords do not match."}
            </p>
          )}
          {error != null && (
            <p className="auth-error" role="alert">
              {errorMessage(error, vi)}
            </p>
          )}
          <button type="submit" className="button auth-submit">
            {busy ? (vi ? "Đang xử lý…" : "Please wait…") : title}
          </button>
        </fieldset>
      </form>
      <p className="auth-switch">
        {registering
          ? vi
            ? "Đã có tài khoản? "
            : "Already have an account? "
          : vi
            ? "Chưa có tài khoản? "
            : "New here? "}
        <button
          type="button"
          className="auth-link"
          disabled={busy}
          onClick={() => onSwitch(registering ? "login" : "register")}
        >
          {registering
            ? vi
              ? "Đăng nhập"
              : "Sign in"
            : vi
              ? "Đăng ký"
              : "Sign up"}
        </button>
      </p>
    </dialog>
  );
}
