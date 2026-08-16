import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Header from './components/Header.jsx'
import Toast from './components/Toast.jsx'
import Home from './components/Home.jsx'
import Markets from './components/Markets.jsx'
import Games from './components/Games.jsx'
import Leaderboard from './components/Leaderboard.jsx'
import Profile from './components/Profile.jsx'
import Admin from './components/Admin.jsx'
import { readContract, writeContract } from './lib/gl.js'
import { CONTRACT, CHAIN_ID, NET_CFG } from './lib/config.js'

function loadSeenNotifs(account = '') {
  try { return JSON.parse(localStorage.getItem(`gm_seen_notifs_${account || 'guest'}`) || '[]') } catch (e) { return [] }
}

function isDeadlinePassed(deadlineTs) {
  const ts = Number.parseInt(String(deadlineTs || '0'), 10)
  return Number.isFinite(ts) && ts > 0 && Math.floor(Date.now() / 1000) >= ts
}

// Notifications are derived fresh from current on-chain state (your bets
// cross-referenced with market status), not a growing event log. This is
// what makes "won/lost/awaiting resolution/claim" possible: those are
// facts about right now, not things that happened at some point. It also
// means a claimed bet naturally drops off the list on its own, no manual
// cleanup needed.
function deriveNotifications(markets, myBets) {
  const marketById = {}
  markets.forEach(m => { marketById[m.id] = m })
  const items = []
  Object.entries(myBets || {}).forEach(([id, bet]) => {
    const m = marketById[id]
    const question = (m?.question || ('Market #' + id))
    const short = question.length > 60 ? question.slice(0, 60).trim() + '…' : question
    if (bet.status === 'WON') {
      items.push({ id: id + '-won', kind: 'won', text: `Your bet on "${short}" won, claim your reward` })
    } else if (bet.status === 'LOST') {
      items.push({ id: id + '-lost', kind: 'lost', text: `Your bet on "${short}" lost` })
    } else if (bet.status === 'CANCELLED') {
      items.push({ id: id + '-cancelled', kind: 'cancelled', text: `"${short}" was cancelled, refund available` })
    } else if (bet.status === 'OPEN' && m && isDeadlinePassed(m.deadline_ts)) {
      items.push({ id: id + '-pending', kind: 'pending', text: `"${short}" is awaiting resolution` })
    }
  })
  return items
}

// The real GenLayer mark, sourced directly from the official design
// system at github.com/genlayer-foundation/genlayer-design.
// Particle network background uses the brand blue #110FFF with very low opacity.
const Watermark = () => {
  const cvRef = React.useRef(null)
  React.useEffect(() => {
    const c = cvRef.current; if (!c) return
    const ctx = c.getContext('2d')
    let W, H, P = [], raf
    const N = 55, D = 160, S = 0.22
    const resize = () => { W = c.width = window.innerWidth; H = c.height = window.innerHeight }
    window.addEventListener('resize', resize); resize()
    for (let i = 0; i < N; i++) P.push({ x: Math.random()*W, y: Math.random()*H, vx: (Math.random()-.5)*S, vy: (Math.random()-.5)*S, r: Math.random()*1.4+.5 })
    const draw = () => {
      ctx.clearRect(0,0,W,H)
      P.forEach(p => { p.x+=p.vx; p.y+=p.vy; if(p.x<0||p.x>W)p.vx*=-1; if(p.y<0||p.y>H)p.vy*=-1 })
      for (let i = 0; i < N; i++) for (let j = i+1; j < N; j++) {
        const dx=P[i].x-P[j].x, dy=P[i].y-P[j].y, d=Math.sqrt(dx*dx+dy*dy)
        if (d < D) { ctx.strokeStyle=`rgba(17,15,255,${(1-d/D)*.06})`; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(P[i].x,P[i].y); ctx.lineTo(P[j].x,P[j].y); ctx.stroke() }
      }
      P.forEach(p => { ctx.fillStyle='rgba(17,15,255,.18)'; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill() })
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  return (
    <div className="bg-watermark">
      <div className="bg-watermark-bloom"/>
      <canvas ref={cvRef} className="bg-particle-canvas"/>
      <svg viewBox="0 0 97.76 91.93" className="bg-watermark-mark">
        <polygon points="44.26 32.35 27.72 67.12 43.29 74.9 0 91.93 44.26 0 44.26 32.35"/>
        <polygon points="53.5 32.35 70.04 67.12 54.47 74.9 97.76 91.93 53.5 0 53.5 32.35"/>
        <polygon points="48.64 43.78 58.33 62.94 48.64 67.69 39.47 62.92 48.64 43.78"/>
      </svg>
      <div className="bg-watermark-caption">BUILT ON GENLAYER</div>
    </div>
  )
}

export default function App() {
  const [page,      setPage]      = useState('home')
  const [theme,     setTheme]     = useState(() => localStorage.getItem('gm-theme') || 'dark')
  const [account,   setAccount]   = useState('')
  const [connected, setConnected] = useState(false)
  const [genBalWei, setGenBalWei] = useState(0n)
  const [username,  setUsername]  = useState('')
  const [markets,   setMarkets]   = useState([])
  const [myBets,    setMyBets]    = useState({})
  const [owner,     setOwner]     = useState('')
  const [admins,    setAdmins]    = useState([])
  const [toast,     setToast]     = useState({ msg: '', type: 'ok' })
  const [seenNotifs, setSeenNotifs] = useState(() => loadSeenNotifs(''))
  const [solvency, setSolvency] = useState(null)

  // Plain toast, no logging side effect, notifications are derived below
  // from real bet/market state, not from a record of every notify() call.
  const notify = (msg, type = 'ok') => {
    setToast({ msg, type })
  }

  const notifications = useMemo(() => {
    return deriveNotifications(markets, myBets).map(n => ({ ...n, read: seenNotifs.includes(n.id) }))
  }, [markets, myBets, seenNotifs])

  const markNotifsRead = () => {
    setSeenNotifs(() => {
      const next = notifications.map(n => n.id)
      try { localStorage.setItem(`gm_seen_notifs_${account || 'guest'}`, JSON.stringify(next)) } catch (e) {}
      return next
    })
  }

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('gm-theme', theme)
  }, [theme])

  // Load markets
  const loadMarkets = useCallback(async (addr = account) => {
    try {
      const raw = await readContract(CONTRACT, 'get_all_markets', [])
      const list = (!raw || raw === 'NO_MARKETS') ? [] : JSON.parse(raw) || []
      setMarkets(Array.isArray(list) ? list : [])

      if (addr) {
        const br = await readContract(CONTRACT, 'get_my_bets_all', [addr])
        if (br) {
          const bets = JSON.parse(br)
          if (Array.isArray(bets)) {
            const map = {}
            bets.forEach(b => { map[b.id] = b })
            setMyBets(map)
          }
        }
      }
    } catch (e) {
      console.error('loadMarkets:', e)
    }
  }, [account])

  // Initial load (no wallet needed for markets, owner, or admins, all view calls)
  const loadAdmins = useCallback(async () => {
    try {
      const raw = await readContract(CONTRACT, 'get_admins', [])
      const list = raw ? JSON.parse(raw) : []
      setAdmins(Array.isArray(list) ? list.map(a => String(a).toLowerCase()) : [])
    } catch (e) {}
  }, [])

  const loadSolvency = useCallback(async () => {
    try {
      const raw = await readContract(CONTRACT, 'get_solvency', [])
      setSolvency(raw ? JSON.parse(raw) : null)
    } catch (e) { setSolvency(null) }
  }, [])

  useEffect(() => {
    loadMarkets('')
    readContract(CONTRACT, 'get_owner', []).then(raw => {
      if (raw) setOwner(String(raw).toLowerCase().trim())
    }).catch(() => {})
    loadAdmins()
    loadSolvency()
  }, [])

  // Auto-reconnect
  useEffect(() => {
    const eth = window.ethereum
    if (!eth) return
    Promise.race([
      eth.request({ method: 'eth_accounts' }),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000))
    ]).then(accs => {
      if (accs?.[0]) onConnected(accs[0])
    }).catch(() => {})
  }, [])

  const onConnected = async (addr) => {
    const a = addr.toLowerCase()
    setAccount(a)
    setConnected(true)
    window._glAccount = a
    notify('Connected ✓', 'ok')
    loadMarkets(a)
    setSeenNotifs(loadSeenNotifs(a))
    await loadGenBal(a)
    // Username
    try {
      const raw = await readContract(CONTRACT, 'get_username', [a])
      if (raw && raw !== 'null' && raw !== '""') setUsername(raw.replace(/^"|"$/g, '') || '')
    } catch (e) {}
    // Keep exactly one provider listener so account changes cannot leave
    // stale wallet state or accumulate duplicate callbacks.
    try {
      if (window._gmAccountsChanged) window.ethereum.removeListener('accountsChanged', window._gmAccountsChanged)
      if (window._gmChainChanged) window.ethereum.removeListener('chainChanged', window._gmChainChanged)
      window._gmAccountsChanged = accs => { if (!accs.length) disconnect(); else onConnected(accs[0]) }
      window._gmChainChanged = () => window.location.reload()
      window.ethereum.on('accountsChanged', window._gmAccountsChanged)
      window.ethereum.on('chainChanged', window._gmChainChanged)
    } catch (e) {}
  }

  const loadGenBal = async (addr = account) => {
    if (!addr) return
    try {
      const r = await window.ethereum.request({ method: 'eth_getBalance', params: [addr, 'latest'] })
      setGenBalWei(BigInt(r))
    } catch (e) {}
  }

  const connect = async () => {
    const eth = window.ethereum
    if (!eth) { notify('Install MetaMask', 'err'); return }
    try {
      const accs = await eth.request({ method: 'eth_requestAccounts' })
      try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] })
      } catch (e) {
        if (e.code === 4902 || e.code === -32603)
          await eth.request({ method: 'wallet_addEthereumChain', params: [NET_CFG] })
      }
      await onConnected(accs[0])
    } catch (e) { notify(e.message || 'Connection failed', 'err') }
  }

  const disconnect = () => {
    setAccount(''); setConnected(false); setGenBalWei(0n); setUsername(''); setSeenNotifs(loadSeenNotifs(''))
    setMyBets({}); window._glAccount = ''
  }

  const sharedProps = {
    account, connected, genBalWei, username, solvency,
    markets, myBets, notify,
    loadMarkets: () => loadMarkets(account),
    loadGenBal: () => loadGenBal(account),
    setMyBets, setUsername,
    onConnect: connect,
    goTo: setPage,
    isOwner: connected && account && owner && account.toLowerCase() === owner,
    isAdmin: connected && account && admins.includes(account.toLowerCase()),
    canManage: connected && account && (account.toLowerCase() === owner || admins.includes(account.toLowerCase())),
    admins, loadAdmins, loadSolvency,
  }

  return (
    <div className="app-root">
      <Watermark/>
      <div className="app-content">
        <Header
          account={account} connected={connected} genBalWei={genBalWei}
          theme={theme} onThemeToggle={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          onConnect={connect} onDisconnect={disconnect}
          page={page} onNav={setPage}
          notifications={notifications} onMarkNotifsRead={markNotifsRead}
          canManage={sharedProps.canManage}
        />

        {page === 'home'        && <Home        {...sharedProps} />}
        {page === 'markets'     && <Markets     {...sharedProps} />}
        {page === 'games'       && <Games       {...sharedProps} />}
        {page === 'leaderboard' && <Leaderboard {...sharedProps} />}
        {page === 'profile'     && <Profile     {...sharedProps} />}
        {page === 'admin' && sharedProps.canManage && <Admin {...sharedProps} />}

        <Toast message={toast.msg} type={toast.type} onClear={() => setToast({ msg: '', type: 'ok' })} />
      </div>
    </div>
  )
}
