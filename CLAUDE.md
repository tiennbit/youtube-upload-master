# TubeFlow — YouTube Upload Automation Platform

@AGENTS.md

## Project Overview

TubeFlow là nền tảng tự động hóa upload video YouTube, gồm 2 phần:
- **Web Dashboard** (Next.js 16 + React 19 + PostgreSQL) — quản lý channels, uploads, settings
- **Desktop Agent** (`agent/`) — CLI chạy trên máy user, thực hiện upload qua GoLogin + Puppeteer

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, CSS Modules + global CSS (dark glassmorphism, KHÔNG dùng Tailwind)
- **Backend**: Next.js API Routes, Prisma ORM, PostgreSQL
- **Auth**: JWT + httpOnly cookie (`tubeflow_token`), bcryptjs
- **Icons**: lucide-react
- **Agent**: TypeScript + Node.js, puppeteer-core, gologin SDK, axios
- **Testing**: Vitest (unit + integration)
- **Language**: UI tiếng Việt

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout (lang="vi")
│   ├── page.tsx                # Redirect → /dashboard hoặc /login
│   ├── globals.css             # Design system (dark glassmorphism)
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx          # Sidebar + auth check
│   │   ├── dashboard.module.css
│   │   └── dashboard/
│   │       ├── page.tsx        # Stats overview
│   │       ├── channels/page.tsx
│   │       ├── uploads/page.tsx
│   │       ├── settings/page.tsx
│   │       └── agent/page.tsx
│   └── api/
│       ├── auth/               # register, login, logout, me
│       ├── channels/           # CRUD + [id]
│       ├── uploads/            # list, [id] delete, [id]/retry
│       ├── settings/           # GET/PUT user settings
│       ├── stats/              # Dashboard stats
│       ├── gologin/            # profiles list, start/stop profile
│       ├── nextcloud/          # test connection (WebDAV PROPFIND)
│       └── agent/              # jobs, report, heartbeat, version, scan-jobs, check-login, open-profile, channels
├── lib/
│   ├── prisma.ts               # Prisma client singleton
│   └── auth.ts                 # JWT, bcrypt, cookie helpers
prisma/
├── schema.prisma               # 4 models: User, UserSettings, Channel, Upload
agent/
├── src/
│   ├── index.ts                # Main polling loop
│   ├── config.ts               # ~/.tubeflow/config.json
│   ├── api-client.ts           # HTTP client to server
│   └── services/
│       ├── gologin.service.ts  # GoLogin profile management
│       ├── downloader.service.ts # Nextcloud WebDAV download
│       ├── scanner.service.ts  # Nextcloud folder scanner (metadata-first)
│       └── youtube.service.ts  # YouTube Studio UI automation (Puppeteer + CDP)
tests/
├── setup.ts
├── unit/                       # auth.test.ts, database.test.ts
└── integration/                # auth-api, channels-api, agent-api
```

## Database Models (Prisma)

- **User**: email (unique), passwordHash, agentToken (unique, auto-generated)
- **UserSettings**: 1:1 with User — gologinToken, nextcloud credentials, auto-upload config, agent heartbeat fields
- **Channel**: belongs to User — name (unique per user), gologinProfileId, nextcloudFolder, upload schedule (startHour/endHour/interval), uploadEnabled, isLoggedIn
- **Upload**: belongs to Channel — title, status (PENDING→UPLOADING→DONE/FAILED), remoteVideoPath, remoteThumbnailPath, error

## Key Patterns

### Authentication
- Web users: JWT in httpOnly cookie `tubeflow_token`, verified via `getCurrentUserId()`
- Agent: Bearer token in `Authorization` header, matched against `User.agentToken`
- Some agent endpoints support BOTH auth methods (cookie or bearer)

### Agent Communication
- Agent polls `GET /api/agent/jobs` every 30s → server returns next PENDING upload, marks it UPLOADING
- Agent reports result via `POST /api/agent/report` (DONE/FAILED)
- Agent sends heartbeat via `POST /api/agent/heartbeat` (version, status, activeUploads)
- Special jobs prefixed `__CHECK_LOGIN__` and `__OPEN_PROFILE__` bypass time windows

### Nextcloud Integration
- Videos stored in structured folders: `{channelFolder}/metadata/`, `/thumbnails/`, `/videos/`
- Scanner reads metadata JSON first, maps to video/thumbnail by base name
- Fallback: scan video files directly if no metadata folder
- Files deleted from Nextcloud BEFORE upload (to free storage and prevent duplicates)

### Upload Flow
1. Agent scans Nextcloud → creates PENDING jobs via `POST /api/agent/scan-jobs`
2. Agent polls for jobs → gets next PENDING within upload time window
3. Re-scans Nextcloud to pick freshest video
4. Downloads video from Nextcloud (WebDAV)
5. Deletes source files on Nextcloud
6. Opens GoLogin profile (anti-detect browser)
7. Navigates YouTube Studio → uploads via Puppeteer UI automation (CDP for file inputs)
8. Handles monetization, ad suitability, visibility steps
9. Reports DONE/FAILED to server

## Commands

```bash
npm run dev          # Start Next.js dev server
npm run build        # Build for production
npm run start        # Start production server
npm run test         # Run Vitest tests
npm run lint         # ESLint

# Agent (from agent/ directory)
npm install          # Install agent dependencies
npm run build        # Compile TypeScript
npm run start        # Run agent
```

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — JWT signing secret (default: dev secret)

## Conventions

- UI text in Vietnamese
- CSS: custom design system in globals.css (CSS variables, NO Tailwind)
- CSS Modules for layout (dashboard.module.css)
- API responses in Vietnamese for user-facing errors
- All API routes check auth and return 401 if unauthorized
- Prisma params use `Promise<{ id: string }>` pattern for dynamic route params (Next.js 16)
- Agent token auth: `request.headers.get("authorization")` → `Bearer <token>`
