import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:3000";

let counter = 0;
function uniqueEmail() {
  return `agent-${Date.now()}-${++counter}@tubeflow.com`;
}

async function createAgentTestUser() {
  const email = uniqueEmail();
  const passwordHash = await bcrypt.hash("password123", 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      settings: {
        create: {
          gologinToken: "gl-token-123",
          nextcloudUrl: "https://nc.example.com",
          nextcloudUsername: "ncuser",
          nextcloudPassword: "ncpass",
        },
      },
    },
  });

  const channel = await prisma.channel.create({
    data: {
      userId: user.id,
      name: `Agent-Ch-${Date.now()}-${counter}`,
      gologinProfileId: "gologin-profile-abc",
      uploadStartHour: 0,
      uploadEndHour: 23,
      uploadInterval: 30,
    },
  });

  return { user, channel, agentToken: user.agentToken };
}

describe("API Routes — Agent", () => {
  // --- GET /api/agent/jobs ---
  describe("GET /api/agent/jobs", () => {
    it("should return 401 without auth token", async () => {
      const res = await fetch(`${BASE_URL}/api/agent/jobs`);
      expect(res.status).toBe(401);
    });

    it("should return 401 with invalid token", async () => {
      const res = await fetch(`${BASE_URL}/api/agent/jobs`, {
        headers: { Authorization: "Bearer invalid-token-xyz" },
      });
      expect(res.status).toBe(401);
    });

    it("should return null job when no pending uploads", async () => {
      const { agentToken } = await createAgentTestUser();

      const res = await fetch(`${BASE_URL}/api/agent/jobs`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.job).toBeNull();
      expect(data.reason).toBe("no_pending_jobs");
    });

    it("should return next pending upload as job", async () => {
      const { agentToken, channel } = await createAgentTestUser();

      await prisma.upload.create({
        data: {
          channelId: channel.id,
          title: "Test Video Agent",
          description: "Test description",
          videoPath: "/videos/test.mp4",
          status: "PENDING",
        },
      });

      const res = await fetch(`${BASE_URL}/api/agent/jobs`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.job).not.toBeNull();
      expect(data.job.title).toBe("Test Video Agent");
      expect(data.job.channel.gologinProfileId).toBe("gologin-profile-abc");
      expect(data.settings.gologinToken).toBe("gl-token-123");
    });

    it("should mark returned job as UPLOADING", async () => {
      const { agentToken, channel } = await createAgentTestUser();

      const upload = await prisma.upload.create({
        data: { channelId: channel.id, title: "Status Mark Test", status: "PENDING" },
      });

      await fetch(`${BASE_URL}/api/agent/jobs`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });

      const updated = await prisma.upload.findUnique({ where: { id: upload.id } });
      expect(updated!.status).toBe("UPLOADING");
    });

    it("should return oldest PENDING job first (FIFO)", async () => {
      const { agentToken, channel } = await createAgentTestUser();

      await prisma.upload.create({
        data: { channelId: channel.id, title: "FIFO-First", status: "PENDING" },
      });
      await new Promise((r) => setTimeout(r, 50));
      await prisma.upload.create({
        data: { channelId: channel.id, title: "FIFO-Second", status: "PENDING" },
      });

      const res = await fetch(`${BASE_URL}/api/agent/jobs`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });

      const data = await res.json();
      expect(data.job.title).toBe("FIFO-First");
    });

    it("should skip DONE and FAILED uploads", async () => {
      const { agentToken, channel } = await createAgentTestUser();

      await prisma.upload.create({
        data: { channelId: channel.id, title: "Done-Skip", status: "DONE" },
      });
      await prisma.upload.create({
        data: { channelId: channel.id, title: "Failed-Skip", status: "FAILED" },
      });

      const res = await fetch(`${BASE_URL}/api/agent/jobs`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });

      const data = await res.json();
      expect(data.job).toBeFalsy();
    });
  });

  // --- POST /api/agent/report ---
  describe("POST /api/agent/report", () => {
    it("should mark upload as DONE", async () => {
      const { agentToken, channel } = await createAgentTestUser();
      const upload = await prisma.upload.create({
        data: { channelId: channel.id, title: "Report Done", status: "UPLOADING" },
      });

      const res = await fetch(`${BASE_URL}/api/agent/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ jobId: upload.id, status: "DONE" }),
      });

      expect(res.status).toBe(200);
      const updated = await prisma.upload.findUnique({ where: { id: upload.id } });
      expect(updated!.status).toBe("DONE");
      expect(updated!.uploadedAt).not.toBeNull();
    });

    it("should mark upload as FAILED with error", async () => {
      const { agentToken, channel } = await createAgentTestUser();
      const upload = await prisma.upload.create({
        data: { channelId: channel.id, title: "Report Fail", status: "UPLOADING" },
      });

      const res = await fetch(`${BASE_URL}/api/agent/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ jobId: upload.id, status: "FAILED", error: "GoLogin timeout" }),
      });

      expect(res.status).toBe(200);
      const updated = await prisma.upload.findUnique({ where: { id: upload.id } });
      expect(updated!.status).toBe("FAILED");
      expect(updated!.error).toBe("GoLogin timeout");
    });

    it("should update channel lastUpload on DONE", async () => {
      const { agentToken, channel } = await createAgentTestUser();
      const upload = await prisma.upload.create({
        data: { channelId: channel.id, title: "LastUpload Report", status: "UPLOADING" },
      });

      await fetch(`${BASE_URL}/api/agent/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ jobId: upload.id, status: "DONE" }),
      });

      const ch = await prisma.channel.findUnique({ where: { id: channel.id } });
      expect(ch!.lastUpload).not.toBeNull();
    });

    it("should reject invalid status values", async () => {
      const { agentToken, channel } = await createAgentTestUser();
      const upload = await prisma.upload.create({
        data: { channelId: channel.id, title: "Invalid Status", status: "UPLOADING" },
      });

      const res = await fetch(`${BASE_URL}/api/agent/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ jobId: upload.id, status: "INVALID" }),
      });

      expect(res.status).toBe(400);
    });

    it("should reject report without auth", async () => {
      const res = await fetch(`${BASE_URL}/api/agent/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: 1, status: "DONE" }),
      });

      expect(res.status).toBe(401);
    });

    it("should return 404 for non-existent job", async () => {
      const { agentToken } = await createAgentTestUser();

      const res = await fetch(`${BASE_URL}/api/agent/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ jobId: 99999, status: "DONE" }),
      });

      expect(res.status).toBe(404);
    });
  });

  // --- GET /api/agent/version ---
  describe("GET /api/agent/version", () => {
    it("should return version info", async () => {
      const res = await fetch(`${BASE_URL}/api/agent/version`);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.latestVersion).toBeDefined();
      expect(typeof data.latestVersion).toBe("string");
    });
  });
});
