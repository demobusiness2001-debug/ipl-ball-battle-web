# API Integration Guide

The app now supports real cricket match data via API integration.

## Current Status

**Demo Mode**: The app is currently running in demo mode with simulated ball outcomes.

## Available APIs

### 1. CricketData.org (Recommended - Free Tier)
- Website: https://cricketdata.org
- Free tier: 100,000 requests/hour
- Sign up to get an API key

### 2. Entity Sports
- Website: https://entitysport.com
- Offers IPL live scores API
- Paid plans available

### 3. CricAPI
- Website: https://www.cricapi.com
- Now redirects to cricketdata.org

## Setup Instructions

1. Copy `.env.example` to `.env`:
   ```
   copy .env.example .env
   ```

2. Get an API key from [cricketdata.org](https://cricketdata.org)

3. Edit `.env` and add your API key:
   ```
   CRICKET_API_KEY=your_actual_api_key
   CRICKET_API_PROVIDER=cricketdata
   ```

4. Restart the server

## API Endpoints (Local)

The server exposes HTTP endpoints for monitoring and manual control:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `http://localhost:8081/api/health` | GET | Server status and mode |
| `http://localhost:8081/api/match` | GET | Current match state |
| `http://localhost:8081/api/next-ball` | POST | Manually queue a ball outcome |

### Manual Ball Outcome (for testing/webhooks)

```bash
curl -X POST http://localhost:8081/api/next-ball \
  -H "Content-Type: application/json" \
  -d '{"outcome": "SIX", "runs": 6, "wicket": false}'
```

Valid outcomes: `DOT`, `ONE`, `TWO`, `THREE`, `FOUR`, `SIX`, `WICKET`

## How It Works

1. **With API Key**: Server polls live match data every 10 seconds
2. **Ball Resolution**: When a ball completes, server uses real outcome if available
3. **Fallback**: If no real data, falls back to simulation

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CRICKET_API_KEY` | `null` | Your API key |
| `CRICKET_API_PROVIDER` | `demo` | Provider name |
| `MATCH_ID` | `ipl-rcb-srh-2026` | Match identifier |
| `MATCH_TITLE` | `RCB vs SRH` | Display title |
| `PORT` | `8080` | WebSocket port |
