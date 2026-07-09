import React, { useState, useEffect } from 'react'
import { readContract, writeContract } from '../lib/gl.js'
import { CONTRACT, EXPLORER, sh, fmt } from '../lib/config.js'

function getRank(xp) {
  if (xp >= 5000) return { label: 'Legend',  color: '#E37DF7', bg: 'rgba(227,125,247,.12)' }
  if (xp >= 1500) return { label: 'Whale',   color: '#F5C518', bg: 'rgba(245,197,24,.12)' }
  if (xp >= 500)  return { label: 'Shark',   color: '#14B8A6', bg: 'rgba(20,184,166,.12)' }
  if (xp >= 100)  return { label: 'Trader',  color: '#6366F1', bg: 'rgba(99,102,241,.12)' }
  return                  { label: 'Rookie',  color: '#9CA3AF', bg: 'rgba(156,163,175,.12)' }
}

const AvatarIcon = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity=".7">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
)

export default function Profile({ account, connected, genBal, username, markets, notify, setUsername, onConnect, loadGenBal }) {
  const [bets,    setBets]    = useState([])
  const [stats,   setStats]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [editOpen,setEditOpen]= useState(false)
  const [sendOpen,setSendOpen]= useState(false)

  useEffect(() => {
    if (connected && account) { loadBets(); loadStats() }
  }, [connected, account])

  const loadBets = async () => {
    setLoading(true)
    try {
      const raw = await readContract(CONTRACT, 'get_my_bets_all', [account])
      if (raw) { const l = JSON.parse(raw); if (Array.isArray(l)) setBets(l) }
    } catch(e) {}
    setLoading(false)
  }

  const loadStats = async () => {
    try {
      const raw = await readContract(CONTRACT, 'get_user_stats', [account])
      if (raw) setStats(JSON.parse(raw))
    } catch(e) {}
  }

  const claimWinnings = async (betId) => {
    try {
      await writeContract(CONTRACT, account, 'claim_winnings', [parseInt(betId)])
      notify('Claiming…', 'ok')
      await new Promise(r => setTimeout(r, 6000))
      await loadBets()
      notify('Winnings claimed — allow ~30 min for finality to fully reflect in your wallet', 'ok')
    } catch(e) { notify(e.message, 'err') }
  }

  if (!connected) {
    return (
      <div className="wrap">
        <div className="gate">
          <div className="gate-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.8" strokeLinecap="round">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div className="gate-title">Connect your wallet</div>
          <div className="gate-sub">Connect MetaMask to view your profile, track predictions, and earn XP.</div>
          <button className="btn btn-primary" onClick={onConnect}>Connect Wallet</button>
        </div>
      </div>
    )
  }

  const active = bets.filter(b => b.status === 'OPEN').length
  const sWins  = stats?.wins   ?? 0
  const sLoss  = stats?.losses ?? 0
  const sTotal = sWins + sLoss
  const wr     = sTotal > 0 ? Math.round(sWins / sTotal * 100) : 0
  const xp     = stats?.xp ?? 0
  const streak = stats?.streak ?? 0
  const best   = stats?.best_streak ?? 0
  const rank   = getRank(xp)

  const betStatusColor = (s) => s === 'WON' || s === 'CLAIMED' ? 'var(--green)' : s === 'LOST' ? 'var(--red)' : 'var(--blue)'

  return (
    <div>
      <div className="wrap">
        {/* Hero */}
        <div className="p-hero">
          <div className="p-hero-inner">
            <div className="p-avatar"><AvatarIcon /></div>
            <div style={{ flex:1, minWidth:160 }}>
              <div className="p-name">{username || sh(account)}</div>
              <div className="p-addr-row">
                <span className="p-addr">{sh(account)}</span>
                <button className="p-addr-btn" onClick={() => navigator.clipboard.writeText(account).then(() => notify('Copied','ok'))}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                </button>
                <a href={`${EXPLORER}/address/${account}`} target="_blank" rel="noreferrer" className="p-addr-btn">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
                </a>
              </div>
              <div className="p-tags">
                <span className="p-tag">Bradbury</span>
                <span className="p-tag">{genBal.toFixed(4)} GEN</span>
                {username && <span className="p-tag">@{username}</span>}
              </div>
              <span style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:8,fontSize:11,fontWeight:700,letterSpacing:'.08em',padding:'4px 12px',borderRadius:100,border:'1px solid rgba(255,255,255,.15)',background:'rgba(255,255,255,.1)',color:'#fff'}}>
                <span style={{width:7,height:7,borderRadius:'50%',background:rank.color,flexShrink:0}}/>{rank.label}
              </span>
            </div>
            <div style={{display:'flex',gap:8,flexShrink:0}}>
              <button className="btn btn-sm" style={{background:'rgba(255,255,255,.1)',border:'1px solid rgba(255,255,255,.15)',color:'rgba(255,255,255,.8)',fontSize:12}} onClick={() => setSendOpen(true)}>
                Send
              </button>
              <button className="btn btn-sm" style={{background:'rgba(255,255,255,.1)',border:'1px solid rgba(255,255,255,.15)',color:'rgba(255,255,255,.8)',fontSize:12}} onClick={() => setEditOpen(true)}>
                Edit
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="p-stats">
          <div className="p-stat">
            <div className="p-stat-label">GEN Balance</div>
            <div className="p-stat-val">{genBal.toFixed(4)}</div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}>
              <div className="p-stat-sub" style={{marginTop:0}}>GenLayer Bradbury</div>
              <a href="https://testnet-faucet.genlayer.foundation/" target="_blank" rel="noreferrer" title="Get testnet GEN from faucet"
                style={{display:'flex',alignItems:'center',color:'var(--indigo)',opacity:.8,transition:'opacity .15s'}}
                onMouseOver={e=>e.currentTarget.style.opacity=1}
                onMouseOut={e=>e.currentTarget.style.opacity=.8}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                  <path d="M8 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4"/>
                  <path d="M12 16v2M12 6v2"/>
                  <path d="M15 9l1.5-1.5M7.5 15.5L9 14"/>
                </svg>
              </a>
            </div>
          </div>
          <div className="p-stat">
            <div className="p-stat-label">Win rate</div>
            <div className="p-stat-val" style={{ color: wr >= 50 ? 'var(--green)' : 'var(--red)' }}>{wr}%</div>
            <div className="p-stat-sub">{sWins}W / {sLoss}L · markets + games</div>
          </div>
          <div className="p-stat">
            <div className="p-stat-label">XP</div>
            <div className="p-stat-val">{fmt(xp)}</div>
            <div className="p-stat-sub">{streak > 0 ? streak+' win streak' : 'Best: '+best}</div>
          </div>
          <div className="p-stat">
            <div className="p-stat-label">Predictions</div>
            <div className="p-stat-val">{bets.length}</div>
            <div className="p-stat-sub">{active} active</div>
          </div>
        </div>

        {/* Predictions */}
        <div className="bets-wrap">
          <div className="bets-header">
            <div className="bets-title">Predictions</div>
            {loading && <span style={{fontSize:12,color:'var(--muted)'}}>Loading…</span>}
          </div>
          {!loading && bets.length === 0 ? (
            <div style={{padding:'40px 20px',textAlign:'center'}}>
              <div style={{fontSize:13,color:'var(--text3)',fontWeight:500}}>No predictions yet</div>
              <div style={{fontSize:12,color:'var(--muted)',marginTop:4}}>Head to Markets to make your first prediction</div>
            </div>
          ) : bets.map(b => {
            const mkt = markets.find(x => x.id === b.id) || {}
            return (
              <div key={b.id} className="bet-row">
                <span className="bet-status" style={{color:betStatusColor(b.status)}}>{b.status}</span>
                <span style={{flex:1,fontSize:12.5,color:'var(--text2)',lineHeight:1.4}}>
                  {(mkt.question || 'Market #'+b.id).slice(0,72)}{(mkt.question||'').length>72?'…':''}
                </span>
                <span style={{fontSize:11.5,fontFamily:'var(--mono)',color:'var(--text3)',whiteSpace:'nowrap'}}>
                  {b.outcome} · {((Number(b.amount)||0)/1e18).toFixed(4).replace(/\.?0+$/,'')||'0'} GEN
                </span>
                {b.status === 'WON' && (
                  <button onClick={() => claimWinnings(b.id)} className="btn btn-xs" style={{background:'var(--green-dim)',border:'1px solid rgba(5,150,105,.25)',color:'var(--green)',flexShrink:0}}>
                    Claim
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {editOpen && <EditModal account={account} username={username} notify={notify} onSave={setUsername} onClose={() => setEditOpen(false)} />}
      {sendOpen && <SendModal account={account} genBal={genBal} notify={notify} loadGenBal={loadGenBal} onClose={() => setSendOpen(false)} />}
    </div>
  )
}

function SendModal({ account, genBal, notify, loadGenBal, onClose }) {
  const [to, setTo]     = useState('')
  const [amt, setAmt]   = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    const recipient = to.trim()
    if (!recipient) { notify('Enter an address or username','err'); return }
    const val = parseFloat(amt)
    if (!val || val <= 0) { notify('Enter an amount','err'); return }
    if (val > genBal) { notify('Insufficient GEN balance','err'); return }

    setBusy(true)
    try {
      const valueWei = BigInt(Math.round(val * 1e18))
      const hash = await writeContract(CONTRACT, account, 'send_gen', [recipient], false, valueWei)
      notify('Sending…','ok')

      // Drive completion off real balance change, same pattern proven
      // working elsewhere in the app — poll actual state, not tx status
      const before = genBal
      let confirmed = false
      const start = Date.now()
      while (Date.now() - start < 60000 && !confirmed) {
        await new Promise(r => setTimeout(r, 4000))
        try {
          const r = await window.ethereum.request({ method: 'eth_getBalance', params: [account, 'latest'] })
          const bal = parseFloat(BigInt(r).toString()) / 1e18
          if (bal < before - val + 0.001) confirmed = true
        } catch(e) {}
      }

      if (confirmed) {
        notify(val + ' GEN sent ✓','ok')
        loadGenBal && loadGenBal()
        onClose()
      } else {
        notify('Still confirming — check explorer for tx '+hash.slice(0,10)+'…','ok')
      }
    } catch(e) { notify(e.message,'err') }
    finally { setBusy(false) }
  }

  return (
    <div className="mbg show" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="mbox">
        <div className="mbox-title">Send GEN</div>
        <div className="mfield">
          <label>Recipient — address or @username</label>
          <input value={to} onChange={e => setTo(e.target.value)} placeholder="0x... or @username"/>
        </div>
        <div className="mfield">
          <label>Amount (GEN)</label>
          <input type="number" step="0.0001" value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.5"/>
        </div>
        <div style={{ fontSize:12, color:'var(--muted)', marginBottom:16, fontFamily:'var(--mono)' }}>Balance: {genBal.toFixed(4)} GEN</div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-outline" onClick={onClose} style={{ flex:1 }} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={send} style={{ flex:1 }} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  )
}

function EditModal({ account, username, notify, onSave, onClose }) {
  const [name, setName] = useState(username || '')
  const claim = async () => {
    if (name.length < 3 || name.length > 20) { notify('3-20 characters', 'err'); return }
    if (!/^[a-zA-Z0-9_]+$/.test(name)) { notify('Letters, numbers, underscores only', 'err'); return }
    try {
      await writeContract(CONTRACT, account, 'set_username', [name])
      onSave(name); notify('@' + name + ' claimed', 'ok'); onClose()
    } catch(e) { notify(e.message, 'err') }
  }
  return (
    <div className="mbg show" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="mbox">
        <div className="mbox-title">Edit Profile</div>
        <div className="mfield">
          <label>Username (on-chain)</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="3-20 characters"/>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-outline" onClick={onClose} style={{flex:1}}>Cancel</button>
          <button className="btn btn-primary" onClick={claim} style={{flex:1}}>Claim Username</button>
        </div>
      </div>
    </div>
  )
}
