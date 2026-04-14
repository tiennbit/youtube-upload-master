import { describe, it, expect } from "vitest";
const BASE_URL = "http://localhost:3000";

let counter = 0;
function uniqueEmail() {
  return `ch-test-${Date.now()}-${++counter}@tubeflow.com`;
}

// Helper: create user via API registration and get auth cookie
async function createUserWithCookie() {
  const email = uniqueEmail();
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123", name: "Ch Test" }),
  });

  const setCookie = res.headers.get("set-cookie") || "";
  return setCookie.split(";")[0] || "";
}

describe("API Routes — Channels", () => {
  // --- GET /api/channels ---
  describe("GET /api/channels", () => {
    it("should return empty array for new user", async () => {
      const cookie = await createUserWithCookie();
      const res = await fetch(`${BASE_URL}/api/channels`, {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it("should return 401 without auth", async () => {
      const res = await fetch(`${BASE_URL}/api/channels`);
      expect(res.status).toBe(401);
    });
  });

  // --- POST /api/channels ---
  describe("POST /api/channels", () => {
    it("should create a channel with name", async () => {
      const cookie = await createUserWithCookie();
      const res = await fetch(`${BASE_URL}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: `Channel-${Date.now()}` }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.name).toContain("Channel-");
      expect(data.uploadEnabled).toBe(true);
    });

    it("should create a channel with all fields", async () => {
      const cookie = await createUserWithCookie();
      const res = await fetch(`${BASE_URL}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          name: `Full-${Date.now()}`,
          slug: "full-ch",
          gologinProfileId: "profile-uuid-123",
          uploadVisibility: "unlisted",
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.slug).toBe("full-ch");
      expect(data.gologinProfileId).toBe("profile-uuid-123");
      expect(data.uploadVisibility).toBe("unlisted");
    });

    it("should reject channel without name", async () => {
      const cookie = await createUserWithCookie();
      const res = await fetch(`${BASE_URL}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("should reject duplicate channel name for same user", async () => {
      const cookie = await createUserWithCookie();
      const name = `Dup-${Date.now()}`;

      await fetch(`${BASE_URL}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name }),
      });

      const res = await fetch(`${BASE_URL}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name }),
      });

      expect(res.status).toBe(409);
    });
  });

  // --- PUT /api/channels/[id] ---
  describe("PUT /api/channels/[id]", () => {
    it("should update channel name", async () => {
      const cookie = await createUserWithCookie();

      const createRes = await fetch(`${BASE_URL}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: `OrigUpdate-${Date.now()}` }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();

      const newName = `Updated-${Date.now()}`;
      const res = await fetch(`${BASE_URL}/api/channels/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: newName }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe(newName);
    });

    it("should toggle uploadEnabled", async () => {
      const cookie = await createUserWithCookie();

      const createRes = await fetch(`${BASE_URL}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: `Toggle-${Date.now()}` }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();

      const res = await fetch(`${BASE_URL}/api/channels/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ uploadEnabled: false }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.uploadEnabled).toBe(false);
    });

    it("should return 404 for non-existent channel", async () => {
      const cookie = await createUserWithCookie();

      const res = await fetch(`${BASE_URL}/api/channels/99999`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: "Ghost" }),
      });

      expect(res.status).toBe(404);
    });
  });

  // --- DELETE /api/channels/[id] ---
  describe("DELETE /api/channels/[id]", () => {
    it("should delete a channel", async () => {
      const cookie = await createUserWithCookie();

      const createRes = await fetch(`${BASE_URL}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: `DelMe-${Date.now()}` }),
      });
      const { id } = await createRes.json();

      const res = await fetch(`${BASE_URL}/api/channels/${id}`, {
        method: "DELETE",
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
    });

    it("should return 404 for non-existent channel", async () => {
      const cookie = await createUserWithCookie();

      const res = await fetch(`${BASE_URL}/api/channels/99999`, {
        method: "DELETE",
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(404);
    });
  });

  // --- Per-Channel Scheduling ---
  describe("Per-Channel Scheduling", () => {
    it("should create channel with custom schedule", async () => {
      const cookie = await createUserWithCookie();
      const res = await fetch(`${BASE_URL}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          name: `Scheduled-${Date.now()}`,
          uploadStartHour: 10,
          uploadEndHour: 18,
          uploadInterval: 60,
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.uploadStartHour).toBe(10);
      expect(data.uploadEndHour).toBe(18);
      expect(data.uploadInterval).toBe(60);
    });

    it("should use default schedule when not specified", async () => {
      const cookie = await createUserWithCookie();
      const res = await fetch(`${BASE_URL}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: `Default-${Date.now()}` }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.uploadStartHour).toBe(8);
      expect(data.uploadEndHour).toBe(22);
      expect(data.uploadInterval).toBe(30);
    });

    it("should update channel schedule independently", async () => {
      const cookie = await createUserWithCookie();
      const createRes = await fetch(`${BASE_URL}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: `SchedUpdate-${Date.now()}` }),
      });
      const { id } = await createRes.json();

      const res = await fetch(`${BASE_URL}/api/channels/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ uploadStartHour: 6, uploadEndHour: 20, uploadInterval: 15 }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.uploadStartHour).toBe(6);
      expect(data.uploadEndHour).toBe(20);
      expect(data.uploadInterval).toBe(15);
    });

    it("should create channel with nextcloudFolder", async () => {
      const cookie = await createUserWithCookie();
      const res = await fetch(`${BASE_URL}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          name: `NCFolder-${Date.now()}`,
          nextcloudFolder: "/videos/my-channel/",
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.nextcloudFolder).toBe("/videos/my-channel/");
    });
  });
});
