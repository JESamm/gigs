# GigConnect — Deployment Guide

## Quick Start (Local Development)

```bash
git clone <your-repo-url>
cd GIGS
npm install
cp .env.example .env   # then edit .env with your values
node server.js          # or: npm run dev
```

Visit `http://localhost:3000`

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | `development` or `production` |
| `PORT` | No | Server port (default: 3000) |
| `JWT_SECRET` | **Yes** | Random 64+ char secret for JWT signing |
| `BASE_URL` | Yes | Your domain, e.g. `https://gigconnect.com` |
| `CORS_ORIGIN` | No | Allowed origins (default: `*`) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth app client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth app secret |
| `GITHUB_CLIENT_ID` | No | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth app secret |
| `SMTP_HOST` | No | Email SMTP host (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | No | SMTP port (default: 587) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password / app password |
| `SMTP_FROM` | No | From address for emails |

> **Important:** Generate a strong `JWT_SECRET` for production:
> ```bash
> node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
> ```

---

## Deploy to Render (Recommended — Free Tier)

1. Push code to GitHub
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Add all environment variables from the table above
6. Set `BASE_URL` to your Render URL (e.g. `https://gigconnect.onrender.com`)
7. Update OAuth callback URLs in Google/GitHub to match

### Render Disk (Persistent DB)
Render's free tier doesn't persist files across deploys. To keep your database:
- **Add a Disk** in Render dashboard → mount at `/data`
- Set env var: Update `database.js` or set `DB_PATH=/data/gigconnect.db`

---

## Deploy to Railway

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub**
3. Add environment variables in the Railway dashboard
4. Railway auto-detects Node.js and runs `npm start`

---

## Deploy to Heroku

```bash
heroku create gigconnect
heroku config:set JWT_SECRET=your-secret NODE_ENV=production BASE_URL=https://gigconnect.herokuapp.com
git push heroku main
```

> Note: Heroku has an ephemeral filesystem. Use a Postgres addon for production data persistence.

---

## Deploy to VPS (DigitalOcean, EC2, etc.)

```bash
# On your server:
git clone <repo> /opt/gigconnect
cd /opt/gigconnect
npm install --production
cp .env.example .env && nano .env  # configure

# Run with PM2 (process manager)
npm install -g pm2
pm2 start server.js --name gigconnect
pm2 save
pm2 startup
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Add SSL with: `sudo certbot --nginx -d your-domain.com`

---

## OAuth Setup for Production

### Google
1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Update **Authorized redirect URI** to: `https://your-domain.com/api/auth/google/callback`
3. Publish the OAuth consent screen (to allow all users, not just test accounts)

### GitHub
1. [GitHub Developer Settings](https://github.com/settings/developers)
2. Update **Authorization callback URL** to: `https://your-domain.com/api/auth/github/callback`

---

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Generate and set a strong `JWT_SECRET`
- [ ] Set `BASE_URL` to your actual domain
- [ ] Configure real SMTP credentials for email
- [ ] Update OAuth callback URLs to production domain
- [ ] Set up persistent storage for `gigconnect.db`
- [ ] Set up persistent storage for `public/uploads/avatars/`
- [ ] Enable HTTPS (SSL/TLS)
- [ ] Set `CORS_ORIGIN` to your domain (not `*`)
- [ ] Test health endpoint: `GET /api/health`

---

## Architecture

```
GIGS/
├── server.js           # Express entry point
├── database.js         # sql.js database layer
├── .env                # Environment secrets (not in git)
├── .env.example        # Template for env vars
├── config/
│   └── passport.js     # OAuth strategies
├── middleware/
│   └── auth.js         # JWT authentication
├── routes/
│   ├── auth.js         # Auth + OAuth + 2FA
│   ├── gigs.js         # Gig CRUD
│   ├── applications.js # Apply to gigs
│   ├── payments.js     # Payment tracking
│   ├── users.js        # Profiles + photos
│   ├── notifications.js
│   ├── dashboard.js    # Stats
│   └── chat.js         # Messaging
├── utils/
│   └── mailer.js       # Email sending
└── public/             # Frontend SPA
    ├── index.html
    ├── css/styles.css
    ├── js/app.js
    └── uploads/avatars/
```

## Tech Stack

- **Backend:** Node.js, Express, sql.js (SQLite)
- **Auth:** JWT, Passport.js (Google/GitHub OAuth), speakeasy (2FA)
- **Frontend:** Vanilla JS SPA, CSS custom properties, dark theme
- **Email:** Nodemailer
- **Security:** Helmet, express-rate-limit, compression
