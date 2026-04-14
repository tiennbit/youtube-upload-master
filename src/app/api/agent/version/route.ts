import { NextResponse } from "next/server";

const AGENT_VERSION = "1.0.0";

// GET /api/agent/version — Agent checks for updates
export async function GET() {
  return NextResponse.json({
    latestVersion: AGENT_VERSION,
    releaseNotes: "Initial release — YouTube upload automation agent",
    downloadUrl: null, // Will be set when installer is available
  });
}
