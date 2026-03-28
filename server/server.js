import { WebSocketServer } from 'ws'
import { createCricketAPI } from './api-client.js'
import { PlayerManager } from './player-manager.js'
import http from 'http'

const API_KEY = process.env.CRICKET_API_KEY || null
const API_PROVIDER = process.env.CRICKET_API_PROVIDER || 'cricbuzz'
const cricketAPI = createCricketAPI(API_KEY, API_PROVIDER)

// Initialize player manager
const playerManager = new PlayerManager()

const PORT = Number(process.env.PORT || 3000)

const MATCH = {
  id: process.env.MATCH_ID || 'ipl-rcb-srh-2026',
  title: process.env.MATCH_TITLE || 'RCB vs SRH',
  teams: (process.env.MATCH_TEAMS || 'RCB,SRH').split(','),
}

const PHASE_PREDICTING = 'PREDICTING'
const PHASE_RESULT = 'RESULT'

const PREDICTION_WINDOW_MS = Number(process.env.PREDICTION_WINDOW_MS || 8000)
const RESULT_PAUSE_MS = Number(process.env.RESULT_PAUSE_MS || 1800)

const OUTCOMES = [
  { key: 'DOT', label: '0', runs: 0, wicket: false },
  { key: 'ONE', label: '1', runs: 1, wicket: false },
  { key: 'TWO', label: '2', runs: 2, wicket: false },
  { key: 'THREE', label: '3', runs: 3, wicket: false },
  { key: 'FOUR', label: '4', runs: 4, wicket: false },
  { key: 'SIX', label: '6', runs: 6, wicket: false },
  { key: 'WICKET', label: 'W', runs: 0, wicket: true },
]

function randChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function predictionMatchesOutcome(prediction, outcome) {
  if (!prediction) return false
  if (prediction === 'WICKET') return outcome.wicket === true
  if (prediction === 'DOT') return outcome.runs === 0 && !outcome.wicket
  if (prediction === 'FOUR') return outcome.runs === 4 && !outcome.wicket
  if (prediction === 'SIX') return outcome.runs === 6 && !outcome.wicket
  if (prediction === 'ONE_TWO') return (outcome.runs === 1 || outcome.runs === 2) && !outcome.wicket
  if (prediction === 'THREE_PLUS') return outcome.runs >= 3 && outcome.runs !== 4 && outcome.runs !== 6 && !outcome.wicket
  return false
}

function calcBallPoints(prediction, outcome) {
  if (!prediction) return 0
  const ok = predictionMatchesOutcome(prediction, outcome)
  if (!ok) return 0
  if (prediction === 'WICKET') return 20
  return 10
}

let nextClientId = 1

/** @type {Map<string, any>} */
const clients = new Map()

const game = {
  match: MATCH,
  runs: 0,
  wkts: 0,
  over: 0,
  ball: 0,
  phase: PHASE_PREDICTING,
  predictClosesAt: Date.now() + PREDICTION_WINDOW_MS,
  lastResult: null,
  overIndex: 0,
  overBallIndex: 0,
}

function getOverKey() {
  return `${game.over}`
}

function resetOverStateForAll() {
  for (const c of clients.values()) {
    c.overPoints = 0
    c.opponentId = null
    c.overKey = getOverKey()
    c.overResult = null
  }
}

function pairOverBattles() {
  const active = [...clients.values()].filter((c) => c.joinedMatch && c.team)
  // simple shuffle
  for (let i = active.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[active[i], active[j]] = [active[j], active[i]]
  }

  for (let i = 0; i < active.length; i += 2) {
    const a = active[i]
    const b = active[i + 1]
    if (!b) {
      a.opponentId = null
      continue
    }
    a.opponentId = b.id
    b.opponentId = a.id
  }
}

function publicStateFor(client) {
  const opp = client.opponentId ? clients.get(client.opponentId) : null

  return {
    match: game.match,
    runs: game.runs,
    wkts: game.wkts,
    over: game.over,
    ball: game.ball,
    phase: game.phase,
    predictClosesAt: game.predictClosesAt,
    lastResult: game.lastResult,
    you: {
      id: client.id,
      name: client.name,
      team: client.team,
      points: client.points,
      overPoints: client.overPoints,
      lockedPrediction: client.lockedPrediction ?? null,
      playerId: client.playerId,
      registered: client.registered,
    },
    opponent: opp
      ? {
          id: opp.id,
          name: opp.name,
          team: opp.team,
          points: opp.points,
          overPoints: opp.overPoints,
        }
      : null,
  }
}

function send(ws, msg) {
  if (ws.readyState !== 1) return
  ws.send(JSON.stringify(msg))
}

function broadcastState() {
  for (const client of clients.values()) {
    send(client.ws, { type: 'STATE', payload: publicStateFor(client) })
  }
}

function broadcastPlayerCount() {
  const activePlayers = [...clients.values()].filter(c => c.joinedMatch).length
  const totalConnected = clients.size
  
  // Count team selections
  const rcbCount = [...clients.values()].filter(c => c.team === 'RCB').length
  const srhCount = [...clients.values()].filter(c => c.team === 'SRH').length
  
  const payload = { totalConnected, activePlayers, teams: { RCB: rcbCount, SRH: srhCount } }
  for (const client of clients.values()) {
    send(client.ws, { type: 'PLAYER_COUNT', payload })
  }
}

function broadcastLeaderboard() {
  const leaderboard = playerManager.getLeaderboard()
  for (const client of clients.values()) {
    send(client.ws, { type: 'LEADERBOARD', payload: { leaderboard } })
  }
}

function endOverAndAwardBonus() {
  for (const client of clients.values()) {
    if (!client.joinedMatch || !client.team) continue
    if (!client.opponentId) continue
    const opp = clients.get(client.opponentId)
    if (!opp) continue

    // ensure only one side awards bonus
    if (client.id > opp.id) continue

    const a = client
    const b = opp

    if (a.overPoints === b.overPoints) {
      const msgA = { message: 'Over tied', bonus: 0 }
      const msgB = { message: 'Over tied', bonus: 0 }
      send(a.ws, { type: 'OVER_RESULT', payload: msgA })
      send(b.ws, { type: 'OVER_RESULT', payload: msgB })
      continue
    }

    const winner = a.overPoints > b.overPoints ? a : b
    const loser = winner === a ? b : a
    winner.points += 20

    send(winner.ws, { type: 'OVER_RESULT', payload: { message: 'You won this over', bonus: 20 } })
    send(loser.ws, { type: 'OVER_RESULT', payload: { message: 'You lost this over', bonus: 0 } })
  }
}

function advanceBall() {
  // ball increments 1..6
  game.ball += 1
  if (game.ball > 6) {
    // end of over
    endOverAndAwardBonus()
    game.over += 1
    game.ball = 1

    resetOverStateForAll()
    pairOverBattles()
  }
}

let lastKnownScore = null
let currentMatchId = null

async function pollLiveMatchData() {
  if (API_PROVIDER === 'demo') {
    return null
  }
  
  try {
    // For CricbuzzLive, we first find an IPL match, then get its score
    if (API_PROVIDER === 'cricbuzz') {
      // Find IPL match if we don't have one
      if (!currentMatchId) {
        console.log('[DEBUG] Calling fetchLiveMatches...')
        const liveMatches = await cricketAPI.fetchLiveMatches('league')
        console.log('[DEBUG] fetchLiveMatches response:', JSON.stringify(liveMatches, null, 2))
        
        if (!liveMatches?.data?.matches) {
          console.log('[DEBUG] No matches array in response')
          return null
        }
        
        // Log all matches for debugging
        console.log(`[DEBUG] Found ${liveMatches.data.matches.length} matches`)
        liveMatches.data.matches.forEach((m, i) => {
          console.log(`[DEBUG] Match ${i}: id=${m.id}, title="${m.title}", teams=${JSON.stringify(m.teams)}`)
        })
        
        // Look for IPL match
        const iplKeywords = ['ipl', 'indian premier league', 'rcb', 'csk', 'mi', 'dc', 'pbks', 'rr', 'kkr', 'srh', 'gt', 'lsg']
        const iplMatch = liveMatches.data.matches.find(m => {
          const titleLower = m.title?.toLowerCase() || ''
          const teamsMatch = m.teams?.some(t => 
            iplKeywords.some(kw => t.team?.toLowerCase().includes(kw))
          )
          const titleMatch = iplKeywords.some(kw => titleLower.includes(kw))
          return titleMatch || teamsMatch
        })
        
        if (iplMatch) {
          currentMatchId = iplMatch.id
          console.log(`[DEBUG] SELECTED IPL MATCH:`, JSON.stringify(iplMatch, null, 2))
          MATCH.id = currentMatchId
          MATCH.title = iplMatch.title
          if (iplMatch.teams && iplMatch.teams.length >= 2) {
            MATCH.teams = iplMatch.teams.map(t => t.team?.slice(0, 3).toUpperCase())
          }
        } else {
          console.log('[DEBUG] No IPL match found in the list')
          return null
        }
      }
      
      if (!currentMatchId) {
        console.log('[DEBUG] No currentMatchId set')
        return null
      }
      
      // Fetch score for current match
      console.log(`[DEBUG] Fetching score for matchId=${currentMatchId}...`)
      const scoreData = await cricketAPI.fetchMatchScore(currentMatchId)
      console.log('[DEBUG] fetchMatchScore response:', JSON.stringify(scoreData, null, 2))
      
      if (!scoreData?.data) {
        console.log('[DEBUG] No data in score response')
        return null
      }
      
      const data = scoreData.data
      const parsed = cricketAPI.parseLiveScore(data.liveScore)
      console.log('[DEBUG] Parsed score:', JSON.stringify(parsed))
      
      return {
        match_id: currentMatchId,
        title: data.title,
        update: data.update,
        score: parsed,
        raw: data
      }
    }
    
    // For other providers (CricketData, Entity Sports)
    const data = await cricketAPI.fetchMatchScore(MATCH.id)
    return data
  } catch (err) {
    console.error('[API] Error fetching match data:', err.message)
    return null
  }
}

function parseBallOutcome(commentary, score) {
  // Try to extract the actual outcome from commentary or score
  if (!commentary) return null
  
  const text = commentary.toLowerCase()
  
  // Check for wickets
  if (text.includes('wicket') || text.includes('out') || text.includes('caught') || 
      text.includes('bowled') || text.includes('lbw') || text.includes('run out')) {
    return OUTCOMES.find(o => o.key === 'WICKET')
  }
  
  // Check for six
  if (text.includes('six') || text.includes('6 runs')) {
    return OUTCOMES.find(o => o.key === 'SIX')
  }
  
  // Check for four
  if (text.includes('four') || text.includes('boundary') || text.includes('4 runs')) {
    return OUTCOMES.find(o => o.key === 'FOUR')
  }
  
  // Check for runs
  const runMatch = text.match(/(\d+)\s*run/)
  if (runMatch) {
    const runs = parseInt(runMatch[1])
    if (runs === 0) return OUTCOMES.find(o => o.key === 'DOT')
    if (runs === 1) return OUTCOMES.find(o => o.key === 'ONE')
    if (runs === 2) return OUTCOMES.find(o => o.key === 'TWO')
    if (runs === 3) return OUTCOMES.find(o => o.key === 'THREE')
  }
  
  return null
}

function simulateOutcome() {
  // In API mode, try to get real outcome from queue
  if (pendingRealOutcomes.length > 0) {
    const nextBall = pendingRealOutcomes.shift()
    if (nextBall) {
      const outcome = parseBallOutcome(nextBall.commentary, nextBall) || 
        OUTCOMES.find(o => o.key === nextBall.key)
      if (outcome) return outcome
    }
  }
  
  // Fallback to simulation
  const bag = ['DOT','DOT','ONE','ONE','TWO','TWO','THREE','FOUR','SIX','WICKET']
  const key = randChoice(bag)
  return OUTCOMES.find((o) => o.key === key) ?? OUTCOMES[0]
}

function resolveBall() {
  const outcome = simulateOutcome()
  if (outcome.wicket) game.wkts += 1
  game.runs += outcome.runs
  game.lastResult = { key: outcome.key, label: outcome.label, runs: outcome.runs, wicket: outcome.wicket }

  for (const client of clients.values()) {
    if (!client.joinedMatch || !client.team) continue
    const pts = calcBallPoints(client.lockedPrediction, outcome)
    client.points += pts
    client.overPoints += pts

    if (pts > 0) client.streak = (client.streak ?? 0) + 1
    else client.streak = 0
    
    // Update player stats in player manager
    if (client.playerId) {
      const correct = pts > 0
      const lastPred = client.lastPredictionId
      if (lastPred) {
        playerManager.recordPredictionResult(client.playerId, lastPred, correct, pts)
      }
    }
  }

  // next ball
  advanceBall()
  for (const client of clients.values()) {
    client.lockedPrediction = null
    client.lastPredictionId = null
  }
  
  // Broadcast updated leaderboard after each ball
  broadcastLeaderboard()
}

function openPredictionWindow() {
  game.phase = PHASE_PREDICTING
  game.predictClosesAt = Date.now() + PREDICTION_WINDOW_MS
  broadcastState()

  setTimeout(() => {
    // lock & resolve
    game.phase = PHASE_RESULT
    broadcastState()

    setTimeout(() => {
      resolveBall()
      openPredictionWindow()
    }, RESULT_PAUSE_MS)
  }, PREDICTION_WINDOW_MS)
}

// API polling loop - fetches real match data every 10 seconds
let apiPollInterval = null
let pendingRealOutcomes = []

function startAPIPolling() {
  if (API_PROVIDER === 'demo') {
    console.log('[API] Running in demo mode - set CRICKET_API_PROVIDER=cricbuzz for real data')
    return
  }
  
  console.log(`[API] Starting live match polling with provider: ${API_PROVIDER}...`)
  
  apiPollInterval = setInterval(async () => {
    const data = await pollLiveMatchData()
    if (data && data.score) {
      const score = data.score
      
      // Check if ball has changed
      const ballChanged = !lastKnownScore || 
        lastKnownScore.over !== score.over || 
        lastKnownScore.ball !== score.ball
      
      if (ballChanged && lastKnownScore) {
        // Ball changed - detect what happened
        const runDiff = score.runs - (lastKnownScore.runs || 0)
        const wicketDiff = score.wickets - (lastKnownScore.wickets || 0)
        
        let outcomeKey = 'DOT'
        if (wicketDiff > 0) outcomeKey = 'WICKET'
        else if (runDiff === 1) outcomeKey = 'ONE'
        else if (runDiff === 2) outcomeKey = 'TWO'
        else if (runDiff === 3) outcomeKey = 'THREE'
        else if (runDiff === 4) outcomeKey = 'FOUR'
        else if (runDiff === 6) outcomeKey = 'SIX'
        
        // Queue the real outcome
        pendingRealOutcomes.push({
          key: outcomeKey,
          runs: runDiff,
          wicket: wicketDiff > 0,
          commentary: data.update || `${outcomeKey} on ball ${score.over}.${score.ball}`
        })
        
        console.log(`[API] Ball outcome detected: ${outcomeKey} (${score.over}.${score.ball})`)
      }
      
      // Update game state with real match data
      game.runs = score.runs
      game.wkts = score.wickets
      game.over = score.over
      game.ball = score.ball
      
      lastKnownScore = { ...score }
      
      // Broadcast updated state to all clients
      broadcastState()
    }
  }, 5000) // Poll every 5 seconds for more responsive updates
}

function stopAPIPolling() {
  if (apiPollInterval) {
    clearInterval(apiPollInterval)
    apiPollInterval = null
  }
}
// initialize ball to 0 so UI shows over.0 initially
openPredictionWindow()

// Start API polling for live match data
startAPIPolling()

// HTTP + WebSocket on same server

async function handleAPIRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }
  
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ 
      status: 'ok', 
      mode: API_PROVIDER,
      match: MATCH.title,
      matchId: currentMatchId,
      connectedClients: clients.size 
    }))
    return
  }
  
  if (req.url === '/api/match') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      match: MATCH,
      game: {
        runs: game.runs,
        wickets: game.wkts,
        over: game.over,
        ball: game.ball,
        phase: game.phase
      },
      clients: clients.size
    }))
    return
  }
  
  if (req.url === '/api/next-ball' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        if (data.outcome) {
          pendingRealOutcomes.push({
            key: data.outcome,
            runs: data.runs || 0,
            wicket: data.wicket || false,
            commentary: data.commentary
          })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ queued: true, queueLength: pendingRealOutcomes.length }))
        } else {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Missing outcome' }))
        }
      } catch {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    })
    return
  }
  
  if (req.url === '/api/players/register' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const result = playerManager.registerPlayer(data.username, data.password, data.name)
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch {
        res.writeHead(400)
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }))
      }
    })
    return
  }

  if (req.url === '/api/players/login' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const result = playerManager.loginPlayer(data.username, data.password)
        res.writeHead(result.success ? 200 : 401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch {
        res.writeHead(400)
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }))
      }
    })
    return
  }

  if (req.url === '/api/players/leaderboard' && req.method === 'GET') {
    const leaderboard = playerManager.getLeaderboard()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ leaderboard }))
    return
  }

  if (req.url === '/api/players/profile' && req.method === 'GET') {
    const playerId = parseInt(req.headers['x-player-id'])
    if (!playerId) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: 'Player ID required' }))
      return
    }
    const player = playerManager.getPlayer(playerId)
    if (!player) {
      res.writeHead(404)
      res.end(JSON.stringify({ error: 'Player not found' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ player }))
    return
  }

  if (req.url === '/api/players/history' && req.method === 'GET') {
    const playerId = parseInt(req.headers['x-player-id'])
    if (!playerId) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: 'Player ID required' }))
      return
    }
    const history = playerManager.getPlayerHistory(playerId)
    if (!history) {
      res.writeHead(404)
      res.end(JSON.stringify({ error: 'Player not found' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(history))
    return
  }
  
  res.writeHead(404)
  res.end('Not found')
}

const httpServer = http.createServer(handleAPIRequest)
const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws) => {
  const id = String(nextClientId++)
  const client = {
    id,
    ws,
    name: `Player${id}`,
    playerId: null,
    registered: false,
    joinedMatch: false,
    team: null,
    points: 0,
    overPoints: 0,
    lockedPrediction: null,
    lastPredictionId: null,
    opponentId: null,
    streak: 0
  }

  clients.set(id, client)

  send(ws, { type: 'STATE', payload: publicStateFor(client) })
  broadcastPlayerCount()

  ws.on('message', (buf) => {
    let msg
    try {
      msg = JSON.parse(buf.toString())
    } catch (err) {
      console.log('[Server] Failed to parse message:', buf.toString(), err.message)
      return
    }
    
    console.log(`[Server] Received message type: ${msg.type}`)

    if (msg.type === 'JOIN') {
      const name = String(msg.payload?.name || client.name).slice(0, 18)
      client.name = name
      
      // Check if player exists, if not create guest player
      let player = playerManager.getPlayerByName(name)
      if (!player) {
        player = playerManager.createPlayer(name)
        console.log(`[Player] Created new player: ${name} (ID: ${player.id})`)
      }
      client.playerId = player.id
      client.registered = player.registered
      
      send(ws, { type: 'STATE', payload: publicStateFor(client) })
      return
    }

    if (msg.type === 'REGISTER') {
      console.log('[Server] Processing REGISTER:', msg.payload)
      const { username, password, name } = msg.payload || {}
      if (!username || !password || !name) {
        console.log('[Server] REGISTER failed - missing fields:', { username: !!username, password: !!password, name: !!name })
        send(ws, { type: 'ERROR', payload: { message: 'Username, password, and display name required' } })
        return
      }
      
      const result = playerManager.registerPlayer(username, password, name)
      console.log('[Server] Register result:', result.success ? 'success' : result.error)
      if (result.success) {
        client.playerId = result.player.id
        client.name = result.player.name
        client.registered = true
        send(ws, { type: 'REGISTERED', payload: { player: result.player } })
        broadcastLeaderboard()
      } else {
        send(ws, { type: 'ERROR', payload: { message: result.error } })
      }
      return
    }

    if (msg.type === 'LOGIN') {
      const { username, password } = msg.payload || {}
      if (!username || !password) {
        send(ws, { type: 'ERROR', payload: { message: 'Username and password required' } })
        return
      }
      
      const result = playerManager.loginPlayer(username, password)
      if (result.success) {
        client.playerId = result.player.id
        client.name = result.player.name
        client.registered = true
        client.points = result.player.stats.totalPoints
        send(ws, { type: 'LOGGED_IN', payload: { player: result.player } })
        broadcastState()
        broadcastLeaderboard()
      } else {
        send(ws, { type: 'ERROR', payload: { message: result.error } })
      }
      return
    }

    if (msg.type === 'GET_PROFILE') {
      const player = client.playerId ? playerManager.getPlayer(client.playerId) : null
      if (player) {
        send(ws, { type: 'PROFILE', payload: { player } })
      } else {
        send(ws, { type: 'ERROR', payload: { message: 'Player not found' } })
      }
      return
    }

    if (msg.type === 'GET_LEADERBOARD') {
      const leaderboard = playerManager.getLeaderboard()
      send(ws, { type: 'LEADERBOARD', payload: { leaderboard } })
      return
    }

    if (msg.type === 'JOIN_MATCH') {
      client.joinedMatch = true
      // if joining mid-over, still participate starting now
      send(ws, { type: 'STATE', payload: publicStateFor(client) })
      broadcastPlayerCount()
      return
    }

    if (msg.type === 'SELECT_TEAM') {
      const t = msg.payload?.team
      if (t !== 'RCB' && t !== 'SRH') return
      client.team = t

      // if this is the first time client becomes active, re-pair (simple MVP)
      resetOverStateForAll()
      pairOverBattles()
      broadcastState()
      broadcastPlayerCount()
      return
    }

    if (msg.type === 'PREDICT') {
      if (game.phase !== PHASE_PREDICTING) return
      if (Date.now() > game.predictClosesAt) return
      const p = msg.payload?.prediction
      const allowed = new Set(['DOT', 'ONE_TWO', 'THREE_PLUS', 'FOUR', 'SIX', 'WICKET'])
      if (!allowed.has(p)) return
      client.lockedPrediction = p
      
      // Record prediction for player stats
      if (client.playerId) {
        const predictionId = playerManager.recordPrediction(client.playerId, {
          over: game.over,
          ball: game.ball,
          prediction: p,
          timestamp: Date.now()
        })
        client.lastPredictionId = predictionId
      }
      
      send(ws, { type: 'STATE', payload: publicStateFor(client) })
      return
    }
  })

  ws.on('close', () => {
    clients.delete(id)
    // clean dangling opponent ids
    for (const c of clients.values()) {
      if (c.opponentId === id) c.opponentId = null
    }
    broadcastState()
    broadcastPlayerCount()
  })
})

httpServer.listen(PORT, () => {
  console.log(`[IPL Ball Battle] Server running on port ${PORT}`)
  console.log(`[WebSocket] ws://localhost:${PORT}`)
  console.log(`[HTTP API] http://localhost:${PORT}/api/health`)
})
