import React, { useState, useEffect, useRef } from 'react'
import { sh } from '../lib/config.js'

const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
    <rect width="26" height="26" rx="7" fill="url(#lg)"/>
    <defs>
      <linearGradient id="lg" x1="0" y1="0" x2="26" y2="26">
        <stop offset="0%" stopColor="#6366F1"/>
        <stop offset="100%" stopColor="#8B5CF6"/>
      </linearGradient>
    </defs>
    {/* Real GenLayer mark, scaled to fit the badge */}
    <g transform="translate(4.2,4.6) scale(0.18)">
      <polygon points="44.26 32.35 27.72 67.12 43.29 74.9 0 91.93 44.26 0 44.26 32.35" fill="white"/>
      <polygon points="53.5 32.35 70.04 67.12 54.47 74.9 97.76 91.93 53.5 0 53.5 32.35" fill="white" opacity=".85"/>
      <polygon points="48.64 43.78 58.33 62.94 48.64 67.69 39.47 62.92 48.64 43.78" fill="white" opacity=".6"/>
    </g>
  </svg>
)

const BellIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 01-3.46 0"/>
  </svg>
)

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s/60) + 'm ago'
  if (s < 86400) return Math.floor(s/3600) + 'h ago'
  return Math.floor(s/86400) + 'd ago'
}

export default function Header({ account, connected, theme, onThemeToggle, onConnect, onDisconnect, page, onNav, notifLog=[], onMarkNotifsRead }) {
  const [menuOpen,  setMenuOpen]  = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef(null)

  const pages = [
    {key:'home',label:'Home'},{key:'markets',label:'Markets'},
    {key:'games',label:'Games'},{key:'leaderboard',label:'Rankings'},{key:'profile',label:'Profile'},
  ]
  const go = (key) => { onNav(key); setMenuOpen(false) }
  const unread = notifLog.filter(n => !n.read).length

  const toggleNotif = () => {
    setNotifOpen(o => {
      const next = !o
      if (next) onMarkNotifsRead && onMarkNotifsRead()
      return next
    })
  }

  useEffect(() => {
    const onClick = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <header className="header">
      <div className="wrap header-inner">
        <button className="logo" onClick={() => go('home')}>
          <Logo/> Gen Markets
        </button>

        <nav className="nav">
          {pages.map(p => (
            <button key={p.key} className={`nb${page===p.key?' on':''}`} onClick={() => go(p.key)}>
              {p.label}
            </button>
          ))}
        </nav>

        <div className="hdr-right">
          {!connected && <button className="btn btn-primary btn-sm hide-xs" onClick={onConnect}>Connect Wallet</button>}
          {connected && <>
            <div className="wpill" onClick={() => go('profile')}>
              <span className="wpill-dot"/>
              <span className="wpill-addr">{sh(account)}</span>
            </div>
            <button className="btn btn-outline btn-sm hide-xs" onClick={onDisconnect}>Disconnect</button>
          </>}

          <div className="notif-wrap" ref={notifRef}>
            <button className="tbtn" onClick={toggleNotif} title="Notifications">
              <BellIcon/>
              {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
            </button>
            {notifOpen && (
              <div className="notif-panel">
                <div className="notif-panel-head">Notifications</div>
                {notifLog.length === 0 ? (
                  <div className="notif-empty">Nothing yet — your activity will show up here</div>
                ) : notifLog.map(n => (
                  <div key={n.id} className={`notif-item${n.read?'':' unread'}`}>
                    <span className={`notif-dot ${n.type==='err'?'err':'ok'}`}/>
                    <div>
                      <div className="notif-msg">{n.msg}</div>
                      <div className="notif-time">{timeAgo(n.ts)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button className="tbtn" onClick={onThemeToggle} title="Toggle theme">
            {theme==='dark'
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            }
          </button>

          <button className="hamburger-btn" onClick={() => setMenuOpen(o=>!o)} aria-label="Menu">
            {menuOpen
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            }
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="mobile-drawer">
          {pages.map(p => (
            <button key={p.key} className={`nb${page===p.key?' on':''}`} onClick={() => go(p.key)}>
              {p.label}
            </button>
          ))}
          {!connected
            ? <button className="btn btn-primary" style={{marginTop:8}} onClick={() => { onConnect(); setMenuOpen(false) }}>Connect Wallet</button>
            : <button className="btn btn-outline" style={{marginTop:8}} onClick={() => { onDisconnect(); setMenuOpen(false) }}>Disconnect Wallet</button>
          }
        </div>
      )}
      <div style={{position:'fixed',bottom:6,right:8,fontSize:9,color:'var(--muted)',opacity:.35,fontFamily:'var(--mono)',pointerEvents:'none',zIndex:50}}>
        build {typeof __BUILD_TIME__ !== 'undefined' ? new Date(__BUILD_TIME__).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : 'dev'}
      </div>
    </header>
  )
}
