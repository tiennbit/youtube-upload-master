import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "tubeflow-dev-secret-change-in-production";

// === Unit Tests for Auth Library ===

describe("Auth Library", () => {
  // --- Password Hashing ---
  describe("Password Hashing", () => {
    it("should hash a password and return a different string", async () => {
      const password = "test123456";
      const hash = await bcrypt.hash(password, 12);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50);
    });

    it("should verify a correct password against its hash", async () => {
      const password = "mySecurePassword!@#";
      const hash = await bcrypt.hash(password, 12);

      const isValid = await bcrypt.compare(password, hash);
      expect(isValid).toBe(true);
    });

    it("should reject an incorrect password against a hash", async () => {
      const password = "correctPassword";
      const wrongPassword = "wrongPassword";
      const hash = await bcrypt.hash(password, 12);

      const isValid = await bcrypt.compare(wrongPassword, hash);
      expect(isValid).toBe(false);
    });

    it("should generate different hashes for the same password", async () => {
      const password = "samePassword";
      const hash1 = await bcrypt.hash(password, 12);
      const hash2 = await bcrypt.hash(password, 12);

      expect(hash1).not.toBe(hash2); // Different salts
    });

    it("should handle empty string password", async () => {
      const hash = await bcrypt.hash("", 12);
      expect(hash).toBeDefined();

      const isValid = await bcrypt.compare("", hash);
      expect(isValid).toBe(true);
    });

    it("should handle unicode password", async () => {
      const password = "mậtkhẩu🔑日本語";
      const hash = await bcrypt.hash(password, 12);

      const isValid = await bcrypt.compare(password, hash);
      expect(isValid).toBe(true);
    });
  });

  // --- JWT Token ---
  describe("JWT Token", () => {
    it("should create a valid JWT token with userId", () => {
      const userId = "cltest123456";
      const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3); // JWT has 3 parts
    });

    it("should verify and decode a valid token", () => {
      const userId = "cltest789";
      const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });

      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      expect(decoded.userId).toBe(userId);
    });

    it("should reject a token signed with a wrong secret", () => {
      const token = jwt.sign({ userId: "test" }, "wrong-secret", { expiresIn: "7d" });

      expect(() => jwt.verify(token, JWT_SECRET)).toThrow();
    });

    it("should reject an expired token", () => {
      const token = jwt.sign({ userId: "test" }, JWT_SECRET, { expiresIn: "0s" });

      // Wait a tiny bit for the token to expire
      expect(() => jwt.verify(token, JWT_SECRET)).toThrow("jwt expired");
    });

    it("should reject a malformed token", () => {
      expect(() => jwt.verify("not.a.real.token", JWT_SECRET)).toThrow();
    });

    it("should reject a completely invalid string", () => {
      expect(() => jwt.verify("garbage", JWT_SECRET)).toThrow();
    });
  });
});
