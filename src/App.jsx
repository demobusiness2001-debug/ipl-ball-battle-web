import React, { useEffect, useMemo, useState } from 'react'
import { createGameSocket } from './ws.js'

const WS_URL = import.meta.env.VITE_WS_URL || `ws://${location.hostname}:8080`

function predictionToRingText(key) {
  if (!key) return '—'
  if (key === 'DOT') return '0'
  if (key === 'ONE_TWO') return '1-2'
  if (key === 'THREE_PLUS') return '3+'
  if (key === 'FOUR') return '4'
  if (key === 'SIX') return '6'
  if (key === 'WICKET') return 'W'
  return '—'
}

function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${s}s`
}

const PREDICTIONS = [
  { key: 'DOT', label: 'Dot (0)' },
  { key: 'ONE_TWO', label: '1–2' },
  { key: 'FOUR', label: '4' },
  { key: 'SIX', label: '6' },
  { key: 'WICKET', label: 'Wicket' },
]

// Fake opponents for demo
const FAKE_OPPONENTS = [
  { name: 'Rahul', team: 'SRH' },
  { name: 'Vikram', team: 'RCB' },
  { name: 'Arjun', team: 'SRH' },
  { name: 'Karthik', team: 'RCB' },
  { name: 'Nikhil', team: 'SRH' },
]

function vibrate(pattern) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern)
  }
}

export default function App() {
  const sock = useMemo(() => createGameSocket({ url: WS_URL }), [])
  const [connected, setConnected] = useState(false)
  const [screen, setScreen] = useState('MATCH')
  const [name, setName] = useState('')
  const [team, setTeam] = useState(null)
  const [showNameModal, setShowNameModal] = useState(false)
  const [tempName, setTempName] = useState('')
  const [pendingTeam, setPendingTeam] = useState(null)
  
  // Player system state
  const [playerId, setPlayerId] = useState(null)
  const [registered, setRegistered] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [leaderboard, setLeaderboard] = useState([])
  const [playerStats, setPlayerStats] = useState(null)
  const [registerError, setRegisterError] = useState(null)
  const [loginError, setLoginError] = useState(null)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [realPlayerCount, setRealPlayerCount] = useState(0)
  const [teamCounts, setTeamCounts] = useState({ RCB: 0, SRH: 0 })

  const [serverState, setServerState] = useState(null)
  const [myPrediction, setMyPrediction] = useState(null)
  const [myBallPredictions, setMyBallPredictions] = useState(Array(6).fill(null))
  const [opponentBallPredictions, setOpponentBallPredictions] = useState(Array(6).fill(null))
  const [currentBallIndex, setCurrentBallIndex] = useState(0)
  const [now, setNow] = useState(Date.now())
  
  // Feedback state
  const [feedback, setFeedback] = useState(null) // { type: 'correct'|'wrong', points: number }
  const [showPlusPoints, setShowPlusPoints] = useState(false)

  // Next Ball Button State Machine: 'WAITING' | 'LOCKED' | 'RESULT' | 'RESET'
  const [gameState, setGameState] = useState('WAITING')
  const [resultData, setResultData] = useState(null) // { runs, wicket, actualResult }
  const [isPredictionLocked, setIsPredictionLocked] = useState(false)
  const [showingResultAnimation, setShowingResultAnimation] = useState(false)

  const themeClass = team === 'RCB' ? 'team-rcb' : team === 'SRH' ? 'team-srh' : ''

  useEffect(() => {
    sock.connect()
    const offOpen = sock.on('open', () => setConnected(true))
    const offClose = sock.on('close', () => setConnected(false))
    const offMsg = sock.on('message', (msg) => {
      if (msg.type === 'REGISTERED') {
        console.log('[Client] Received REGISTERED message:', msg)
        const player = msg.payload?.player
        if (player) {
          console.log('[Client] Player registered:', player)
          setName(player.name)
          setPlayerId(player.id)
          setRegistered(true)
          setShowRegisterModal(false)
          sock.send({ type: 'JOIN_MATCH', payload: {} })
          setScreen('TEAM')
          console.log('[Client] Transitioned to TEAM screen')
        } else {
          console.log('[Client] REGISTERED message missing player data')
        }
      }
      if (msg.type === 'LOGGED_IN') {
        const player = msg.payload?.player
        if (player) {
          setName(player.name)
          setPlayerId(player.id)
          setRegistered(true)
          setPlayerStats(player.stats)
          setShowLoginModal(false)
          sock.send({ type: 'JOIN_MATCH', payload: {} })
          setScreen('TEAM')
        }
      }
      if (msg.type === 'ERROR') {
        const errorMsg = msg.payload?.message || 'An error occurred'
        if (showRegisterModal) {
          setRegisterError(errorMsg)
        } else if (showLoginModal) {
          setLoginError(errorMsg)
        }
      }
      if (msg.type === 'LEADERBOARD') {
        setLeaderboard(msg.payload?.leaderboard || [])
      }
      if (msg.type === 'PLAYER_COUNT') {
        const count = msg.payload?.activePlayers || msg.payload?.totalConnected || 0
        setRealPlayerCount(count)
        const teams = msg.payload?.teams
        if (teams) {
          setTeamCounts(teams)
        }
      }
      if (msg.type === 'PROFILE') {
        setPlayerStats(msg.payload?.player)
      }
      if (msg.type === 'STATE') {
        const prevState = serverState
        const newState = msg.payload
        setServerState(newState)
        setMyPrediction(newState?.you?.lockedPrediction ?? null)
        
        // Update player info from server
        if (newState?.you?.playerId) {
          setPlayerId(newState.you.playerId)
          setRegistered(newState.you.registered)
        }
        
        // Update current ball index based on server state
        const ballIndex = newState.ball ? newState.ball - 1 : 0
        setCurrentBallIndex(Math.min(ballIndex, 5))
        
        // Check for ball change - transition to RESULT state
        if (prevState && prevState.ball !== newState.ball && gameState !== 'RESET') {
          const result = newState.lastResult
          if (result) {
            setGameState('RESULT')
            setResultData(result)
            setShowingResultAnimation(true)
            
            // Show result for 3 seconds then reset
            setTimeout(() => {
              setShowingResultAnimation(false)
              setGameState('RESET')
              
              // Reset for next ball after brief pause
              setTimeout(() => {
                resetForNextBall()
              }, 500)
            }, 3000)
          }
        }

        // Sync game state with server phase changes
        if (newState.phase === 'PREDICTING' && gameState === 'RESET') {
          setGameState('WAITING')
          setIsPredictionLocked(false)
        }

        // When ball changes, save the previous prediction and reset for new ball
        if (prevState && prevState.ball !== newState.ball) {
          // Ball changed - save previous predictions
          const prevBallIndex = prevState.ball ? prevState.ball - 1 : 0
          if (prevBallIndex >= 0 && prevBallIndex < 6) {
            // Save user's prediction for the completed ball
            setMyBallPredictions(prev => {
              const newPredictions = [...prev]
              newPredictions[prevBallIndex] = prevState.you?.lockedPrediction || null
              return newPredictions
            })
            // Save opponent's prediction (fake for now)
            setOpponentBallPredictions(prev => {
              const newPredictions = [...prev]
              const fakePreds = ['DOT', 'ONE_TWO', 'FOUR', 'SIX', 'WICKET']
              newPredictions[prevBallIndex] = fakePreds[Math.floor(Math.random() * fakePreds.length)]
              return newPredictions
            })
          }
        }
        
        // Check for result feedback
        if (prevState && prevState.phase === 'PREDICTING' && newState.phase === 'PREDICTING' && prevState.ball !== newState.ball) {
          // Ball changed, we got a result
          const myPred = prevState.you?.lockedPrediction
          const result = newState.lastResult
          if (myPred && result) {
            // Determine if prediction was correct
            let correct = false
            let points = 0
            
            if (myPred === 'WICKET' && result.wicket) {
              correct = true
              points = 12
            } else if (myPred === 'DOT' && result.runs === 0 && !result.wicket) {
              correct = true
              points = 5
            } else if (myPred === 'FOUR' && result.runs === 4) {
              correct = true
              points = 10
            } else if (myPred === 'SIX' && result.runs === 6) {
              correct = true
              points = 15
            } else if (myPred === 'ONE_TWO' && (result.runs === 1 || result.runs === 2)) {
              correct = true
              points = 5
            }
            
            if (correct) {
              setFeedback({ type: 'correct', points })
              setShowPlusPoints(true)
              vibrate([50, 30, 50]) // Success vibration
              setTimeout(() => setShowPlusPoints(false), 800)
            } else {
              setFeedback({ type: 'wrong', points: 0 })
              vibrate([100]) // Error vibration
            }
            
            // Clear feedback after animation
            setTimeout(() => setFeedback(null), 600)
          }
        }
      }
      if (msg.type === 'OVER_RESULT') {
        setServerState((s) => (s ? { ...s, overResult: msg.payload } : s))
      }
    })

    const t = setInterval(() => setNow(Date.now()), 200)
    return () => {
      offOpen()
      offClose()
      offMsg()
      clearInterval(t)
    }
  }, [sock])

  // Game state computed values
  const match = serverState?.match
  const phase = serverState?.phase
  const predictClosesAt = serverState?.predictClosesAt
  const countdownMs = predictClosesAt ? predictClosesAt - now : 0
  const canPredict = connected && phase === 'PREDICTING' && countdownMs > 0 && !isPredictionLocked && gameState === 'WAITING'

  // Handle countdown completion - lock prediction and request next ball
  function handleCountdownComplete() {
    setIsPredictionLocked(true)
    setGameState('LOCKED')
    
    // Auto-skip if no prediction made
    if (!myPrediction) {
      // User gets no points, just proceed
      console.log('No prediction made - auto skipping')
    }
    
    // Request next ball result from server
    sock.send({ type: 'NEXT_BALL', payload: { prediction: myPrediction } })
  }

  // Reset for next ball
  function resetForNextBall() {
    setMyPrediction(null)
    setResultData(null)
    setFeedback(null)
    setIsPredictionLocked(false)
    setGameState('WAITING')
    
    // Clear current ball prediction for the new ball
    const nextBallIndex = (serverState?.ball || 1) - 1
    setMyBallPredictions(prev => {
      const newPredictions = [...prev]
      if (nextBallIndex >= 0 && nextBallIndex < 6) {
        newPredictions[nextBallIndex] = null
      }
      return newPredictions
    })
  }

  // Handle manual next ball button click (for testing/debugging)
  function handleNextBallClick() {
    if (gameState === 'RESULT' || showingResultAnimation) {
      return // Disabled during result animation
    }
    
    if (gameState === 'WAITING' && countdownMs > 0) {
      // Manual trigger - force countdown to complete
      handleCountdownComplete()
    }
  }

  // Automatic countdown tracking - triggers state transitions
  useEffect(() => {
    if (gameState === 'WAITING' && countdownMs <= 0 && phase === 'PREDICTING' && !isPredictionLocked) {
      handleCountdownComplete()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownMs, gameState, phase, isPredictionLocked])

  function openNameModal() {
    setShowNameModal(true)
    setTempName(`Player${Math.floor(Math.random() * 9999)}`)
    requestLeaderboard()
  }

  function closeNameModal() {
    setShowNameModal(false)
  }

  function submitName() {
    const finalName = tempName.trim() || `Player${Math.floor(Math.random() * 9999)}`
    setName(finalName)
    setShowNameModal(false)
    sock.send({ type: 'JOIN', payload: { name: finalName } })
    sock.send({ type: 'JOIN_MATCH', payload: {} })
    setScreen('TEAM')
  }

  function openRegisterModal() {
    setShowRegisterModal(true)
    setShowNameModal(false)
    setUsername('')
    setPassword('')
    setRegisterError(null)
  }

  function openLoginModal() {
    setShowLoginModal(true)
    setShowNameModal(false)
    setUsername('')
    setPassword('')
    setLoginError(null)
  }

  function closeRegisterModal() {
    setShowRegisterModal(false)
    setShowNameModal(true)
  }

  function closeLoginModal() {
    setShowLoginModal(false)
    setShowNameModal(true)
  }

  function submitRegister() {
    if (!username || !password || !tempName) {
      console.log('[Register] Missing fields:', { username, password, tempName })
      return
    }
    console.log('[Register] Sending REGISTER message:', { username, name: tempName })
    sock.send({ type: 'REGISTER', payload: { username, password, name: tempName } })
  }

  function submitLogin() {
    if (!username || !password) return
    sock.send({ type: 'LOGIN', payload: { username, password } })
  }

  function requestLeaderboard() {
    sock.send({ type: 'GET_LEADERBOARD', payload: {} })
  }

  function requestProfile() {
    sock.send({ type: 'GET_PROFILE', payload: {} })
  }

  function chooseTeam(t) {
    setTeam(t)
    sock.send({ type: 'SELECT_TEAM', payload: { team: t } })
    setScreen('GAME')
  }

  function predict(key) {
    setMyPrediction(key)
    // Save prediction for current ball
    setMyBallPredictions(prev => {
      const newPredictions = [...prev]
      newPredictions[currentBallIndex] = key
      return newPredictions
    })
    sock.send({ type: 'PREDICT', payload: { prediction: key } })
  }

  const overText = serverState ? `${serverState.over}.${serverState.ball}` : '--'
  const scoreText = serverState ? `${serverState.runs}/${serverState.wkts}` : '--'
  const opp = serverState?.opponent
  const you = serverState?.you
  
  // Get opponent display name with team
  const getOpponentDisplay = () => {
    if (opp?.name) {
      return `${opp.name} (${opp.team || '??'})`
    }
    // Fake opponent for demo
    const fakeIndex = (serverState?.over || 0) % FAKE_OPPONENTS.length
    const fake = FAKE_OPPONENTS[fakeIndex]
    return `${fake.name} (${fake.team})`
  }

  return (
    <div className={`container ${themeClass}`}>
      <div className="bg" />

      {screen === 'MATCH' && (
        <div className="center landingPage">
          <div className="liveHeader">
            <span className="fire">🔥</span>
            <span className="liveText">LIVE MATCH ON</span>
          </div>

          <div className="matchTitle">
            <span className="teamA">RCB</span>
            <span className="vsText">vs</span>
            <span className="teamB">SRH</span>
          </div>

          <div className="countdown">
            <span className="clock">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12,6 12,12 16,14"/>
              </svg>
            </span>
            <span>Next ball in</span>
            <span className="count">12</span>
            <span>s</span>
          </div>

          <div className="teamLogos">
            <div className="teamBlock">
              <img className="teamLogo rcbLogo" src="/rcb_logo-removebg-preview.png" alt="RCB" />
              <div className="liveDotSmall">● LIVE</div>
            </div>
            <div className="vsCenter">VS</div>
            <div className="teamBlock">
              <img className="teamLogo srhLogo" src="/srh_logo-removebg-preview.png" alt="SRH" />
              <div className="liveDotSmall">● LIVE</div>
            </div>
          </div>

          <button className="playLiveBtn" onClick={openNameModal} disabled={!connected}>
            <span className="lightning">⚡</span>
            Play Live Now
          </button>

          <div className="playerCount">
            <span className="dot">●</span>
            {connected ? `${realPlayerCount.toLocaleString()} player${realPlayerCount !== 1 ? 's' : ''} playing` : 'Connecting...'}
          </div>

          {showNameModal && (
            <div className="modalOverlay" onClick={closeNameModal}>
              <div className="nameModal" onClick={(e) => e.stopPropagation()}>
                <h2 className="modalTitle">Enter Your Name</h2>
                <div className="modalInputWrapper">
                  <span className="userIcon">👤</span>
                  <input
                    type="text"
                    className="modalInput"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    placeholder="Enter your name"
                    autoFocus
                  />
                </div>
                <button className="continueBtn" onClick={submitName}>
                  Play as Guest
                </button>
                <div className="playerOptions">
                  <button className="secondaryBtn" onClick={openRegisterModal}>
                    Create Account
                  </button>
                  <button className="secondaryBtn" onClick={openLoginModal}>
                    Login
                  </button>
                </div>
                <div className="modalPlayerCount">
                  <span className="modalDot" />
                  {leaderboard.length > 0 ? `${leaderboard.length} players registered` : 'Play with registered players'}
                </div>
              </div>
            </div>
          )}

          {showRegisterModal && (
            <div className="modalOverlay" onClick={closeRegisterModal}>
              <div className="nameModal" onClick={(e) => e.stopPropagation()}>
                <h2 className="modalTitle">Create Account</h2>
                {registerError && (
                  <div className="errorMessage">{registerError}</div>
                )}
                <div className="modalInputWrapper">
                  <span className="userIcon">👤</span>
                  <input
                    type="text"
                    className="modalInput"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    placeholder="Display name"
                  />
                </div>
                <div className="modalInputWrapper">
                  <span className="userIcon">🔑</span>
                  <input
                    type="text"
                    className="modalInput"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                  />
                </div>
                <div className="modalInputWrapper">
                  <span className="userIcon">🔒</span>
                  <input
                    type="password"
                    className="modalInput"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                  />
                </div>
                <button className="continueBtn" onClick={submitRegister} disabled={!username?.trim() || username.trim().length < 3 || !password?.trim() || password.trim().length < 4 || !tempName?.trim()}>
                  Register & Play
                </button>
                <button className="secondaryBtn" onClick={closeRegisterModal}>
                  Back
                </button>
              </div>
            </div>
          )}

          {showLoginModal && (
            <div className="modalOverlay" onClick={closeLoginModal}>
              <div className="nameModal" onClick={(e) => e.stopPropagation()}>
                <h2 className="modalTitle">Login</h2>
                {loginError && (
                  <div className="errorMessage">{loginError}</div>
                )}
                <div className="modalInputWrapper">
                  <span className="userIcon">🔑</span>
                  <input
                    type="text"
                    className="modalInput"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                    autoFocus
                  />
                </div>
                <div className="modalInputWrapper">
                  <span className="userIcon">🔒</span>
                  <input
                    type="password"
                    className="modalInput"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                  />
                </div>
                <button className="continueBtn" onClick={submitLogin} disabled={!username?.trim() || !password?.trim()}>
                  Login & Play
                </button>
                <button className="secondaryBtn" onClick={closeLoginModal}>
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {screen === 'TEAM' && (
        <div className="teamSelection">
          <div className="teamSelectionHeader">
            <img src="/ipl ball battle logo.png" alt="IPL Ball Battle" className="teamLogoHeader" />
            <p className="teamSelectionSubtitle">Choose Your Team!</p>
          </div>

          <div className="teamCards">
            <div
              className={`teamCardV2 teamCardRCB ${pendingTeam === 'RCB' ? 'selected' : ''}`}
              onClick={() => setPendingTeam('RCB')}
            >
              <div className="teamCardLogoWrapper rcbGradient">
                <img src="/rcb_logo-removebg-preview.png" alt="RCB" className="teamCardLogo" />
              </div>
              <div className="teamCardInfo">
                <div className="teamCardCode">RCB</div>
                <div className="teamCardFullName">Royal&nbsp;Challengers Bangalore</div>
              </div>
              <div className="teamCardFooter">
                <span className="teamCardDot" />
                <div className="teamCardFooterText">
                  <span className="teamCardCount">{teamCounts.RCB.toLocaleString()}</span>
                  <span className="teamCardCountLabel">players</span>
                </div>
                <span className="teamCardArrow">›</span>
              </div>
            </div>

            <div
              className={`teamCardV2 teamCardSRH ${pendingTeam === 'SRH' ? 'selected' : ''}`}
              onClick={() => setPendingTeam('SRH')}
            >
              <div className="teamCardLogoWrapper srhGradient">
                <img src="/srh_logo-removebg-preview.png" alt="SRH" className="teamCardLogo" />
              </div>
              <div className="teamCardInfo">
                <div className="teamCardCode">SRH</div>
                <div className="teamCardFullName">Sunrisers Hyderabad</div>
              </div>
              <div className="teamCardFooter">
                <span className="teamCardDot" />
                <div className="teamCardFooterText">
                  <span className="teamCardCount">{teamCounts.SRH.toLocaleString()}</span>
                  <span className="teamCardCountLabel">players</span>
                </div>
                <span className="teamCardArrow">›</span>
              </div>
            </div>
          </div>

          <button className="continueBtn" onClick={() => chooseTeam(pendingTeam)} disabled={!pendingTeam}>
            Continue
          </button>
        </div>
      )}

      {screen === 'GAME' && (
        <div className="gameScreen">
          {/* Header Buttons */}
          <div className="gameHeaderButtons">
            <button className="headerBtn leaderboardBtn" onClick={() => { requestLeaderboard(); setShowLeaderboard(true) }}>
              🏆 Leaderboard
            </button>
            {registered && (
              <button className="headerBtn" onClick={() => { requestProfile(); setShowProfileModal(true) }}>
                👤 Profile
              </button>
            )}
          </div>

          {/* Player Stats Display */}
          {registered && playerStats && (
            <div className="playerStatsDisplay">
              <div className="playerStatsAvatar">{name.charAt(0).toUpperCase()}</div>
              <div className="playerStatsInfo">
                <div className="playerStatsName">
                  {name}
                  <span className="playerStatsBadge">Registered</span>
                </div>
                <div className="playerStatsRow">
                  <span>Games: <span className="playerStatsValue">{playerStats.gamesPlayed || 0}</span></span>
                  <span>Correct: <span className="playerStatsValue">{playerStats.correctPredictions || 0}</span></span>
                  <span>Total: <span className="playerStatsValue">{playerStats.totalPoints || 0}</span></span>
                </div>
              </div>
            </div>
          )}

          {/* Top Bar - Players at corners */}
          <div className="topBar">
            {/* Left Player (Me) */}
            <div className="playerBox leftPlayerBox">
              <div className="playerAvatarGold">
                <span className="avatarIcon">👤</span>
                {team && (
                  <img 
                    src={team === 'RCB' ? '/rcb_logo-removebg-preview.png' : '/srh_logo-removebg-preview.png'} 
                    alt={team} 
                    className="playerTeamLogo" 
                  />
                )}
              </div>
              <div className="playerInfoBox">
                <div className="playerName">{name || 'You'}</div>
                <div className="playerPointsRow">
                  <span className="ptsText">PTS</span>
                  <span className="ptsValue">{you?.points || 0}</span>
                  <img src="/points icon2.svg" alt="points" className="ptsIconImg" />
                </div>
              </div>
            </div>

            {/* Right Player (Opponent) */}
            <div className="playerBox rightPlayerBox">
              <div className="playerInfoBox">
                <div className="playerName">{opp?.name || (() => {
                  const fakeIndex = (serverState?.over || 0) % FAKE_OPPONENTS.length
                  return FAKE_OPPONENTS[fakeIndex].name
                })()}</div>
                <div className="playerPointsRow">
                  <span className="ptsText">PTS</span>
                  <span className="ptsValue">{opp?.points || 0}</span>
                  <img src="/points icon2.svg" alt="points" className="ptsIconImg" />
                </div>
              </div>
              <div className="playerAvatarGold opponentAvatarGold">
                <span className="avatarIcon">👤</span>
              </div>
            </div>
          </div>

          {/* Logo with horizontal line */}
          <div className="logoWithLine">
            <div className="logoWrapper">
              <div className="horizontalLine" />
              <img src="/ipl ball battle logo.png" alt="IPL BALL BATTLE" className="centerLogo" />
            </div>
            <div className="scoreOversRow">
              <div className="liveScoreBlock">
                <span className="liveScoreLabel">{match?.battingTeam || team || 'RCB'}</span>
                <span className="liveScoreValue">{scoreText}</span>
              </div>
              <div className="liveOversBlock">
                <span className="liveOversLabel">OVER</span>
                <span className="liveOversValue">{overText}</span>
              </div>
            </div>
          </div>

          {/* Points Display */}
          {feedback?.type === 'correct' && (
            <div className="pointsDisplay">+{feedback.points} PTS</div>
          )}

          {/* Ring Section */}
          <div className="ringSection">
            {/* Left side - User's 6 ball predictions */}
            <div className="ballIndicators leftBalls">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={`my-ball-${i}`}
                  className={`ballIndicator ${myBallPredictions[i] ? 'hasPrediction' : ''} ${i === currentBallIndex ? 'current' : ''} ${i < currentBallIndex ? 'completed' : ''}`}
                >
                  <span className="ballNumber">{i + 1}</span>
                  <span className="ballPrediction">
                    {myBallPredictions[i] ? predictionToRingText(myBallPredictions[i]) : '—'}
                  </span>
                </div>
              ))}
            </div>

            <div className="goldenRing">
              <div className="ringGlow" />
              <div className="ringInner">
                <div className="ringNumber">{predictionToRingText(myPrediction)}</div>
              </div>
            </div>

            {/* Right side - Opponent's 6 ball predictions */}
            <div className="ballIndicators rightBalls">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={`opp-ball-${i}`}
                  className={`ballIndicator ${opponentBallPredictions[i] ? 'hasPrediction' : ''} ${i === currentBallIndex ? 'current' : ''} ${i < currentBallIndex ? 'completed' : ''}`}
                >
                  <span className="ballNumber">{i + 1}</span>
                  <span className="ballPrediction">
                    {opponentBallPredictions[i] ? predictionToRingText(opponentBallPredictions[i]) : '—'}
                  </span>
                </div>
              ))}
            </div>
            
            {/* Result Message */}
            {feedback?.type === 'correct' && (
              <div className="resultMessage">
                <div className="resultTitle">You Scored {feedback.points} Points!</div>
                <div className="resultSubtitle">Amazing! {predictionToRingText(myPrediction)} the ball went for a {predictionToRingText(myPrediction) === '6' ? 'six' : predictionToRingText(myPrediction) === '4' ? 'four' : predictionToRingText(myPrediction) === 'W' ? 'wicket' : 'runs'}.</div>
              </div>
            )}
          </div>

          {/* Prediction Grid - 3x2 */}
          <div className="predGridV2">
            {PREDICTIONS.map((p) => (
              <button
                key={p.key}
                className={`predBtnV2 ${myPrediction === p.key ? 'predBtnSelectedV2' : ''}`}
                onClick={() => predict(p.key)}
                disabled={!canPredict}
              >
                {p.key === 'DOT' ? 'Dot' : 
                 p.key === 'ONE_TWO' ? '1-2' : 
                 p.key === 'WICKET' ? 'Wicket' : p.label}
              </button>
            ))}
          </div>

          {/* Next Ball Button */}
          <button 
            className="nextBallBtn" 
            onClick={handleNextBallClick}
            disabled={gameState === 'RESULT' || gameState === 'LOCKED' || showingResultAnimation}
          >
            <span className="lightning">⚡</span>
            {gameState === 'WAITING' && `Next Ball in ${formatCountdown(countdownMs)}`}
            {gameState === 'LOCKED' && 'Ball in progress...'}
            {gameState === 'RESULT' && showingResultAnimation && 'Showing result...'}
            {gameState === 'RESET' && 'Get ready...'}
          </button>

          {/* Player Count */}
          <div className="gamePlayerCount">
            <span className="greenDot" />
            {connected ? `${realPlayerCount.toLocaleString()} player${realPlayerCount !== 1 ? 's' : ''} playing` : 'Connecting...'}
          </div>

          {/* Leaderboard Modal */}
          {showLeaderboard && (
            <div className="modalOverlay" onClick={() => setShowLeaderboard(false)}>
              <div className="leaderboardModal" onClick={(e) => e.stopPropagation()}>
                <div className="leaderboardHeader">
                  <h2 className="leaderboardTitle">🏆 Leaderboard</h2>
                  <button className="leaderboardClose" onClick={() => setShowLeaderboard(false)}>×</button>
                </div>
                <div className="leaderboardList">
                  {leaderboard.length === 0 ? (
                    <div className="leaderboardEmpty">No registered players yet. Be the first!</div>
                  ) : (
                    leaderboard.map((player, index) => (
                      <div
                        key={player.id}
                        className={`leaderboardItem ${player.id === playerId ? 'currentPlayer' : ''}`}
                      >
                        <div className={`leaderboardRank ${index < 3 ? 'top3' : ''}`}>
                          {index + 1}
                        </div>
                        <div className="leaderboardPlayerInfo">
                          <div className="leaderboardPlayerName">{player.name}</div>
                          <div className="leaderboardPlayerStats">
                            Games: {player.stats?.gamesPlayed || 0} | Correct: {player.stats?.correctPredictions || 0}
                          </div>
                        </div>
                        <div className="leaderboardPoints">{player.stats?.totalPoints || 0} pts</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Profile Modal */}
          {showProfileModal && playerStats && (
            <div className="modalOverlay" onClick={() => setShowProfileModal(false)}>
              <div className="profileModal" onClick={(e) => e.stopPropagation()}>
                <div className="profileHeader">
                  <h2 className="profileTitle">👤 Your Profile</h2>
                  <button className="leaderboardClose" onClick={() => setShowProfileModal(false)}>×</button>
                </div>
                <div className="profileContent">
                  <div className="playerStatsDisplay">
                    <div className="playerStatsAvatar">{name.charAt(0).toUpperCase()}</div>
                    <div className="playerStatsInfo">
                      <div className="playerStatsName">
                        {name}
                        <span className="playerStatsBadge">Registered</span>
                      </div>
                    </div>
                  </div>
                  <div className="profileStatRow">
                    <span className="profileStatLabel">Games Played</span>
                    <span className="profileStatValue">{playerStats.stats?.gamesPlayed || playerStats.gamesPlayed || 0}</span>
                  </div>
                  <div className="profileStatRow">
                    <span className="profileStatLabel">Correct Predictions</span>
                    <span className="profileStatValue">{playerStats.stats?.correctPredictions || playerStats.correctPredictions || 0}</span>
                  </div>
                  <div className="profileStatRow">
                    <span className="profileStatLabel">Total Predictions</span>
                    <span className="profileStatValue">{playerStats.stats?.totalPredictions || playerStats.totalPredictions || 0}</span>
                  </div>
                  <div className="profileStatRow">
                    <span className="profileStatLabel">Total Points</span>
                    <span className="profileStatValue highlight">{playerStats.stats?.totalPoints || playerStats.totalPoints || 0}</span>
                  </div>
                  <div className="profileStatRow">
                    <span className="profileStatLabel">Current Streak</span>
                    <span className="profileStatValue highlight">{playerStats.stats?.currentStreak || playerStats.currentStreak || 0}</span>
                  </div>
                  <div className="profileStatRow">
                    <span className="profileStatLabel">Best Streak</span>
                    <span className="profileStatValue">{playerStats.stats?.bestStreak || playerStats.bestStreak || 0}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
