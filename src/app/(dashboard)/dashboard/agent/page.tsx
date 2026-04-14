"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Download, Terminal, Copy, CheckCircle, Shield, Monitor,
  Info, Wifi, WifiOff, Loader2, Activity, Upload, FolderSearch, Clock
} from "lucide-react";

interface AgentStatus {
  online: boolean;
  lastSeen: string | null;
  version: string | null;
  status: string | null;
  activeUploads: number;
  message: string | null;
  offlineForSeconds: number;
}

export default function AgentPage() {
  const [agentToken, setAgentToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"windows" | "macos" | "linux">("windows");
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const fetchToken = useCallback(async () => {
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      const data = await res.json();
      setAgentToken(data.user?.agentToken || "");
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/status");
      if (res.ok) {
        const data = await res.json();
        setAgentStatus(data);
      }
    } catch {
      setAgentStatus(null);
    }
    setLoadingStatus(false);
  }, []);

  useEffect(() => {
    fetchToken();
    fetchStatus();
    // Refresh status every 10 seconds
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchToken, fetchStatus]);

  const copyToken = () => {
    navigator.clipboard.writeText(agentToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatLastSeen = (lastSeen: string | null, offlineSeconds: number) => {
    if (!lastSeen) return "Chưa từng kết nối";
    if (offlineSeconds < 90) return "Vừa xong";
    if (offlineSeconds < 300) return `${Math.floor(offlineSeconds / 60)} phút trước`;
    if (offlineSeconds < 3600) return `${Math.floor(offlineSeconds / 60)} phút trước`;
    if (offlineSeconds < 86400) return `${Math.floor(offlineSeconds / 3600)} giờ trước`;
    return `${Math.floor(offlineSeconds / 86400)} ngày trước`;
  };

  const getStatusIcon = (status: string | null) => {
    switch (status) {
      case "uploading": return <Upload size={14} />;
      case "scanning": return <FolderSearch size={14} />;
      default: return <Activity size={14} />;
    }
  };

  const getStatusColor = (online: boolean, status: string | null) => {
    if (!online) return "var(--text-tertiary)";
    if (status === "uploading") return "var(--cta)";
    if (status === "scanning") return "var(--info)";
    return "var(--success)";
  };

  const steps = [
    {
      title: "Cài đặt Node.js",
      content: (
        <div>
          <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-2)" }}>
            Tải và cài đặt Node.js (LTS) từ{" "}
            <a href="https://nodejs.org" target="_blank" rel="noreferrer">nodejs.org</a>
          </p>
          <span className="form-hint">Yêu cầu: Node.js v18 trở lên</span>
        </div>
      ),
    },
    {
      title: "Tải và cài đặt Agent",
      id: "step-2",
      content: (
        <div>
          <div className="tab-pills" style={{ marginBottom: "var(--space-4)", width: "fit-content" }}>
            {(["windows", "macos", "linux"] as const).map((tab) => (
              <button
                key={tab}
                className={`tab-pill ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === "windows" ? (
                  <><Monitor size={14} /> Windows</>
                ) : (
                  <><Terminal size={14} /> {tab}</>
                )}
              </button>
            ))}
          </div>
          <pre className="code-block">
            <code>{activeTab === "windows"
              ? `# 1. Mở PowerShell / CMD
cd đường-dẫn-tới\\agent

# 2. Cài đặt & chạy
npm install
npm run build
node dist\\index.js`
              : `# 1. Mở Terminal
cd đường-dẫn-tới/agent

# 2. Cài đặt & chạy
npm install
npm run build
node dist/index.js`}</code>
          </pre>
        </div>
      ),
    },
    {
      title: "Nhập Agent Token",
      content: (
        <div>
          <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-3)" }}>
            Khi agent khởi động, nhập token dưới đây:
          </p>
          <div className="token-display">
            <code className="token-value">
              {agentToken || "Đang tải..."}
            </code>
            <button
              className="btn btn-primary"
              onClick={copyToken}
              style={{ flexShrink: 0 }}
            >
              {copied ? <><CheckCircle size={14} /> Đã copy</> : <><Copy size={14} /> Copy</>}
            </button>
          </div>
          <div className="callout callout-warning" style={{ marginTop: "var(--space-3)" }}>
            <Shield size={16} />
            <span>Token này là duy nhất cho tài khoản của bạn. Không chia sẻ cho người khác.</span>
          </div>
        </div>
      ),
    },
    {
      title: "Cài đặt GoLogin",
      content: (
        <div>
          <ol style={{ paddingLeft: "var(--space-5)", lineHeight: 2, color: "var(--text-secondary)" }}>
            <li>Tải GoLogin từ <a href="https://gologin.com" target="_blank" rel="noreferrer">gologin.com</a></li>
            <li>Tạo tài khoản và đăng nhập</li>
            <li>Tạo browser profile mới cho mỗi YouTube channel</li>
            <li>Đăng nhập YouTube trong mỗi profile</li>
            <li>Vào Settings → API → Copy API Token</li>
            <li>Dán API Token vào trang <strong style={{ color: "var(--text-primary)" }}>Cài đặt</strong> trên web</li>
          </ol>
        </div>
      ),
    },
  ];

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Desktop Agent</h1>
          <p className="page-subtitle">
            Agent chạy trên máy tính của bạn để tự động upload video lên YouTube qua GoLogin
          </p>
        </div>
      </div>

      {/* Live Status Card */}
      <div className="section-card" style={{ marginBottom: "var(--space-6)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          {/* Status Indicator */}
          <div style={{
            width: 56,
            height: 56,
            borderRadius: "var(--radius-xl)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: agentStatus?.online ? "rgba(52, 211, 153, 0.12)" : "rgba(255,255,255,0.04)",
            border: `2px solid ${agentStatus?.online ? "var(--success)" : "var(--border-secondary)"}`,
            position: "relative",
          }}>
            {loadingStatus ? (
              <Loader2 size={24} className="spinner" style={{ color: "var(--text-tertiary)" }} />
            ) : agentStatus?.online ? (
              <Wifi size={24} style={{ color: "var(--success)" }} />
            ) : (
              <WifiOff size={24} style={{ color: "var(--text-tertiary)" }} />
            )}
            {/* Pulse dot */}
            {agentStatus?.online && (
              <div style={{
                position: "absolute",
                top: 4,
                right: 4,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--success)",
                animation: "pulse 2s ease-in-out infinite",
              }} />
            )}
          </div>

          {/* Status Info */}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-1)" }}>
              <span style={{
                fontSize: "var(--text-lg)",
                fontWeight: 600,
                color: agentStatus?.online ? "var(--success)" : "var(--text-tertiary)",
              }}>
                {loadingStatus ? "Đang kiểm tra..." : agentStatus?.online ? "Agent Online" : "Agent Offline"}
              </span>
              {agentStatus?.version && agentStatus.online && (
                <span className="status-badge status-active" style={{ fontSize: "var(--text-xs)" }}>
                  v{agentStatus.version}
                </span>
              )}
            </div>

            {agentStatus && !loadingStatus && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap" }}>
                {/* Current Activity */}
                {agentStatus.online && agentStatus.message && (
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: "var(--text-sm)", color: getStatusColor(agentStatus.online, agentStatus.status) }}>
                    {getStatusIcon(agentStatus.status)}
                    <span>{agentStatus.message}</span>
                  </div>
                )}

                {/* Active Uploads */}
                {agentStatus.online && agentStatus.activeUploads > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: "var(--text-sm)", color: "var(--cta)" }}>
                    <Upload size={14} />
                    <span>{agentStatus.activeUploads} đang upload</span>
                  </div>
                )}

                {/* Last Seen */}
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                  <Clock size={14} />
                  <span>Lần cuối: {formatLastSeen(agentStatus.lastSeen, agentStatus.offlineForSeconds)}</span>
                </div>
              </div>
            )}

            {!agentStatus?.online && !loadingStatus && (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)", margin: 0 }}>
                {agentStatus?.lastSeen
                  ? `Mất kết nối ${formatLastSeen(agentStatus.lastSeen, agentStatus.offlineForSeconds)}. Kiểm tra xem agent có đang chạy trên máy không.`
                  : "Agent chưa từng kết nối. Làm theo hướng dẫn bên dưới để cài đặt."}
              </p>
            )}
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => document.getElementById('step-2')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <Download size={16} /> Hướng dẫn
          </button>
        </div>
      </div>

      {/* Installation Steps — Timeline */}
      <div className="timeline">
        {steps.map((step, i) => (
          <div key={i} id={(step as { id?: string }).id || undefined} className="timeline-step">
            <div className="timeline-number">{i + 1}</div>
            <div className="timeline-content">
              <h3>{step.title}</h3>
              {step.content}
            </div>
          </div>
        ))}
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}
