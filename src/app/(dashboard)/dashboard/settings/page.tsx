"use client";
import { useEffect, useState, useCallback } from "react";
import { Save, Key, Cloud, Zap, CheckCircle, Wifi, WifiOff, Loader2, AlertTriangle, Bell, Send, MessageSquare } from "lucide-react";

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    gologinToken: "",
    nextcloudUrl: "",
    nextcloudUsername: "",
    nextcloudPassword: "",
    autoUploadEnabled: false,
    maxConcurrent: 3,
    telegramBotToken: "",
    telegramChatId: "",
    telegramEnabled: false,
    telegramReportCron: 30,
    statsCollectInterval: 120,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testingNC, setTestingNC] = useState(false);
  const [ncResult, setNcResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testingTG, setTestingTG] = useState(false);
  const [tgResult, setTgResult] = useState<{ success: boolean; message: string } | null>(null);
  const [sendingReport, setSendingReport] = useState(false);
  const [reportResult, setReportResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchSettings = useCallback(async () => {
    const res = await fetch("/api/settings");
    if (res.ok) {
      const data = await res.json();
      setSettings({
        gologinToken: data.gologinToken || "",
        nextcloudUrl: data.nextcloudUrl || "",
        nextcloudUsername: data.nextcloudUsername || "",
        nextcloudPassword: data.nextcloudPassword || "",
        autoUploadEnabled: data.autoUploadEnabled || false,
        maxConcurrent: data.maxConcurrent ?? 3,
        telegramBotToken: data.telegramBotToken || "",
        telegramChatId: data.telegramChatId || "",
        telegramEnabled: data.telegramEnabled || false,
        telegramReportCron: data.telegramReportCron ?? 30,
        statsCollectInterval: data.statsCollectInterval ?? 120,
      });
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cài đặt</h1>
          <p className="page-subtitle">Cấu hình GoLogin, Nextcloud, và tự động upload</p>
        </div>
      </div>

      <form onSubmit={handleSave}>
        {/* GoLogin */}
        <div className="section-card">
          <div className="section-header">
            <div className="section-icon">
              <Key size={20} />
            </div>
            <div>
              <div className="section-title">GoLogin</div>
              <div className="section-desc">Kết nối API để điều khiển browser profiles</div>
            </div>
          </div>
          <div className="form-group">
            <label className="label">API Token</label>
            <input
              className="input"
              type="password"
              placeholder="Nhập GoLogin API Token"
              value={settings.gologinToken}
              onChange={(e) => setSettings({ ...settings, gologinToken: e.target.value })}
            />
            <span className="form-hint">
              Lấy từ GoLogin → Settings → API. Token dùng chung cho tất cả channels.
            </span>
          </div>
        </div>

        {/* Nextcloud */}
        <div className="section-card">
          <div className="section-header">
            <div className="section-icon" style={{ background: "var(--info-muted)", color: "var(--info)" }}>
              <Cloud size={20} />
            </div>
            <div>
              <div className="section-title">Nextcloud</div>
              <div className="section-desc">Nguồn video tự động từ Nextcloud cloud storage</div>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: "var(--space-4)" }}>
            <label className="label">URL</label>
            <input
              className="input"
              placeholder="https://your-nextcloud.com"
              value={settings.nextcloudUrl}
              onChange={(e) => setSettings({ ...settings, nextcloudUrl: e.target.value })}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
            <div className="form-group">
              <label className="label">Username</label>
              <input
                className="input"
                placeholder="username"
                value={settings.nextcloudUsername}
                onChange={(e) => setSettings({ ...settings, nextcloudUsername: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={settings.nextcloudPassword}
                onChange={(e) => setSettings({ ...settings, nextcloudPassword: e.target.value })}
              />
            </div>
          </div>
          <span className="form-hint">
            Tài khoản Nextcloud dùng chung. Thư mục video riêng cho từng channel được cấu hình tại trang Channels.
          </span>

          <div style={{ marginTop: "var(--space-4)", display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={testingNC || !settings.nextcloudUrl || !settings.nextcloudUsername || !settings.nextcloudPassword}
              onClick={async () => {
                setTestingNC(true);
                setNcResult(null);
                // Save settings first, then test
                await fetch("/api/settings", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(settings),
                });
                try {
                  const res = await fetch("/api/nextcloud/test", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                  });
                  const data = await res.json();
                  setNcResult({ success: data.success, message: data.success ? data.message : data.error });
                } catch {
                  setNcResult({ success: false, message: "Không thể kết nối server" });
                }
                setTestingNC(false);
              }}
            >
              {testingNC ? (
                <><Loader2 size={14} className="spinner" /> Đang test...</>
              ) : (
                <><Wifi size={14} /> Test kết nối</>
              )}
            </button>
            {ncResult && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}>
                {ncResult.success ? (
                  <><CheckCircle size={14} style={{ color: "var(--success)" }} /><span style={{ color: "var(--success)" }}>{ncResult.message}</span></>
                ) : (
                  <><AlertTriangle size={14} style={{ color: "var(--warning)" }} /><span style={{ color: "var(--warning)" }}>{ncResult.message}</span></>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Auto Upload */}
        <div className="section-card">
          <div className="section-header">
            <div className="section-icon" style={{ background: "var(--cta-muted)", color: "var(--cta)" }}>
              <Zap size={20} />
            </div>
            <div>
              <div className="section-title">Tự động Upload</div>
              <div className="section-desc">Tự động phát hiện và upload video mới</div>
            </div>
          </div>

          <label className="toggle" style={{ marginBottom: "var(--space-4)" }}>
            <input
              type="checkbox"
              checked={settings.autoUploadEnabled}
              onChange={(e) => setSettings({ ...settings, autoUploadEnabled: e.target.checked })}
            />
            <span className="toggle-track" />
            <span className="toggle-label">Tự động upload khi có video mới từ Nextcloud</span>
          </label>

          <div className="form-group">
            <label className="label">Số kênh upload đồng thời</label>
            <input
              type="number"
              className="input"
              min={1} max={10}
              value={settings.maxConcurrent}
              onChange={(e) => setSettings({ ...settings, maxConcurrent: Number(e.target.value) })}
              style={{ maxWidth: 140 }}
            />
            <span className="form-hint">
              Tối đa bao nhiêu kênh có thể upload cùng lúc (mỗi kênh dùng ~500MB RAM)
            </span>
          </div>
          <span className="form-hint" style={{ marginTop: "var(--space-2)" }}>
            Lịch đăng (giờ bắt đầu, kết thúc, khoảng cách) được cấu hình riêng cho từng channel tại trang Channels.
          </span>
        </div>

        {/* Telegram Notification */}
        <div className="section-card">
          <div className="section-header">
            <div className="section-icon" style={{ background: "rgba(0, 136, 204, 0.15)", color: "#0088cc" }}>
              <Bell size={20} />
            </div>
            <div>
              <div className="section-title">Telegram</div>
              <div className="section-desc">Nhan bao cao dinh ky va canh bao qua Telegram Bot</div>
            </div>
          </div>

          <label className="toggle" style={{ marginBottom: "var(--space-4)" }}>
            <input
              type="checkbox"
              checked={settings.telegramEnabled}
              onChange={(e) => setSettings({ ...settings, telegramEnabled: e.target.checked })}
            />
            <span className="toggle-track" />
            <span className="toggle-label">Bat thong bao Telegram</span>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
            <div className="form-group">
              <label className="label">Bot Token</label>
              <input
                className="input"
                type="password"
                placeholder="123456:ABCdefGhIJKlmno..."
                value={settings.telegramBotToken}
                onChange={(e) => setSettings({ ...settings, telegramBotToken: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="label">Chat ID</label>
              <input
                className="input"
                placeholder="593614960"
                value={settings.telegramChatId}
                onChange={(e) => setSettings({ ...settings, telegramChatId: e.target.value })}
              />
            </div>
          </div>
          <span className="form-hint" style={{ marginBottom: "var(--space-4)", display: "block" }}>
            Tao bot qua @BotFather, lay Chat ID qua @userinfobot. Dung chung cho tat ca channels.
          </span>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
            <div className="form-group">
              <label className="label">Tan suat bao cao</label>
              <select
                className="input"
                value={settings.telegramReportCron}
                onChange={(e) => setSettings({ ...settings, telegramReportCron: Number(e.target.value) })}
              >
                <option value={15}>15 phut</option>
                <option value={30}>30 phut</option>
                <option value={60}>1 gio</option>
                <option value={120}>2 gio</option>
              </select>
            </div>
            <div className="form-group">
              <label className="label">Tan suat thu thap stats</label>
              <select
                className="input"
                value={settings.statsCollectInterval}
                onChange={(e) => setSettings({ ...settings, statsCollectInterval: Number(e.target.value) })}
              >
                <option value={60}>1 gio</option>
                <option value={120}>2 gio</option>
                <option value={240}>4 gio</option>
              </select>
              <span className="form-hint">Agent mo browser scrape YouTube Studio theo chu ky nay</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={testingTG || !settings.telegramBotToken || !settings.telegramChatId}
              onClick={async () => {
                setTestingTG(true);
                setTgResult(null);
                try {
                  const res = await fetch("/api/settings/test-telegram", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      botToken: settings.telegramBotToken,
                      chatId: settings.telegramChatId,
                    }),
                  });
                  const data = await res.json();
                  setTgResult({
                    success: data.success,
                    message: data.success ? data.message : data.error,
                  });
                } catch {
                  setTgResult({ success: false, message: "Khong the ket noi server" });
                }
                setTestingTG(false);
              }}
            >
              {testingTG ? (
                <><Loader2 size={14} className="spinner" /> Dang test...</>
              ) : (
                <><MessageSquare size={14} /> Test ket noi</>
              )}
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={sendingReport || !settings.telegramBotToken || !settings.telegramChatId}
              onClick={async () => {
                setSendingReport(true);
                setReportResult(null);
                // Save settings first so report uses latest config
                await fetch("/api/settings", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(settings),
                });
                try {
                  const res = await fetch("/api/settings/send-report", {
                    method: "POST",
                  });
                  const data = await res.json();
                  setReportResult({
                    success: data.success,
                    message: data.success ? "Da gui bao cao!" : (data.error || "Khong gui duoc"),
                  });
                } catch {
                  setReportResult({ success: false, message: "Khong the ket noi server" });
                }
                setSendingReport(false);
              }}
            >
              {sendingReport ? (
                <><Loader2 size={14} className="spinner" /> Dang gui...</>
              ) : (
                <><Send size={14} /> Gui bao cao thu</>
              )}
            </button>

            {tgResult && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}>
                {tgResult.success ? (
                  <><CheckCircle size={14} style={{ color: "var(--success)" }} /><span style={{ color: "var(--success)" }}>{tgResult.message}</span></>
                ) : (
                  <><AlertTriangle size={14} style={{ color: "var(--warning)" }} /><span style={{ color: "var(--warning)" }}>{tgResult.message}</span></>
                )}
              </div>
            )}
            {reportResult && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}>
                {reportResult.success ? (
                  <><CheckCircle size={14} style={{ color: "var(--success)" }} /><span style={{ color: "var(--success)" }}>{reportResult.message}</span></>
                ) : (
                  <><AlertTriangle size={14} style={{ color: "var(--warning)" }} /><span style={{ color: "var(--warning)" }}>{reportResult.message}</span></>
                )}
              </div>
            )}
          </div>
        </div>

        <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
          {saving ? (
            <><span className="spinner" style={{ width: 16, height: 16 }} /> Đang lưu...</>
          ) : saved ? (
            <><CheckCircle size={18} /> Đã lưu!</>
          ) : (
            <><Save size={18} /> Lưu cài đặt</>
          )}
        </button>
      </form>
    </div>
  );
}
