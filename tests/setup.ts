// Test setup — minimal, no global cleanup
// Each test file handles its own cleanup in beforeEach
import { beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

beforeAll(async () => {
  // Ensure database connection works
  await prisma.$connect();
});

afterAll(async () => {
  // Final cleanup
  await prisma.upload.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.userSettings.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});
