import React, { useState, useEffect } from 'react'
import { readContract } from '../lib/gl.js'
import { CONTRACT, sh, fmt } from '../lib/config.js'

export default function Leaderboard({ account }) {
  const [list,    setList]    = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const raw = await readContract(CONTRACT, 'get_leaderboard', [20])
        if (raw && raw !== '[]' && raw !== 'null') {
          const p = JSON.parse(raw)
          if (Array.isArray(p)) setList(p)
        }
      } catch (e) {}
      setLoading(false)
    }
    load()
  }, [])

  const rankStyle = [
    { label: '01', color: '#F5C518' },  // gold
    { label: '02', color: '#9CA3AF' },  // silver
    { label: '03', color: '#CD7F32' },  // bronze
  ]

  return (
    <div className="wrap">
      <div className="page-head">
        <div className="page-title">Rankings</div>
      </div>

      {loading ? (
        <div className="empty">
          <div className="empty-title">Loading rankings…</div>
        </div>
      ) : list.length === 0 ? (
        <div className="empty">
          <div className="empty-icon" style={{fontSize:'3rem',opacity:.3}}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 21h8M12 17v4M17 3H7l-2 9h14L17 3zM7 12a5 5 0 0010 0"/></svg>
          </div>
          <div className="empty-title">No rankings yet</div>
          <div className="empty-sub">Win predictions or games to earn XP and appear here</div>
        </div>
      ) : (
        <div className="lb-wrap">
          <div className="lb-header-row">
            <span className="lb-header-label">Rank by XP — earned only from wins</span>
            <span className="lb-header-label">W / L record</span>
          </div>
          {list.map((e, i) => {
            const isMe = e.address === account
            const total = (e.wins||0) + (e.losses||0)
            const winRate = total > 0 ? Math.round((e.wins||0)/total*100) : null
            return (
              <div key={e.address} className={`lb-row${isMe ? ' lb-me' : ''}`}>
                <span className="lb-rank">
                  {rankStyle[i]
                    ? <span style={{ fontFamily:'var(--mono)', fontSize:13, fontWeight:900, color: rankStyle[i].color }}>#{rankStyle[i].label}</span>
                    : <span style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--muted)' }}>#{i+1}</span>
                  }
                </span>
                <span className="lb-name">{e.username || sh(e.address)}{isMe ? <span style={{ fontSize:10, color:'var(--blue)', marginLeft:6, fontFamily:'var(--mono)', fontWeight:700 }}>YOU</span> : ''}</span>
                <div className="lb-xp-block">
                  <span className="lb-xp">{fmt(e.xp)} XP</span>
                  <span className="lb-xp-caption">{winRate !== null ? winRate+'% win rate' : 'no record yet'}</span>
                </div>
                <span className="lb-record">{e.wins||0}W / {e.losses||0}L</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
