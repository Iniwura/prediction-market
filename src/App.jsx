import React, { useState, useEffect, useCallback, useRef } from 'react'
import Header from './components/Header.jsx'
import Toast from './components/Toast.jsx'
import Home from './components/Home.jsx'
import Markets from './components/Markets.jsx'
import Games from './components/Games.jsx'
import Leaderboard from './components/Leaderboard.jsx'
import Profile from './components/Profile.jsx'
import { readContract, writeContract } from './lib/gl.js'
import { CONTRACT, CHAIN_ID, NET_CFG, sh, fmt } from './lib/config.js'

function loadNotifLog() {
  try { return JSON.parse(localStorage.getItem('gm_notiflog') || '[]') } catch (e) { return [] }
}

// The real GenLayer mark — sourced directly from the official design
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
  const [genBal,    setGenBal]    = useState(0)
  const [username,  setUsername]  = useState('')
  const [markets,   setMarkets]   = useState([])
  const [myBets,    setMyBets]    = useState({})
  const [owner,     setOwner]     = useState('')
  const [toast,     setToast]     = useState({ msg: '', type: 'ok' })
  const [txLogs,    setTxLogs]    = useState([])
  const [notifLog,  setNotifLog]  = useState(loadNotifLog)
  const loadingRef = useRef(false)

  // notify() drives the toast AND silently writes to a persistent log the
  // user can reopen later via the bell icon — no extra calls needed anywhere
  // else in the app, since every meaningful action already calls notify().
  const notify = (msg, type = 'ok') => {
    setToast({ msg, type })
    setNotifLog(prev => {
      const entry = { id: Date.now() + Math.random(), msg, type, ts: Date.now(), read: false }
      const next = [entry, ...prev].slice(0, 25)
      try { localStorage.setItem('gm_notiflog', JSON.stringify(next)) } catch (e) {}
      return next
    })
  }
  const markNotifsRead = () => {
    setNotifLog(prev => {
      const next = prev.map(n => ({ ...n, read: true }))
      try { localStorage.setItem('gm_notiflog', JSON.stringify(next)) } catch (e) {}
      return next
    })
  }

  const txLog  = (msg, type = '') => {
    const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
    setTxLogs(prev => [...prev, { t, msg, type }])
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

  // Initial load (no wallet needed for markets or owner — both are view calls)
  useEffect(() => {
    loadMarkets('')
    readContract(CONTRACT, 'get_owner', []).then(raw => {
      if (raw) setOwner(String(raw).toLowerCase().trim())
    }).catch(() => {})
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
    await loadGenBal(a)
    // Username
    try {
      const raw = await readContract(CONTRACT, 'get_username', [a])
      if (raw && raw !== 'null' && raw !== '""') setUsername(raw.replace(/^"|"$/g, '') || '')
    } catch (e) {}
    // Listeners
    try {
      window.ethereum.on('accountsChanged', accs => { if (!accs.length) disconnect() })
      window.ethereum.on('chainChanged', () => window.location.reload())
    } catch (e) {}
  }

  const loadGenBal = async (addr = account) => {
    if (!addr) return
    try {
      const r = await window.ethereum.request({ method: 'eth_getBalance', params: [addr, 'latest'] })
      setGenBal(parseFloat(BigInt(r).toString()) / 1e18)
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
    setAccount(''); setConnected(false); setGenBal(0); setUsername('')
    setMyBets({}); window._glAccount = ''
  }

  const sharedProps = {
    account, connected, genBal, username,
    markets, myBets, notify, txLog, txLogs,
    loadMarkets: () => loadMarkets(account),
    loadGenBal: () => loadGenBal(account),
    setMyBets, setUsername,
    onConnect: connect,
    goTo: setPage,
    isOwner: connected && account && owner && account.toLowerCase() === owner,
  }

  return (
    <div className="app-root">
      <Watermark/>
      <div className="app-content">
        <Header
          account={account} connected={connected}
          theme={theme} onThemeToggle={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          onConnect={connect} onDisconnect={disconnect}
          page={page} onNav={setPage}
          notifLog={notifLog} onMarkNotifsRead={markNotifsRead}
        />

        {page === 'home'        && <Home        {...sharedProps} />}
        {page === 'markets'     && <Markets     {...sharedProps} />}
        {page === 'games'       && <Games       {...sharedProps} />}
        {page === 'leaderboard' && <Leaderboard {...sharedProps} />}
        {page === 'profile'     && <Profile     {...sharedProps} />}

        <Toast message={toast.msg} type={toast.type} onClear={() => setToast({ msg: '', type: 'ok' })} />
      </div>
    </div>
  )
}
