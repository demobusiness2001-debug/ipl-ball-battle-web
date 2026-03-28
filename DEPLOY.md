# Deployment Guide - Render + Vercel

## Architecture
- **Backend (WebSocket Server)**: Deployed to Render
- **Frontend (React App)**: Deployed to Vercel

---

## Step 1: Deploy Backend to Render

1. Go to https://render.com and create a free account
2. Click "New" → "Web Service"
3. Connect your GitHub repo
4. Configure:
   - **Name**: `ipl-ball-battle-server`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server/server.js`
   - **Plan**: Free

5. Add Environment Variables in Render Dashboard:
   ```
   NODE_ENV=production
   PORT=8080
   CRICKET_API_PROVIDER=cricbuzz
   MATCH_ID=ipl-demo
   MATCH_TITLE=RCB vs SRH
   MATCH_TEAMS=RCB,SRH
   PREDICTION_WINDOW_MS=8000
   RESULT_PAUSE_MS=1800
   ```

6. Click "Create Web Service"
7. Wait for deployment and copy your Render URL (e.g., `https://ipl-ball-battle-server.onrender.com`)

---

## Step 2: Update Vercel Config

Edit `vercel.json` and replace the placeholder URLs with your actual Render URL:

```json
{
  "env": {
    "VITE_WS_URL": "wss://your-actual-render-url.onrender.com",
    "VITE_API_URL": "https://your-actual-render-url.onrender.com:8081"
  }
}
```

---

## Step 3: Deploy Frontend to Vercel

### Option A: Vercel CLI (Recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

### Option B: GitHub Integration
1. Push code to GitHub
2. Go to https://vercel.com and create account
3. Click "Add New Project"
4. Import your GitHub repo
5. Configure:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
6. Add Environment Variables:
   - `VITE_WS_URL` = `wss://your-render-url.onrender.com`
7. Click "Deploy"

---

## Local Development

```bash
# Terminal 1 - Start server
npm run dev:server

# Terminal 2 - Start frontend
npm run dev:web
```

Frontend will connect to `ws://localhost:8080` automatically.

---

## Troubleshooting

### WebSocket Connection Failed
- Check that `VITE_WS_URL` in Vercel matches your Render URL
- Ensure Render service is running (free tier sleeps after inactivity)
- Verify CORS is enabled on backend (already configured in `server.js`)

### Build Errors
- Make sure `dist/` folder is in `.gitignore`
- Check that all dependencies are in `package.json`

### Port Issues on Render
- Render uses the `PORT` env variable automatically
- Both WebSocket (8080) and HTTP API (8081) run on the same host
