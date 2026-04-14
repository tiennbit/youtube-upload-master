"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, AlertCircle } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Đăng ký thất bại");
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
          <p>Tạo tài khoản mới để bắt đầu</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="auth-error">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div className="form-group">
            <label className="label" htmlFor="register-name">
              Tên hiển thị
            </label>
            <input
              id="register-name"
              type="text"
              className="input"
              placeholder="Nguyễn Văn A"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="label" htmlFor="register-email">
              Email
            </label>
            <input
              id="register-email"
              type="email"
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="label" htmlFor="register-password">
              Mật khẩu
            </label>
            <input
              id="register-password"
              type="password"
              className="input"
              placeholder="Tối thiểu 6 ký tự"
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
                <span className="spinner" /> Đang tạo tài khoản...
              </>
            ) : (
              "Đăng ký"
            )}
          </button>
        </form>

        <div className="auth-footer">
          Đã có tài khoản?{" "}
          <a href="/login">Đăng nhập</a>
        </div>
      </div>
    </div>
  );
}
