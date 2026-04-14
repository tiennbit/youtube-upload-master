import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:3000";

let counter = 0;
function uniqueEmail() {
  return `auth-${Date.now()}-${++counter}@tubeflow.com`;
}

async function createTestUser(email?: string) {
  const e = email || uniqueEmail();
  const passwordHash = await bcrypt.hash("password123", 12);
  return prisma.user.create({
    data: { email: e, name: "API Test User", passwordHash, settings: { create: {} } },
  });
}

function getCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") || "";
  return setCookie.split(";")[0] || "";
}

describe("API Routes — Auth", () => {
  // --- POST /api/auth/register ---
  describe("POST /api/auth/register", () => {
    it("should register a new user and return 201", async () => {
      const email = uniqueEmail();
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "secure123", name: "New User" }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.user.email).toBe(email);
      expect(data.user.name).toBe("New User");
    });

    it("should set auth cookie on registration", async () => {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: uniqueEmail(), password: "secure123" }),
      });

      const cookie = getCookie(res);
      expect(cookie).toContain("tubeflow_token=");
    });

    it("should create UserSettings on registration", async () => {
      const email = uniqueEmail();
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "secure123" }),
      });

      const data = await res.json();
      const settings = await prisma.userSettings.findUnique({
        where: { userId: data.user.id },
      });
      expect(settings).not.toBeNull();
      expect(settings!.autoUploadEnabled).toBe(false);
    });

    it("should reject registration without email", async () => {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "secure123" }),
      });
      expect(res.status).toBe(400);
    });

    it("should reject registration without password", async () => {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: uniqueEmail() }),
      });
      expect(res.status).toBe(400);
    });

    it("should reject password shorter than 6 chars", async () => {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: uniqueEmail(), password: "12345" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("6");
    });

    it("should reject duplicate email with 409", async () => {
      const email = uniqueEmail();
      await createTestUser(email);

      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "secure123" }),
      });
      expect(res.status).toBe(409);
    });
  });

  // --- POST /api/auth/login ---
  describe("POST /api/auth/login", () => {
    it("should login with correct credentials", async () => {
      const email = uniqueEmail();
      await createTestUser(email);

      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "password123" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.email).toBe(email);
    });

    it("should set auth cookie on login", async () => {
      const email = uniqueEmail();
      await createTestUser(email);

      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "password123" }),
      });

      const cookie = getCookie(res);
      expect(cookie).toContain("tubeflow_token=");
    });

    it("should reject wrong password with 401", async () => {
      const email = uniqueEmail();
      await createTestUser(email);

      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "wrongpassword" }),
      });
      expect(res.status).toBe(401);
    });

    it("should reject non-existent email with 401", async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nonexistent@example.com", password: "pass" }),
      });
      expect(res.status).toBe(401);
    });

    it("should reject missing fields with 400", async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  // --- GET /api/auth/me ---
  describe("GET /api/auth/me", () => {
    it("should return 401 without auth cookie", async () => {
      const res = await fetch(`${BASE_URL}/api/auth/me`);
      expect(res.status).toBe(401);
    });

    it("should return user info with valid auth cookie", async () => {
      const email = uniqueEmail();
      const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "secure123", name: "Me User" }),
      });

      const cookie = getCookie(registerRes);
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.email).toBe(email);
      expect(data.user.agentToken).toBeDefined();
    });
  });

  // --- POST /api/auth/logout ---
  describe("POST /api/auth/logout", () => {
    it("should return success", async () => {
      const res = await fetch(`${BASE_URL}/api/auth/logout`, { method: "POST" });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });
});
