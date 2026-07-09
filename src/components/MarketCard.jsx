import React, { useState } from 'react'
import { fmt } from '../lib/config.js'

// Pool and total_pool come from the contract as raw wei integers —
// same fix as the games' payout display.
function weiToGen(wei) {
  const n = Number(wei) || 0
  return (n / 1e18).toFixed(4).replace(/\.?0+$/, '') || '0'
}

function formatDeadline(raw) {
  if (!raw || raw === 'No deadline') return null
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    try {
      const d = new Date(raw)
      if (!isNaN(d.getTime())) return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
    } catch(e) {}
  }
  return raw
}

// deadline_note is stored as a real UTC date string (e.g. from toUTCString()).
// If it parses to a real date in the past, betting closes. Markets with an
// unparseable or missing deadline fail open — never block betting on a
// market we can't confidently evaluate.
function isDeadlinePassed(raw) {
  if (!raw || raw === 'No deadline') return false
  const t = Date.parse(raw)
  if (isNaN(t)) return false
  return Date.now() > t
}

export default function MarketCard({ m, myBet, connected, isOwner, onBet, onResolve, onCancel, onRefund, resolving, cancelling, refunding }) {
  const isOpen = m.status === 'OPEN'
  const isRes  = m.status === 'RESOLVED'
  const isCanc = m.status === 'CANCELLED'
  const outs   = m.outcomes || []
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [hidden, setHidden] = useState(false)

  const needsRefund = isCanc && myBet && myBet.status !== 'CLAIMED'
  const deadlinePassed  = isOpen && isDeadlinePassed(m.deadline)

  if (hidden && (isRes || isCanc)) return null

  const getClass = (o) => {
    if (isRes && m.winner === o) return 'oc-btn oc-neu win'
    if (myBet?.outcome === o) return 'oc-btn oc-neu pick'
    if (isRes) return 'oc-btn oc-neu lost'
    const lo = o.toLowerCase()
    if (lo === 'yes') return 'oc-btn oc-yes'
    if (lo === 'no')  return 'oc-btn oc-no'
    return 'oc-btn oc-neu'
  }

  const dl = formatDeadline(m.deadline)

  return (
    <div className={`mcard${isRes||isCanc ? ' mcard-settled' : ''}`}>
      {/* Meta row */}
      <div className="mcard-meta">
        <span className={`badge ${isOpen?'badge-open':isRes?'badge-resolved':isCanc?'badge-cancelled':'badge-pending'}`}>{m.status}</span>
        {m.schedule_type && m.schedule_type !== 'manual' && (
          <span className="badge badge-sched">{m.schedule_type}</span>
        )}
        {dl && !isCanc && m.schedule_type === 'manual' && <span className="mcard-dl">{dl}</span>}
        {deadlinePassed && <span className="badge" style={{background:'rgba(245,158,11,.1)',color:'var(--amber)',border:'1px solid rgba(245,158,11,.2)'}}>Betting closed</span>}
        {(isRes || isCanc) && (
          <button className="mcard-dismiss" onClick={() => setHidden(true)} title="Hide">✕</button>
        )}
      </div>

      {/* Question */}
      <div className="mcard-q">{m.question}</div>

      {/* Outcomes */}
      <div className={`outcome-split${outs.length > 2 ? ' multi' : ''}`}>
        {outs.map((o, i) => {
          const prob = m.ai_probs?.[i] || Math.round(100/outs.length)
          const pool = m.pools?.[i] || 0
          const isWin = isRes && m.winner === o
          const canBet = isOpen && connected && !myBet && !deadlinePassed
          return (
            <div
              key={o}
              className={getClass(o)}
              onClick={() => canBet && onBet(m.id, o)}
              style={{ cursor: canBet ? 'pointer' : 'default', opacity: deadlinePassed && !isRes ? .55 : 1 }}
            >
              <div className="oc-label">{o}{isWin ? ' ✓' : ''}</div>
              <div className="oc-pct">{prob}%</div>
              <div className="oc-pool">{weiToGen(pool)} GEN</div>
            </div>
          )
        })}
      </div>

      {deadlinePassed && (
        <div style={{fontSize:11,color:'var(--amber)',textAlign:'center',padding:'6px 10px',marginBottom:10,background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.18)',borderRadius:6}}>
          Deadline passed — betting closed, awaiting resolution
        </div>
      )}

      {/* My bet chip */}
      {myBet && (
        <div className="my-bet-chip">
          <span>Your pick</span>
          <span style={{color:'var(--text2)'}}>{myBet.outcome}</span>
          <span style={{color: myBet.status==='WON'||myBet.status==='CLAIMED'?'var(--teal)':myBet.status==='LOST'?'var(--red)':'var(--indigo)'}}>
            {needsRefund ? 'CANCELLED' : myBet.status}
          </span>
        </div>
      )}

      {/* Refund row */}
      {needsRefund && (
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 10px',marginBottom:10,borderRadius:8,background:'var(--red-dim)',border:'1px solid rgba(244,63,94,.18)'}}>
          <span style={{fontSize:11,color:'var(--red)'}}>Market cancelled — your stake is refundable</span>
          <button className="btn btn-xs" disabled={refunding} onClick={() => onRefund(m.id)} style={{background:'var(--red)',color:'#fff',border:'none',flexShrink:0}}>
            {refunding ? 'Refunding…' : 'Refund'}
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="mcard-footer">
        <span className="mcard-vol"><b>{weiToGen(m.total_pool)}</b> GEN · <b>{m.total_bets||0}</b> bets</span>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          {isRes && <span style={{ color:'var(--teal)', fontFamily:'var(--mono)', fontWeight:700, fontSize:11 }}>Winner: {m.winner}</span>}
          {isOpen && connected && isOwner && (
            <button className={`resolve-btn${resolving ? ' loading' : ''}`} onClick={() => !resolving && onResolve(m.id)}>
              {resolving ? 'Resolving…' : 'Resolve'}
            </button>
          )}
          {isOpen && isOwner && !confirmCancel && (
            <button className="resolve-btn" style={{borderColor:'rgba(244,63,94,.25)',color:'var(--red)'}} onClick={() => setConfirmCancel(true)}>
              Cancel
            </button>
          )}
          {isOpen && isOwner && confirmCancel && <>
            <span style={{fontSize:10,color:'var(--muted)'}}>Sure?</span>
            <button className="resolve-btn" disabled={cancelling} style={{borderColor:'rgba(244,63,94,.3)',color:'var(--red)',background:'var(--red-dim)'}} onClick={() => { onCancel(m.id); setConfirmCancel(false) }}>
              {cancelling ? 'Cancelling…' : 'Yes, cancel'}
            </button>
            <button className="resolve-btn" onClick={() => setConfirmCancel(false)}>No</button>
          </>}
        </div>
      </div>
    </div>
  )
}
