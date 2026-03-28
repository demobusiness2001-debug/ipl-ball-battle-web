import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLAYERS_FILE = path.join(__dirname, '..', 'data', 'players.json')

// Ensure data directory exists
const dataDir = path.dirname(PLAYERS_FILE)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

export class PlayerManager {
  constructor() {
    this.players = new Map()
    this.usernames = new Map() // username -> playerId
    this.nextPlayerId = 1
    this.loadPlayers()
  }

  loadPlayers() {
    try {
      if (fs.existsSync(PLAYERS_FILE)) {
        const data = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'))
        for (const player of data.players || []) {
          this.players.set(player.id, player)
          if (player.username) {
            this.usernames.set(player.username, player.id)
          }
          this.nextPlayerId = Math.max(this.nextPlayerId, player.id + 1)
        }
        console.log(`[PlayerManager] Loaded ${this.players.size} players`)
      }
    } catch (err) {
      console.error('[PlayerManager] Error loading players:', err.message)
    }
  }

  savePlayers() {
    try {
      const data = {
        players: Array.from(this.players.values()),
        lastSaved: new Date().toISOString()
      }
      fs.writeFileSync(PLAYERS_FILE, JSON.stringify(data, null, 2))
    } catch (err) {
      console.error('[PlayerManager] Error saving players:', err.message)
    }
  }

  createPlayer(name, username = null, password = null) {
    const id = this.nextPlayerId++
    const player = {
      id,
      name,
      username: username || null,
      password: password || null,
      registered: !!username,
      createdAt: Date.now(),
      stats: {
        totalPoints: 0,
        correctPredictions: 0,
        totalPredictions: 0,
        matchesPlayed: 0,
        oversWon: 0,
        streak: 0,
        bestStreak: 0
      },
      predictionHistory: []
    }
    
    this.players.set(id, player)
    if (username) {
      this.usernames.set(username, id)
    }
    this.savePlayers()
    return player
  }

  registerPlayer(username, password, name) {
    if (this.usernames.has(username)) {
      return { success: false, error: 'Username already exists' }
    }
    
    const player = this.createPlayer(name, username, password)
    return { success: true, player: this.sanitizePlayer(player) }
  }

  loginPlayer(username, password) {
    const playerId = this.usernames.get(username)
    if (!playerId) {
      return { success: false, error: 'Invalid username or password' }
    }
    
    const player = this.players.get(playerId)
    if (!player || player.password !== password) {
      return { success: false, error: 'Invalid username or password' }
    }
    
    return { success: true, player: this.sanitizePlayer(player) }
  }

  getPlayer(id) {
    const player = this.players.get(id)
    return player ? this.sanitizePlayer(player) : null
  }

  getPlayerByName(name) {
    for (const player of this.players.values()) {
      if (player.name === name) {
        return this.sanitizePlayer(player)
      }
    }
    return null
  }

  updatePlayerStats(id, stats) {
    const player = this.players.get(id)
    if (!player) return false
    
    Object.assign(player.stats, stats)
    this.savePlayers()
    return true
  }

  recordPrediction(id, prediction) {
    const player = this.players.get(id)
    if (!player) return null
    
    const predictionId = player.predictionHistory.length + 1
    player.predictionHistory.push({
      ...prediction,
      id: predictionId,
      correct: null,
      points: 0
    })
    player.stats.totalPredictions++
    this.savePlayers()
    return predictionId
  }

  recordPredictionResult(id, predictionId, correct, points) {
    const player = this.players.get(id)
    if (!player) return false
    
    const pred = player.predictionHistory.find(p => p.id === predictionId)
    if (pred) {
      pred.correct = correct
      pred.points = points
      pred.resultRecorded = true
    }
    
    if (correct) {
      player.stats.correctPredictions++
      player.stats.totalPoints += points
      player.stats.streak++
      player.stats.bestStreak = Math.max(player.stats.bestStreak, player.stats.streak)
    } else {
      player.stats.streak = 0
    }
    
    this.savePlayers()
    return true
  }

  getLeaderboard(limit = 10) {
    const allPlayers = Array.from(this.players.values())
      .filter(p => p.stats.totalPredictions > 0)
      .sort((a, b) => b.stats.totalPoints - a.stats.totalPoints)
      .slice(0, limit)
    
    return allPlayers.map((p, index) => ({
      rank: index + 1,
      id: p.id,
      name: p.name,
      username: p.username,
      registered: p.registered,
      stats: p.stats
    }))
  }

  getPlayerHistory(id, limit = 50) {
    const player = this.players.get(id)
    if (!player) return null
    
    return {
      player: this.sanitizePlayer(player),
      history: player.predictionHistory.slice(-limit).reverse()
    }
  }

  sanitizePlayer(player) {
    // Return player data without sensitive info like password
    return {
      id: player.id,
      name: player.name,
      username: player.username,
      registered: player.registered,
      createdAt: player.createdAt,
      stats: player.stats
    }
  }
}
