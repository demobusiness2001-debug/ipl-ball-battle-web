const API_BASE = 'https://api.cricketdata.org';

// Cricbuzz Live API (Unofficial - free, no API key needed)
export class CricbuzzLiveAPI {
  constructor() {
    this.baseURL = 'https://cricbuzz-live.vercel.app';
    this.cache = new Map();
  }

  async fetchLiveMatches(type = 'league') {
    const res = await fetch(`${this.baseURL}/v1/matches/live?type=${type}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  async fetchMatchScore(matchId) {
    const res = await fetch(`${this.baseURL}/v1/score/${matchId}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  async fetchRecentMatches() {
    const res = await fetch(`${this.baseURL}/v1/matches/recent`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  async fetchUpcomingMatches() {
    const res = await fetch(`${this.baseURL}/v1/matches/upcoming`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  // Parse liveScore string like "GG 155/5 (18.2)" to extract runs, wickets, overs
  parseLiveScore(liveScore) {
    if (!liveScore) return null;
    
    // Match patterns like "155/5 (18.2)" or "GG 155/5 (18.2)"
    const match = liveScore.match(/(\d+)\/(\d+)\s*\(([\d.]+)\)/);
    if (!match) return null;
    
    const runs = parseInt(match[1]);
    const wickets = parseInt(match[2]);
    const oversStr = match[3];
    const overs = parseFloat(oversStr);
    const over = Math.floor(overs);
    const ball = Math.round((overs % 1) * 10);
    
    return { runs, wickets, overs, over, ball };
  }

  // Find IPL match from live matches
  async findIPLMatch() {
    try {
      const data = await this.fetchLiveMatches('league');
      if (!data.data?.matches) return null;
      
      // Look for IPL match in the title
      const iplMatch = data.data.matches.find(m => 
        m.title?.toLowerCase().includes('ipl') ||
        m.title?.toLowerCase().includes('indian premier league') ||
        m.teams?.some(t => ['rcb', 'csk', 'mi', 'dc', 'pbks', 'rr', 'kkr', 'srh', 'gt', 'lsg'].some(
          team => t.team?.toLowerCase().includes(team)
        ))
      );
      
      return iplMatch || null;
    } catch (err) {
      console.error('[CricbuzzLive] Error finding IPL match:', err.message);
      return null;
    }
  }
}

export class CricketAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async fetchMatches() {
    const res = await fetch(`${API_BASE}/matches?apikey=${this.apiKey}&status=live`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  async fetchMatchScore(matchId) {
    const res = await fetch(`${API_BASE}/match/${matchId}?apikey=${this.apiKey}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  async fetchBallByBall(matchId) {
    const res = await fetch(`${API_BASE}/match/${matchId}/balls?apikey=${this.apiKey}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }
}

// Alternative: Using CricBuzz/Entity Sports style API
export class EntitySportsAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://rest.entitysport.com/v2';
  }

  async fetchLiveMatches() {
    const res = await fetch(`${this.baseURL}/matches?status=live&token=${this.apiKey}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  async fetchMatchScore(matchId) {
    const res = await fetch(`${this.baseURL}/matches/${matchId}/scorecard?token=${this.apiKey}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  async fetchCommentary(matchId) {
    const res = await fetch(`${this.baseURL}/matches/${matchId}/commentary?token=${this.apiKey}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }
}

// FREE Cricbuzz Mobile Scraper - scrapes the mobile website directly
export class FreeCricbuzzScraper {
  constructor() {
    this.baseURL = 'https://m.cricbuzz.com';
    this.lastScore = null;
  }

  async fetchLiveMatches() {
    try {
      // Fetch the live matches page
      const res = await fetch(`${this.baseURL}/cricket-match/live-scores`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
        }
      });
      const html = await res.text();
      
      // Parse match IDs and titles from the HTML
      const matches = [];
      const matchRegex = /href="\/live-cricket-scores\/(\d+)\/([^"]+)"/g;
      let match;
      while ((match = matchRegex.exec(html)) !== null) {
        const id = match[1];
        const slug = match[2].replace(/-/g, ' ');
        matches.push({
          id: id,
          title: slug,
          teams: slug.split(' vs ').map(t => t.trim())
        });
      }
      
      return { matches };
    } catch (err) {
      console.error('[FreeScraper] Error fetching matches:', err.message);
      return { matches: [] };
    }
  }

  async fetchMatchScore(matchId) {
    try {
      // Fetch the match page
      const res = await fetch(`${this.baseURL}/live-cricket-scores/${matchId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
        }
      });
      const html = await res.text();
      
      // Extract score from HTML
      // Look for patterns like "RCB 45/1 (5.2)" or "45/1 (5.2 overs)"
      const scoreRegex = /(\d+)\/(\d+)\s*\(([\d.]+)/;
      const scoreMatch = html.match(scoreRegex);
      
      if (scoreMatch) {
        const runs = parseInt(scoreMatch[1]);
        const wickets = parseInt(scoreMatch[2]);
        const overs = parseFloat(scoreMatch[3]);
        
        return {
          match_id: matchId,
          status: 'live',
          score: {
            runs,
            wickets,
            overs,
            over: Math.floor(overs),
            ball: Math.round((overs % 1) * 10)
          }
        };
      }
      
      return null;
    } catch (err) {
      console.error('[FreeScraper] Error fetching score:', err.message);
      return null;
    }
  }

  async findIPLMatch() {
    const { matches } = await this.fetchLiveMatches();
    
    // Find IPL match
    const iplKeywords = ['ipl', 'rcb', 'srh', 'csk', 'mi', 'dc', 'pbks', 'rr', 'kkr', 'gt', 'lsg'];
    const iplMatch = matches.find(m => {
      const titleLower = m.title.toLowerCase();
      return iplKeywords.some(kw => titleLower.includes(kw));
    });
    
    return iplMatch || null;
  }

  parseLiveScore(liveScore) {
    if (!liveScore) return null;
    const match = liveScore.match(/(\d+)\/(\d+)\s*\(([\d.]+)/);
    if (!match) return null;
    
    const runs = parseInt(match[1]);
    const wickets = parseInt(match[2]);
    const overs = parseFloat(match[3]);
    
    return {
      runs,
      wickets,
      overs,
      over: Math.floor(overs),
      ball: Math.round((overs % 1) * 10)
    };
  }
}

// Simple fallback that uses publicly available data
export class SimpleCricketAPI {
  constructor() {
    this.cache = new Map();
  }

  // Try to get live IPL matches from RSS feeds or public sources
  async fetchLiveMatches() {
    // For now, return empty or use a demo match
    return {
      matches: [{
        id: 'demo-ipl-2026',
        name: 'RCB vs SRH',
        status: 'live',
        teams: ['RCB', 'SRH']
      }]
    };
  }

  async fetchMatchScore(matchId) {
    // Return simulated data for now until API key is configured
    return {
      match_id: matchId,
      status: 'live',
      score: {
        runs: 0,
        wickets: 0,
        overs: 0,
        ball: 0
      },
      last_ball: null
    };
  }
}

export function createCricketAPI(apiKey, provider = 'auto') {
  if (provider === 'cricbuzz') {
    console.log('[CricketAPI] Using FreeCricbuzzScraper (mobile site scraper)');
    return new FreeCricbuzzScraper();
  }
  
  if (provider === 'cricbuzz-paid') {
    console.log('[CricketAPI] Using CricbuzzLive API (PAID)');
    return new CricbuzzLiveAPI();
  }
  
  if (!apiKey || provider === 'demo') {
    console.log('[CricketAPI] Using demo mode');
    return new SimpleCricketAPI();
  }
  
  return new SimpleCricketAPI();
}
