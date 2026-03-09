# GigConnect

A full-stack student gig marketplace built with Node.js, Express, and vanilla JavaScript. Employers post gigs, students apply, and payments are tracked — all in one platform.

**Live:** [gigconnect-d2wx.onrender.com](https://gigconnect-d2wx.onrender.com)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Server** | Node.js + Express |
| **Database** | sql.js (SQLite in-process, no native binaries) |
| **Auth** | JWT (7-day tokens), bcryptjs, Passport.js (Google/GitHub OAuth), speakeasy (TOTP 2FA) |
| **Frontend** | Vanilla JS single-page app, CSS custom properties, dark theme |
| **Security** | Helmet, express-rate-limit (100 req/min global, 10 auth/15min) |
| **Email** | Nodemailer (Ethereal in dev, configurable SMTP for production) |
| **File Uploads** | Multer (profile photos, 5MB max) |

---

## Project Structure

```
GIGS/
├── server.js              # Express entry point — middleware, routes, graceful shutdown
├── database.js            # sql.js wrapper with better-sqlite3-compatible API, atomic writes
├── render.yaml            # Render deployment blueprint
├── .env / .env.example    # Environment variables
│
├── config/
│   └── passport.js        # Google & GitHub OAuth strategy configuration
├── middleware/
│   └── auth.js            # JWT authentication + role-based access (authenticate, requireRole)
├── routes/
│   ├── auth.js            # Register, login, OAuth callbacks, 2FA setup/verify/disable
│   ├── gigs.js            # CRUD for gig postings (with search, filters, pagination)
│   ├── applications.js    # Apply, accept/reject, withdraw applications
│   ├── payments.js        # Payment tracking + release + reviews
│   ├── users.js           # Profile updates, photo upload, public profiles
│   ├── notifications.js   # In-app notification feed + mark-read
│   ├── dashboard.js       # Public stats + role-specific dashboard data
│   └── chat.js            # Conversations + messaging between users
├── utils/
│   └── mailer.js          # Email transport (welcome emails, login alerts)
│
└── public/                # Frontend SPA (served as static files)
    ├── index.html         # Single HTML file with ~18 page sections + modals
    ├── css/styles.css     # All styles including dark theme
    ├── js/app.js          # Client-side routing, auth, API calls, UI logic
    └── uploads/avatars/   # User profile photos
```

---

## How It Works

### Backend Flow

1. **`server.js`** initializes the database (`database.js`), configures middleware (Helmet, rate limiting, CORS, body parsing), sets up Passport OAuth, mounts all `/api/*` routes, and serves the `public/` folder as static files.

2. **`database.js`** uses `sql.js` (pure-JS SQLite) with a `DbWrapper` class that provides a `better-sqlite3`-compatible API (`.prepare().run()`, `.get()`, `.all()`). Every write atomically saves the database to disk (write to `.tmp` file, then rename).

3. **Authentication** uses JWT tokens stored client-side. Protected routes go through `authenticate` middleware which decodes the token and sets `req.user`. Role checks use `requireRole('employer')` or `requireRole('student')`.

4. **OAuth** (Google/GitHub) goes through Passport.js strategies → callback handler finds or creates the user → issues a JWT → redirects to `/#/oauth-callback?token=...`.

### Frontend Flow

1. **`index.html`** is a single-page app with every page as a `<div id="page-name" class="page">`. Only one is visible at a time.

2. **`app.js`** uses hash-based routing (`#/home`, `#/gigs`, `#/dashboard`, etc.). The `routeFromHash()` function reads `window.location.hash` and shows the corresponding page div.

3. **API calls** go to `/api/*` endpoints. Authenticated requests include `Authorization: Bearer <token>` headers. Responses update the DOM directly (no framework).

4. **Theme** is toggled via `data-theme="dark"` on `<html>`, with CSS custom properties switching all colors.

---

## Database Schema (10 Tables)

| Table | Purpose |
|-------|---------|
| **users** | Core accounts — email, hashed password, role (employer/student), name, avatar, OAuth & 2FA fields |
| **employer_profiles** | Company name, description, industry, website, location, verified flag |
| **student_profiles** | School, major, graduation year, GPA, bio, skills, resume/portfolio URLs, earnings |
| **gigs** | Job postings — title, description, category, skills, pay, location type, status, deadline |
| **applications** | Student applications to gigs — cover letter, proposed amount, status |
| **payments** | Payment records — amount, status (pending/completed/failed/refunded), transaction ref |
| **reviews** | Post-gig ratings (1–5) and comments between users |
| **notifications** | In-app alerts — title, message, type, read flag |
| **conversations** | Chat threads between employer ↔ student (optionally linked to a gig) |
| **messages** | Individual chat messages within a conversation |

---

## API Reference (35 Endpoints)

### Auth — `/api/auth`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/register` | Create account (student or employer) | No |
| POST | `/login` | Login with email/password (supports 2FA) | No |
| GET | `/me` | Get current user's profile | Yes |
| GET | `/google` | Initiate Google OAuth | No |
| GET | `/google/callback` | Google OAuth callback | No |
| GET | `/github` | Initiate GitHub OAuth | No |
| GET | `/github/callback` | GitHub OAuth callback | No |
| GET | `/providers` | Check which OAuth providers are configured | No |
| POST | `/2fa/setup` | Generate 2FA secret + QR code | Yes |
| POST | `/2fa/verify` | Verify code and enable 2FA | Yes |
| POST | `/2fa/disable` | Disable 2FA (requires current code) | Yes |

### Gigs — `/api/gigs`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | List gigs (supports `?search`, `?category`, `?location_type`, pagination) | No |
| GET | `/:id` | Get single gig details | No |
| POST | `/` | Create a new gig | Employer |
| PUT | `/:id` | Update own gig | Employer |
| DELETE | `/:id` | Delete own gig | Employer |

### Applications — `/api/applications`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/` | Apply for a gig | Student |
| GET | `/gig/:gigId` | Get applications for a specific gig | Employer |
| GET | `/my` | Get current student's applications | Student |
| PUT | `/:id/status` | Accept or reject an application | Employer |
| PUT | `/:id/withdraw` | Withdraw a pending application | Student |

### Payments — `/api/payments`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/release/:paymentId` | Release payment (mark gig complete) | Employer |
| GET | `/employer` | Employer's payment history | Employer |
| GET | `/student` | Student's payment/earnings history | Student |
| POST | `/review` | Submit a review after payment | Yes |

### Users — `/api/users`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| PUT | `/profile` | Update profile (fields vary by role) | Yes |
| POST | `/photo` | Upload profile photo (max 5MB) | Yes |
| DELETE | `/photo` | Delete profile photo | Yes |
| GET | `/:id` | Public user profile + reviews + avg rating | No |

### Notifications — `/api/notifications`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | Get notifications (up to 50) + unread count | Yes |
| PUT | `/read/:id` | Mark one notification as read | Yes |
| PUT | `/read-all` | Mark all notifications as read | Yes |

### Dashboard — `/api/dashboard`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/public-stats` | Platform stats (open gigs, user counts) | No |
| GET | `/stats` | Role-specific dashboard (earnings, applicants, etc.) | Yes |

### Chat — `/api/chat`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/conversations` | Start or get existing conversation | Yes |
| GET | `/conversations` | List all conversations + unread counts | Yes |
| GET | `/conversations/:id/messages` | Get messages (marks as read) | Yes |
| POST | `/conversations/:id/messages` | Send a message | Yes |
| GET | `/unread-count` | Total unread message count | Yes |

### Health Check

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/health` | Server status, uptime, environment | No |

---

## Quick Start (Local)

```bash
git clone https://github.com/JESamm/gigs.git
cd gigs
npm install
cp .env.example .env   # edit with your values
node server.js
```

Visit `http://localhost:3000`

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | **Yes** | Random 64+ char secret (auto-generated if missing, but resets on restart) |
| `NODE_ENV` | Yes | `development` or `production` |
| `PORT` | No | Server port (default: 3000) |
| `BASE_URL` | Yes | Your domain, e.g. `https://gigconnect-d2wx.onrender.com` |
| `CORS_ORIGIN` | No | Allowed origins (default: `*`) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth secret |
| `GITHUB_CLIENT_ID` | No | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth secret |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | No | SMTP config for email |

Generate a JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Deployment (Render)

The app is deployed on Render at [gigconnect-d2wx.onrender.com](https://gigconnect-d2wx.onrender.com).

1. Push code to GitHub
2. [render.com](https://render.com) → **New → Web Service** → connect your repo
3. Build Command: `npm install` | Start Command: `node server.js`
4. Add environment variables (`JWT_SECRET`, `BASE_URL`, OAuth keys)
5. For persistent data, add a **Disk** mounted at `/data`

The `render.yaml` blueprint in the repo automates this setup.

---

## License

MIT
