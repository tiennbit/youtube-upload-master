"use client";
import { useEffect, useState, useCallback } from "react";
import {
  FolderOpen, Clock, Monitor, Plus, Trash2, Power, PowerOff,
  ChevronDown, ChevronUp, ExternalLink, AlertTriangle, Loader2,
  Pencil, Check, X, Save, Globe, Wifi, CheckCircle
} from "lucide-react";

interface Channel {
  id: number;
  name: string;
  slug: string | null;
  gologinProfileId: string | null;
  studioUrl: string | null;
  nextcloudFolder: string | null;
  uploadEnabled: boolean;
  uploadVisibility: string;
  uploadStartHour: number;
  uploadEndHour: number;
  uploadInterval: number;
  isLoggedIn: boolean;
  lastUpload: string | null;
  _count: { uploads: number };
}

const STUDIO_URL_REGEX = /^https:\/\/studio\.youtube\.com\/channel\/UC[a-zA-Z0-9_-]+/;
const validateStudioUrl = (url: string): boolean => STUDIO_URL_REGEX.test(url);

interface GoLoginProfile {
  id: string;
  name: string;
  os: string;
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [profiles, setProfiles] = useState<GoLoginProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkingLogin, setCheckingLogin] = useState<number | null>(null);
  const [loginStatus, setLoginStatus] = useState<Record<number, string>>({});
  const [folderTest, setFolderTest] = useState<{ testing: boolean; result: { success: boolean; message: string; videoCount?: number } | null }>({ testing: false, result: null });
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleTestFolder = async (folder: string) => {
    if (!folder) return;
    setFolderTest({ testing: true, result: null });
    try {
      const res = await fetch("/api/nextcloud/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      });
      const data = await res.json();
      setFolderTest({
        testing: false,
        result: {
          success: data.success,
          message: data.success ? data.message : data.error,
          videoCount: data.videoCount,
        },
      });
    } catch {
      setFolderTest({ testing: false, result: { success: false, message: "Lỗi kết nối" } });
    }
  };

  // Edit state for the editing channel
  const [editForm, setEditForm] = useState({
    name: "",
    gologinProfileId: "",
    studioUrl: "",
    nextcloudFolder: "",
    uploadVisibility: "public",
    uploadStartHour: 8,
    uploadEndHour: 22,
    uploadInterval: 30,
  });

  // Create form state
  const [form, setForm] = useState({
    name: "",
    gologinProfileId: "",
    studioUrl: "",
    nextcloudFolder: "",
    uploadVisibility: "public",
    uploadStartHour: 8,
    uploadEndHour: 22,
    uploadInterval: 30,
  });

  const fetchChannels = useCallback(async () => {
    const res = await fetch("/api/channels");
    if (res.ok) setChannels(await res.json());
  }, []);

  const fetchProfiles = useCallback(async () => {
    setProfilesLoading(true);
    setProfilesError("");
    try {
      const res = await fetch("/api/gologin/profiles");
      const data = await res.json();
      if (data.profiles) setProfiles(data.profiles);
      if (data.error) setProfilesError(data.error);
    } catch {
      setProfilesError("Không thể tải GoLogin profiles");
    }
    setProfilesLoading(false);
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Start editing a channel
  const startEditing = (ch: Channel) => {
    setEditingId(ch.id);
    setEditForm({
      name: ch.name,
      gologinProfileId: ch.gologinProfileId || "",
      studioUrl: ch.studioUrl || "",
      nextcloudFolder: ch.nextcloudFolder || "",
      uploadVisibility: ch.uploadVisibility,
      uploadStartHour: ch.uploadStartHour,
      uploadEndHour: ch.uploadEndHour,
      uploadInterval: ch.uploadInterval,
    });
    fetchProfiles();
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const saveEditing = async (channelId: number) => {
    setSaving(true);
    const res = await fetch(`/api/channels/${channelId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name,
        gologinProfileId: editForm.gologinProfileId || null,
        studioUrl: editForm.studioUrl || null,
        nextcloudFolder: editForm.nextcloudFolder || null,
        uploadVisibility: editForm.uploadVisibility,
        uploadStartHour: editForm.uploadStartHour,
        uploadEndHour: editForm.uploadEndHour,
        uploadInterval: editForm.uploadInterval,
      }),
    });
    if (res.ok) {
      setEditingId(null);
      fetchChannels();
    }
    setSaving(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.studioUrl && !validateStudioUrl(form.studioUrl)) {
      alert("Studio URL không hợp lệ. Phải có dạng: https://studio.youtube.com/channel/UC...");
      return;
    }
    if (!form.studioUrl) {
      alert("Studio URL là bắt buộc!");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        gologinProfileId: form.gologinProfileId || null,
        studioUrl: form.studioUrl,
        nextcloudFolder: form.nextcloudFolder || null,
        uploadVisibility: form.uploadVisibility,
        uploadStartHour: form.uploadStartHour,
        uploadEndHour: form.uploadEndHour,
        uploadInterval: form.uploadInterval,
      }),
    });
    if (res.ok) {
      setForm({ name: "", gologinProfileId: "", studioUrl: "", nextcloudFolder: "", uploadVisibility: "public", uploadStartHour: 8, uploadEndHour: 22, uploadInterval: 30 });
      setShowForm(false);
      fetchChannels();
    }
    setLoading(false);
  };

  const handleToggle = async (id: number, enabled: boolean) => {
    await fetch(`/api/channels/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadEnabled: !enabled }),
    });
    fetchChannels();
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirmId === null) return;
    const id = deleteConfirmId;
    setDeleting(true);
    try {
      const res = await fetch(`/api/channels/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        alert(`Lỗi xóa channel: ${data.error || res.statusText}`);
        return;
      }
      if (expandedId === id) setExpandedId(null);
      if (editingId === id) setEditingId(null);
      fetchChannels();
    } catch (err: any) {
      alert(`Lỗi xóa channel: ${err.message}`);
    } finally {
      setDeleting(false);
      setDeleteConfirmId(null);
    }
  };

  const handleOpenProfile = async (ch: Channel) => {
    if (!ch.gologinProfileId) return;
    setCheckingLogin(ch.id);
    setLoginStatus((prev) => ({ ...prev, [ch.id]: "opening" }));
    try {
      const res = await fetch("/api/agent/open-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: ch.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setLoginStatus((prev) => ({ ...prev, [ch.id]: "sent" }));
      } else {
        setLoginStatus((prev) => ({ ...prev, [ch.id]: `error:${data.error}` }));
      }
    } catch {
      setLoginStatus((prev) => ({ ...prev, [ch.id]: "error:Không thể kết nối server" }));
    }
    setTimeout(() => setCheckingLogin(null), 3000);
  };

  function renderProfileStatus(channelId: number, isLoggedIn: boolean) {
    const status = loginStatus[channelId];

    // Show persistent login badge if channel has login status from DB
    if (!status && isLoggedIn) {
      return (
        <div className="callout callout-info" style={{ marginBottom: "var(--space-4)", background: "var(--success-muted)", borderColor: "rgba(52, 211, 153, 0.15)" }}>
          <Check size={16} style={{ color: "var(--success)" }} />
          <span style={{ color: "var(--success)" }}>YouTube đã đăng nhập</span>
        </div>
      );
    }

    if (!status) return null;

    if (status === "opening") {
      return (
        <div className="callout callout-info" style={{ marginBottom: "var(--space-4)" }}>
          <Loader2 size={16} className="spinner" />
          <span>Đang gửi yêu cầu...</span>
        </div>
      );
    }
    if (status === "sent") {
      return (
        <div className="callout callout-info" style={{ marginBottom: "var(--space-4)", background: "var(--accent-muted)" }}>
          <Monitor size={16} style={{ color: "var(--accent)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={{ color: "var(--accent)" }}>Yêu cầu đã gửi thành công!</span>
            <span className="form-hint">Desktop Agent sẽ mở GoLogin profile trên máy tính ~30s. <strong>Agent phải đang chạy</strong> (xem hướng dẫn trang Agent).</span>
          </div>
        </div>
      );
    }
    if (status.startsWith("error:")) {
      const errorMsg = status.replace("error:", "");
      return (
        <div className="callout callout-warning" style={{ marginBottom: "var(--space-4)" }}>
          <AlertTriangle size={16} />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span>{errorMsg}</span>
            <span className="form-hint">Đảm bảo Desktop Agent đang chạy bản mới nhất. Xem trang Agent để cài đặt.</span>
          </div>
        </div>
      );
    }
    return null;
  }

  // Find GoLogin profile name by id
  function getProfileName(profileId: string | null): string | null {
    if (!profileId) return null;
    const p = profiles.find(p => p.id === profileId);
    return p ? `${p.name} (${p.os})` : null;
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Channels</h1>
          <p className="page-subtitle">Quản lý các kênh YouTube của bạn</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => { setShowForm(!showForm); if (!showForm) fetchProfiles(); }}
        >
          <Plus size={16} /> Thêm Channel
        </button>
      </div>

      {/* Create Channel Form */}
      {showForm && (
        <div className="section-card" style={{ marginBottom: "var(--space-6)" }}>
          <div className="section-header">
            <div className="section-icon">
              <Plus size={20} />
            </div>
            <div>
              <div className="section-title">Tạo Channel mới</div>
              <div className="section-desc">Kết nối kênh YouTube với GoLogin profile</div>
            </div>
          </div>

          <form onSubmit={handleCreate}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
              <div className="form-group">
                <label className="label">Tên Channel *</label>
                <input
                  className="input"
                  placeholder="Ví dụ: Kênh Tech Review"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="label">
                  <Monitor size={14} />
                  GoLogin Profile
                </label>
                {profilesLoading ? (
                  <div className="input" style={{ display: "flex", alignItems: "center", color: "var(--text-tertiary)" }}>
                    <span className="spinner" style={{ width: 16, height: 16, marginRight: 8 }} />
                    Đang tải profiles...
                  </div>
                ) : profilesError ? (
                  <div>
                    <div className="form-error" style={{ marginBottom: "var(--space-2)" }}>{profilesError}</div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={fetchProfiles}>Thử lại</button>
                  </div>
                ) : (
                  <select
                    className="input"
                    value={form.gologinProfileId}
                    onChange={(e) => setForm({ ...form, gologinProfileId: e.target.value })}
                  >
                    <option value="">— Chọn profile —</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.os})</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="form-group">
                <label className="label">
                  <ExternalLink size={14} />
                  Studio URL *
                </label>
                <input
                  className="input"
                  placeholder="https://studio.youtube.com/channel/UC..."
                  value={form.studioUrl}
                  onChange={(e) => setForm({ ...form, studioUrl: e.target.value })}
                  required
                  style={form.studioUrl && !validateStudioUrl(form.studioUrl) ? { borderColor: 'var(--warning)' } : {}}
                />
                {form.studioUrl && !validateStudioUrl(form.studioUrl) && (
                  <span className="form-hint" style={{ color: 'var(--warning)' }}>
                    <AlertTriangle size={12} /> URL phải có dạng: https://studio.youtube.com/channel/UC...
                  </span>
                )}
                {form.studioUrl && validateStudioUrl(form.studioUrl) && (
                  <span className="form-hint" style={{ color: 'var(--success)' }}>
                    <CheckCircle size={12} /> URL hợp lệ
                  </span>
                )}
              </div>

              <div className="form-group">
                <label className="label">
                  <FolderOpen size={14} />
                  Nextcloud Folder
                </label>
                <input
                  className="input"
                  placeholder="youtube-automation/ten-kenh"
                  value={form.nextcloudFolder}
                  onChange={(e) => setForm({ ...form, nextcloudFolder: e.target.value })}
                />
                <span className="form-hint">
                  Đường dẫn thư mục trên Nextcloud (không cần /remote.php/...). Ví dụ: <code>youtube-automation/ks-news</code>
                </span>
              </div>

              <div className="form-group">
                <label className="label">Visibility mặc định</label>
                <select
                  className="input"
                  value={form.uploadVisibility}
                  onChange={(e) => setForm({ ...form, uploadVisibility: e.target.value })}
                >
                  <option value="public">Public</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="private">Private</option>
                </select>
              </div>
            </div>

            {/* Schedule Section */}
            <div className="schedule-box">
              <h4>
                <Clock size={16} style={{ color: "var(--accent)" }} />
                Lịch đăng video
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-4)" }}>
                <div className="form-group">
                  <label className="label">Giờ bắt đầu</label>
                  <input
                    type="number"
                    className="input"
                    min={0} max={23}
                    value={form.uploadStartHour}
                    onChange={(e) => setForm({ ...form, uploadStartHour: Number(e.target.value) })}
                  />
                  <span className="form-hint">Upload bắt đầu từ giờ này</span>
                </div>
                <div className="form-group">
                  <label className="label">Giờ kết thúc</label>
                  <input
                    type="number"
                    className="input"
                    min={0} max={23}
                    value={form.uploadEndHour}
                    onChange={(e) => setForm({ ...form, uploadEndHour: Number(e.target.value) })}
                  />
                  <span className="form-hint">Dừng upload sau giờ này</span>
                </div>
                <div className="form-group">
                  <label className="label">Khoảng cách (phút)</label>
                  <input
                    type="number"
                    className="input"
                    min={5} max={1440}
                    value={form.uploadInterval}
                    onChange={(e) => setForm({ ...form, uploadInterval: Number(e.target.value) })}
                  />
                  <span className="form-hint">Thời gian giữa mỗi upload</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: "var(--space-5)", display: "flex", gap: "var(--space-3)" }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? (
                  <><span className="spinner" style={{ width: 16, height: 16 }} /> Đang tạo...</>
                ) : (
                  "Tạo Channel"
                )}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Hủy</button>
            </div>
          </form>
        </div>
      )}

      {/* Channels List */}
      {channels.length === 0 ? (
        <div className="empty-state">
          <div style={{ width: 64, height: 64, borderRadius: "var(--radius-xl)", background: "var(--accent-muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto var(--space-5)" }}>
            <Monitor size={32} color="var(--accent)" />
          </div>
          <h3>Chưa có channel nào</h3>
          <p>Bấm &quot;Thêm Channel&quot; để bắt đầu kết nối kênh YouTube của bạn</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {channels.map((ch) => {
            const isEditing = editingId === ch.id;
            const isExpanded = expandedId === ch.id;

            return (
              <div key={ch.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
                {/* Channel Header Row */}
                <div
                  className="channel-row"
                  onClick={() => {
                    if (!isEditing) {
                      setExpandedId(isExpanded ? null : ch.id);
                    }
                  }}
                >
                  <div>
                    <span className="channel-name">{ch.name}</span>
                    {ch.slug && <span className="channel-slug">#{ch.slug}</span>}
                    {ch.isLoggedIn && (
                      <span className="badge badge-success" style={{ marginLeft: "var(--space-2)", verticalAlign: "middle" }}>
                        YT Login
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                    {ch.gologinProfileId ? (
                      <span className="flex items-center gap-2">
                        <Monitor size={12} /> {ch.gologinProfileId.slice(0, 12)}...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2" style={{ color: "var(--warning)" }}>
                        <AlertTriangle size={12} /> Chưa chọn profile
                      </span>
                    )}
                  </div>
                  <div>
                    <span className={`badge ${ch.uploadEnabled ? "badge-success" : "badge-neutral"}`}>
                      {ch.uploadEnabled ? "Đang bật" : "Tắt"}
                    </span>
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                    {ch._count.uploads} uploads
                  </div>
                  <div style={{ display: "flex", gap: 4, color: "var(--text-tertiary)" }}>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* Expanded Detail — View or Edit Mode */}
                {isExpanded && (
                  <div className="channel-detail">
                    {isEditing ? (
                      /* ======== EDIT MODE ======== */
                      <>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-5)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                            <Pencil size={16} style={{ color: "var(--accent)" }} />
                            <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>Chỉnh sửa thông tin Channel</span>
                          </div>
                        </div>

                        {/* Name + GoLogin Profile */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
                          <div className="form-group">
                            <label className="label">Tên Channel</label>
                            <input
                              className="input"
                              value={editForm.name}
                              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                              required
                            />
                          </div>
                          <div className="form-group">
                            <label className="label">
                              <Monitor size={14} />
                              GoLogin Profile
                            </label>
                            {profilesLoading ? (
                              <div className="input" style={{ display: "flex", alignItems: "center", color: "var(--text-tertiary)" }}>
                                <span className="spinner" style={{ width: 16, height: 16, marginRight: 8 }} />
                                Đang tải...
                              </div>
                            ) : profilesError ? (
                              <div>
                                <div className="form-error" style={{ marginBottom: "var(--space-2)" }}>{profilesError}</div>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={fetchProfiles}>Thử lại</button>
                              </div>
                            ) : (
                              <select
                                className="input"
                                value={editForm.gologinProfileId}
                                onChange={(e) => setEditForm({ ...editForm, gologinProfileId: e.target.value })}
                              >
                                <option value="">— Chọn profile —</option>
                                {profiles.map((p) => (
                                  <option key={p.id} value={p.id}>{p.name} ({p.os})</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>

                        {/* Studio URL */}
                        <div className="form-group" style={{ marginBottom: "var(--space-4)" }}>
                          <label className="label">
                            <ExternalLink size={14} />
                            Studio URL *
                          </label>
                          <input
                            className="input"
                            placeholder="https://studio.youtube.com/channel/UC..."
                            value={editForm.studioUrl}
                            onChange={(e) => setEditForm({ ...editForm, studioUrl: e.target.value })}
                            required
                            style={editForm.studioUrl && !validateStudioUrl(editForm.studioUrl) ? { borderColor: 'var(--warning)' } : {}}
                          />
                          {editForm.studioUrl && !validateStudioUrl(editForm.studioUrl) && (
                            <span className="form-hint" style={{ color: 'var(--warning)' }}>
                              <AlertTriangle size={12} /> URL phải có dạng: https://studio.youtube.com/channel/UC...
                            </span>
                          )}
                          {editForm.studioUrl && validateStudioUrl(editForm.studioUrl) && (
                            <span className="form-hint" style={{ color: 'var(--success)' }}>
                              <CheckCircle size={12} /> URL hợp lệ
                            </span>
                          )}
                        </div>

                        {/* Nextcloud + Visibility */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
                          <div className="form-group">
                            <label className="label"><FolderOpen size={14} /> Nextcloud Folder</label>
                            <input
                              className="input"
                              placeholder="youtube-automation/ten-kenh"
                              value={editForm.nextcloudFolder}
                              onChange={(e) => setEditForm({ ...editForm, nextcloudFolder: e.target.value })}
                            />
                            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-2)", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={folderTest.testing || !editForm.nextcloudFolder}
                                onClick={() => handleTestFolder(editForm.nextcloudFolder)}
                                style={{ padding: "4px 10px", fontSize: "var(--text-xs)" }}
                              >
                                {folderTest.testing ? (
                                  <><Loader2 size={12} className="spinner" /> Đang kiểm tra...</>
                                ) : (
                                  <><Wifi size={12} /> Kiểm tra folder</>
                                )}
                              </button>
                              {folderTest.result && (
                                <span style={{ fontSize: "var(--text-xs)", color: folderTest.result.success ? "var(--success)" : "var(--warning)" }}>
                                  {folderTest.result.success ? (
                                    <><CheckCircle size={12} /> {folderTest.result.message}</>
                                  ) : (
                                    <><AlertTriangle size={12} /> {folderTest.result.message}</>
                                  )}
                                </span>
                              )}
                            </div>
                            <span className="form-hint">
                              Ví dụ: <code>youtube-automation/ks-news</code> (không cần /remote.php/...)
                            </span>
                          </div>
                          <div className="form-group">
                            <label className="label">Visibility</label>
                            <select
                              className="input"
                              value={editForm.uploadVisibility}
                              onChange={(e) => setEditForm({ ...editForm, uploadVisibility: e.target.value })}
                            >
                              <option value="public">Public</option>
                              <option value="unlisted">Unlisted</option>
                              <option value="private">Private</option>
                            </select>
                          </div>
                        </div>

                        {/* Schedule */}
                        <div className="schedule-box" style={{ marginTop: 0, marginBottom: "var(--space-4)" }}>
                          <h4>
                            <Clock size={16} style={{ color: "var(--accent)" }} />
                            Lịch đăng video
                          </h4>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-4)" }}>
                            <div className="form-group">
                              <label className="label">Giờ bắt đầu</label>
                              <input
                                type="number"
                                className="input"
                                min={0} max={23}
                                value={editForm.uploadStartHour}
                                onChange={(e) => setEditForm({ ...editForm, uploadStartHour: Number(e.target.value) })}
                              />
                            </div>
                            <div className="form-group">
                              <label className="label">Giờ kết thúc</label>
                              <input
                                type="number"
                                className="input"
                                min={0} max={23}
                                value={editForm.uploadEndHour}
                                onChange={(e) => setEditForm({ ...editForm, uploadEndHour: Number(e.target.value) })}
                              />
                            </div>
                            <div className="form-group">
                              <label className="label">Khoảng cách (phút)</label>
                              <input
                                type="number"
                                className="input"
                                min={5} max={1440}
                                value={editForm.uploadInterval}
                                onChange={(e) => setEditForm({ ...editForm, uploadInterval: Number(e.target.value) })}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Edit Actions */}
                        <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "flex-end" }}>
                          <button
                            className="btn btn-ghost"
                            onClick={cancelEditing}
                            disabled={saving}
                          >
                            <X size={14} /> Hủy
                          </button>
                          <button
                            className="btn btn-primary"
                            onClick={() => saveEditing(ch.id)}
                            disabled={saving || !editForm.name.trim()}
                          >
                            {saving ? (
                              <><span className="spinner" style={{ width: 14, height: 14 }} /> Đang lưu...</>
                            ) : (
                              <><Save size={14} /> Lưu thay đổi</>
                            )}
                          </button>
                        </div>
                      </>
                    ) : (
                      /* ======== VIEW MODE ======== */
                      <>
                        {/* Info summary */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-5)", marginBottom: "var(--space-5)" }}>
                          <div>
                            <div className="label" style={{ marginBottom: "var(--space-1)" }}>GoLogin Profile</div>
                            <div style={{ fontSize: "var(--text-sm)", color: ch.gologinProfileId ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                              {ch.gologinProfileId ? (
                                <span className="flex items-center gap-2">
                                  <Monitor size={14} style={{ color: "var(--accent)" }} />
                                  {getProfileName(ch.gologinProfileId) || ch.gologinProfileId.slice(0, 16) + "..."}
                                </span>
                              ) : (
                                "Chưa cấu hình"
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="label" style={{ marginBottom: "var(--space-1)" }}>Nextcloud Folder</div>
                            <div style={{ fontSize: "var(--text-sm)", color: ch.nextcloudFolder ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                              {ch.nextcloudFolder ? (
                                <span className="flex items-center gap-2">
                                  <FolderOpen size={14} style={{ color: "var(--accent)" }} />
                                  {ch.nextcloudFolder}
                                </span>
                              ) : (
                                "Chưa cấu hình"
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="label" style={{ marginBottom: "var(--space-1)" }}>Lịch upload</div>
                            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
                              <span className="flex items-center gap-2">
                                <Clock size={14} style={{ color: "var(--accent)" }} />
                                {ch.uploadStartHour}:00 – {ch.uploadEndHour}:00 / mỗi {ch.uploadInterval} phút
                              </span>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-5)", marginBottom: "var(--space-5)" }}>
                          <div>
                            <div className="label" style={{ marginBottom: "var(--space-1)" }}>Visibility</div>
                            <div>
                              <span className="badge badge-neutral">{ch.uploadVisibility}</span>
                            </div>
                          </div>
                          <div>
                            <div className="label" style={{ marginBottom: "var(--space-1)" }}>Tổng uploads</div>
                            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 600 }}>
                              {ch._count.uploads} video
                            </div>
                          </div>
                          <div>
                            <div className="label" style={{ marginBottom: "var(--space-1)" }}>Upload lần cuối</div>
                            <div style={{ fontSize: "var(--text-sm)", color: ch.lastUpload ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                              {ch.lastUpload ? new Date(ch.lastUpload).toLocaleString("vi-VN") : "Chưa có"}
                            </div>
                          </div>
                        </div>

                        {/* Profile Status */}
                        {renderProfileStatus(ch.id, ch.isLoggedIn)}

                        {/* View Actions */}
                        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", flexWrap: "wrap" }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={(e) => { e.stopPropagation(); startEditing(ch); }}
                          >
                            <Pencil size={14} /> Chỉnh sửa
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => { e.stopPropagation(); handleOpenProfile(ch); }}
                            disabled={checkingLogin === ch.id || !ch.gologinProfileId}
                            title={!ch.gologinProfileId ? "Chọn GoLogin Profile trước (bấm Chỉnh sửa)" : "Mở GoLogin profile trên cloud để kiểm tra"}
                          >
                            <Globe size={14} /> Mở Profile
                          </button>
                          <button
                            className={`btn btn-sm ${ch.uploadEnabled ? "btn-ghost" : "btn-primary"}`}
                            onClick={(e) => { e.stopPropagation(); handleToggle(ch.id, ch.uploadEnabled); }}
                          >
                            {ch.uploadEnabled ? <><PowerOff size={14} /> Tắt</> : <><Power size={14} /> Bật</>}
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(ch.id); }}
                          >
                            <Trash2 size={14} /> Xóa
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {deleteConfirmId !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          onClick={() => !deleting && setDeleteConfirmId(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: 420,
              width: "90%",
              padding: "var(--space-6)",
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "var(--radius-xl)",
                background: "var(--error-muted, rgba(239,68,68,0.15))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto var(--space-4)",
              }}
            >
              <AlertTriangle size={24} color="var(--error)" />
            </div>
            <h3 style={{ marginBottom: "var(--space-2)", color: "var(--text-primary)" }}>
              Xác nhận xóa channel
            </h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-5)", fontSize: "var(--text-sm)" }}>
              Bạn chắc chắn muốn xóa channel{" "}
              <strong>"{channels.find((c) => c.id === deleteConfirmId)?.name}"</strong>?
              <br />
              Tất cả uploads liên quan cũng sẽ bị xóa. Hành động này không thể hoàn tác.
            </p>
            <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "center" }}>
              <button
                className="btn btn-ghost"
                onClick={() => setDeleteConfirmId(null)}
                disabled={deleting}
              >
                Hủy
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDeleteConfirm}
                disabled={deleting}
              >
                {deleting ? (
                  <><span className="spinner" style={{ width: 14, height: 14 }} /> Đang xóa...</>
                ) : (
                  <><Trash2 size={14} /> Xóa channel</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
