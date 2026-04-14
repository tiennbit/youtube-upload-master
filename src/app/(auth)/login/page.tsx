"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Zap, Radio, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Đăng nhập thất bại");
        setLoading(false);
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Không thể kết nối đến server");
      setLoading(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card animate-in">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <Upload size={28} color="white" />
          </div>
          <h1>
            Tube<span>Flow</span>
          </h1>
          <p>Đăng nhập vào tài khoản của bạn</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="auth-error">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div className="form-group">
            <label className="label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="label" htmlFor="login-password">
              Mật khẩu
            </label>
            <input
              id="login-password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary w-full btn-lg"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner" /> Đang đăng nhập...
              </>
            ) : (
              "Đăng nhập"
            )}
          </button>
        </form>

        <div className="auth-footer">
          Chưa có tài khoản?{" "}
          <a href="/register">Đăng ký ngay</a>
        </div>

        <div className="auth-features">
          <div className="auth-feature">
            <Upload size={14} />
            Auto Upload
          </div>
          <div className="auth-feature">
            <Radio size={14} />
            Multi-Channel
          </div>
          <div className="auth-feature">
            <Zap size={14} />
            GoLogin
          </div>
        </div>
      </div>
    </div>
  );
}
