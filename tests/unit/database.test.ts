import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

describe("Prisma Schema & Database", () => {
  beforeEach(async () => {
    await prisma.upload.deleteMany();
    await prisma.channel.deleteMany();
    await prisma.userSettings.deleteMany();
    await prisma.user.deleteMany();
  });

  // --- User Model ---
  describe("User Model", () => {
    it("should create a user with required fields", async () => {
      const user = await prisma.user.create({
        data: {
          email: "test@example.com",
          passwordHash: "hashed_password_123",
        },
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe("test@example.com");
      expect(user.agentToken).toBeDefined();
      expect(user.createdAt).toBeInstanceOf(Date);
    });

    it("should auto-generate unique agentToken", async () => {
      const user1 = await prisma.user.create({
        data: { email: "user1@test.com", passwordHash: "hash1" },
      });
      const user2 = await prisma.user.create({
        data: { email: "user2@test.com", passwordHash: "hash2" },
      });

      expect(user1.agentToken).not.toBe(user2.agentToken);
    });

    it("should reject duplicate email", async () => {
      await prisma.user.create({
        data: { email: "dup@test.com", passwordHash: "hash" },
      });

      await expect(
        prisma.user.create({
          data: { email: "dup@test.com", passwordHash: "hash2" },
        })
      ).rejects.toThrow();
    });

    it("should allow optional name field", async () => {
      const user = await prisma.user.create({
        data: {
          email: "noname@test.com",
          passwordHash: "hash",
          name: null,
        },
      });
      expect(user.name).toBeNull();

      const named = await prisma.user.create({
        data: {
          email: "named@test.com",
          passwordHash: "hash",
          name: "Test User",
        },
      });
      expect(named.name).toBe("Test User");
    });
  });

  // --- UserSettings Model ---
  describe("UserSettings Model", () => {
    it("should create settings with defaults", async () => {
      const user = await prisma.user.create({
        data: { email: "settings@test.com", passwordHash: "hash" },
      });

      const settings = await prisma.userSettings.create({
        data: { userId: user.id },
      });

      expect(settings.autoUploadEnabled).toBe(false);
      expect(settings.gologinToken).toBeNull();
      expect(settings.nextcloudUrl).toBeNull();
    });

    it("should enforce one settings per user", async () => {
      const user = await prisma.user.create({
        data: { email: "oneonly@test.com", passwordHash: "hash" },
      });

      await prisma.userSettings.create({ data: { userId: user.id } });

      await expect(
        prisma.userSettings.create({ data: { userId: user.id } })
      ).rejects.toThrow();
    });

    it("should cascade delete when user is deleted", async () => {
      const user = await prisma.user.create({
        data: {
          email: "cascade@test.com",
          passwordHash: "hash",
          settings: { create: {} },
        },
      });

      await prisma.user.delete({ where: { id: user.id } });

      const settings = await prisma.userSettings.findUnique({
        where: { userId: user.id },
      });
      expect(settings).toBeNull();
    });
  });

  // --- Channel Model ---
  describe("Channel Model", () => {
    let userId: string;

    beforeEach(async () => {
      const user = await prisma.user.create({
        data: { email: "channel-owner@test.com", passwordHash: "hash" },
      });
      userId = user.id;
    });

    it("should create a channel for a user", async () => {
      const channel = await prisma.channel.create({
        data: {
          userId,
          name: "My YouTube Channel",
          gologinProfileId: "profile-123",
        },
      });

      expect(channel.id).toBeDefined();
      expect(channel.name).toBe("My YouTube Channel");
      expect(channel.uploadEnabled).toBe(true);
      expect(channel.uploadVisibility).toBe("public");
      expect(channel.isLoggedIn).toBe(false);
    });

    it("should reject duplicate channel names for same user", async () => {
      await prisma.channel.create({
        data: { userId, name: "Duplicate" },
      });

      await expect(
        prisma.channel.create({ data: { userId, name: "Duplicate" } })
      ).rejects.toThrow();
    });

    it("should allow same channel name for different users", async () => {
      const user2 = await prisma.user.create({
        data: { email: "other@test.com", passwordHash: "hash" },
      });

      await prisma.channel.create({ data: { userId, name: "Same Name" } });
      const ch2 = await prisma.channel.create({
        data: { userId: user2.id, name: "Same Name" },
      });

      expect(ch2.name).toBe("Same Name");
    });

    it("should cascade delete channels when user is deleted", async () => {
      await prisma.channel.create({ data: { userId, name: "Will Delete" } });

      await prisma.user.delete({ where: { id: userId } });

      const channels = await prisma.channel.findMany({ where: { userId } });
      expect(channels).toHaveLength(0);
    });
  });

  // --- Upload Model ---
  describe("Upload Model", () => {
    let channelId: number;

    beforeEach(async () => {
      const user = await prisma.user.create({
        data: { email: "uploader@test.com", passwordHash: "hash" },
      });
      const channel = await prisma.channel.create({
        data: { userId: user.id, name: "Upload Channel" },
      });
      channelId = channel.id;
    });

    it("should create an upload with defaults", async () => {
      const upload = await prisma.upload.create({
        data: {
          channelId,
          title: "My Video",
        },
      });

      expect(upload.status).toBe("PENDING");
      expect(upload.visibility).toBe("public");
      expect(upload.error).toBeNull();
      expect(upload.uploadedAt).toBeNull();
    });

    it("should update upload status through lifecycle", async () => {
      const upload = await prisma.upload.create({
        data: { channelId, title: "Lifecycle Test" },
      });
      expect(upload.status).toBe("PENDING");

      const uploading = await prisma.upload.update({
        where: { id: upload.id },
        data: { status: "UPLOADING" },
      });
      expect(uploading.status).toBe("UPLOADING");

      const done = await prisma.upload.update({
        where: { id: upload.id },
        data: { status: "DONE", uploadedAt: new Date() },
      });
      expect(done.status).toBe("DONE");
      expect(done.uploadedAt).toBeInstanceOf(Date);
    });

    it("should store error message for failed uploads", async () => {
      const upload = await prisma.upload.create({
        data: { channelId, title: "Fail Test" },
      });

      const failed = await prisma.upload.update({
        where: { id: upload.id },
        data: { status: "FAILED", error: "GoLogin profile not found" },
      });

      expect(failed.status).toBe("FAILED");
      expect(failed.error).toBe("GoLogin profile not found");
    });

    it("should cascade delete uploads when channel is deleted", async () => {
      await prisma.upload.create({ data: { channelId, title: "Vid 1" } });
      await prisma.upload.create({ data: { channelId, title: "Vid 2" } });

      await prisma.channel.delete({ where: { id: channelId } });

      const uploads = await prisma.upload.findMany({ where: { channelId } });
      expect(uploads).toHaveLength(0);
    });

    it("should support scheduling fields", async () => {
      const scheduled = new Date("2026-04-10T14:00:00Z");
      const upload = await prisma.upload.create({
        data: {
          channelId,
          title: "Scheduled Video",
          scheduledAt: scheduled,
        },
      });

      expect(upload.scheduledAt).toEqual(scheduled);
    });
  });

  // --- Cross-Model Queries ---
  describe("Cross-Model Queries", () => {
    it("should count uploads per channel", async () => {
      const user = await prisma.user.create({
        data: { email: "counter@test.com", passwordHash: "hash" },
      });

      const ch1 = await prisma.channel.create({
        data: { userId: user.id, name: "Channel A" },
      });
      const ch2 = await prisma.channel.create({
        data: { userId: user.id, name: "Channel B" },
      });

      await prisma.upload.createMany({
        data: [
          { channelId: ch1.id, title: "A1" },
          { channelId: ch1.id, title: "A2" },
          { channelId: ch1.id, title: "A3" },
          { channelId: ch2.id, title: "B1" },
        ],
      });

      const channels = await prisma.channel.findMany({
        where: { userId: user.id },
        include: { _count: { select: { uploads: true } } },
      });

      const chA = channels.find((c) => c.name === "Channel A");
      const chB = channels.find((c) => c.name === "Channel B");

      expect(chA?._count.uploads).toBe(3);
      expect(chB?._count.uploads).toBe(1);
    });

    it("should find pending uploads for a user", async () => {
      const user = await prisma.user.create({
        data: { email: "pending@test.com", passwordHash: "hash" },
      });
      const ch = await prisma.channel.create({
        data: { userId: user.id, name: "Pending Ch" },
      });

      await prisma.upload.createMany({
        data: [
          { channelId: ch.id, title: "Pending 1", status: "PENDING" },
          { channelId: ch.id, title: "Done 1", status: "DONE" },
          { channelId: ch.id, title: "Pending 2", status: "PENDING" },
          { channelId: ch.id, title: "Failed 1", status: "FAILED" },
        ],
      });

      const pending = await prisma.upload.findMany({
        where: { channel: { userId: user.id }, status: "PENDING" },
      });

      expect(pending).toHaveLength(2);
    });
  });
});
