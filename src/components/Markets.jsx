import React, { useState, useEffect } from 'react'
import MarketCard from './MarketCard.jsx'
import { writeContract, readContract, pollForChange } from '../lib/gl.js'
import { CONTRACT, EXPLORER } from '../lib/config.js'

export default function Markets({ account, connected, markets, myBets, genBal, notify, loadMarkets, isOwner, canManage }) {
  const [betModal,    setBetModal]    = useState(null)
  const [txOpen,      setTxOpen]      = useState(false)
  const [txLogs,      setTxLogs]      = useState([])
  const [betAmt,      setBetAmt]      = useState(1)
  const [busy,        setBusy]        = useState({})
  const [refreshBusy, setRefreshBusy] = useState({})
  const [refundBusy,  setRefundBusy]  = useState({})
  const [showSettled, setShowSettled] = useState(false)
  const [typeFilter,  setTypeFilter]  = useState('all')
  const [catFilter,   setCatFilter]   = useState('all')
  const [sortBy,       setSortBy]     = useState('closing')


  // Structured tx-log entries (market / type / outcome / amount / status /
  // txHash) rather than free-text lines, so the log can render as a table.
  // addTx returns the row id, callers use it with updateTx to flip a row
  // from Pending -> Confirmed/Failed once the write actually lands, instead
  // of appending a second row for the same transaction.
  const addTx = (entry) => {
    const id = Date.now() + Math.random()
    const t = new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'UTC' }) + ' UTC'
    setTxLogs(prev => [{ id, t, status: 'Pending', ...entry }, ...prev])
    return id
  }
  const updateTx = (id, patch) => {
    setTxLogs(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }
  // Full questions run long ("Will the price of Dogecoin (DOGE) close
  // above $0.80 on August 9, 2026?"), truncate for the MARKET column.
  const shortQ = (q, id) => {
    if (!q) return 'Market #' + id
    return q.length > 46 ? q.slice(0, 46).trim() + '…' : q
  }

  const openBet = (marketId, outcome) => {
    if (!connected) { notify('Connect wallet first','err'); return }
    const m = markets.find(x => x.id === marketId)
    if (!m || m.status !== 'OPEN') return
    setBetModal({ marketId, outcome: outcome || m.outcomes[0], market: m })
    setBetAmt(1)
  }

  const confirmBet = async () => {
    if (!betModal) return
    if (betAmt < 0.1)    { notify('Minimum 0.1 GEN','err'); return }
    const { marketId, outcome, market } = betModal
    setBetModal(null)
    notify('Submitting prediction…','ok')
    const marketLabel = shortQ(market?.question, marketId)
    let txId
    try {
      const beforeRaw = await readContract(CONTRACT, 'get_market', [marketId])
      let before = 0
      try { before = JSON.parse(beforeRaw||'{}')?.total_pool || 0 } catch(e) {}

      // place_bet is now payable, GEN stake sent as transaction value
      const valueWei = BigInt(Math.round(betAmt * 1e18))
      const hash = await writeContract(CONTRACT, account, 'place_bet', [marketId, outcome], false, valueWei)
      txId = addTx({ market: marketLabel, type: 'Bet', outcome, amount: betAmt+' GEN', txHash: hash })
      notify('Validators processing… (~20-40s)','ok')

      await pollForChange(async () => {
        const raw = await readContract(CONTRACT, 'get_market', [marketId])
        try { return (JSON.parse(raw)?.total_pool || 0) > before } catch(e) { return false }
      })

      notify('Prediction confirmed ✓','ok')
      updateTx(txId, { status: 'Confirmed' })
      await loadMarkets()
    } catch(e) {
      notify(e.message,'err')
      if (txId) updateTx(txId, { status: 'Failed' })
      else addTx({ market: marketLabel, type: 'Bet', outcome, amount: betAmt+' GEN', status: 'Failed' })
    }
  }

  const resolveMarket = async (id) => {
    if (!connected) { notify('Connect wallet first','err'); return }
    if (busy[id]) return

    // Pre-flight: contract guarantees an immediate exception if the market
    // isn't OPEN, catch that here instead of submitting a doomed tx.
    const current = markets.find(x => x.id === id)
    if (current && current.status !== 'OPEN') {
      notify('This market is already '+current.status.toLowerCase(),'err')
      return
    }

    const marketLabel = shortQ(current?.question, id)
    setBusy(b => ({...b, [id]: true}))
    notify('Submitting resolve, AI evaluating…','ok')
    let txId
    try {
      const hash = await writeContract(CONTRACT, account, 'resolve_market', [id])
      txId = addTx({ market: marketLabel, type: 'Resolve', txHash: hash })

      // GenLayer can ACCEPT a transaction whose contract execution raised
      // an exception, validators agree the code correctly threw, not
      // that it succeeded (confirmed on-chain: explorer shows this exact
      // case as "ACCEPTED (ERROR)" with a fully green consensus journey).
      // In this contract that only happens when the market isn't OPEN
      // (caught above) or the AI referee judges the deadline hasn't
      // passed. Normal consensus completes in well under a minute.
      let resolved = false
      let winner = null
      const start = Date.now()
      while (Date.now() - start < 60000 && !resolved) {
        await new Promise(r => setTimeout(r, 4000))
        const raw = await readContract(CONTRACT, 'get_market', [id])
        try { const j = JSON.parse(raw); resolved = j?.status === 'RESOLVED'; winner = j?.winner } catch(e) {}
      }

      if (resolved) {
        notify('Market resolved ✓','ok')
        updateTx(txId, { status: 'Confirmed', outcome: winner || undefined })
        await loadMarkets()
      } else {
        notify("Resolve submitted, still confirming, refresh in a moment",'ok')
        updateTx(txId, { status: 'Pending' })
      }
    } catch(e) { notify(e.message,'err'); if (txId) updateTx(txId, { status: 'Failed' }) }
    finally { setBusy(b => ({...b, [id]: false})) }
  }

  const refreshOdds = async (id) => {
    if (!connected) { notify('Connect wallet first','err'); return }
    if (refreshBusy[id]) return

    const current = markets.find(x => x.id === id)
    if (current && current.status !== 'OPEN') {
      notify('Can only refresh odds on an open market','err')
      return
    }

    const marketLabel = shortQ(current?.question, id)
    setRefreshBusy(b => ({...b, [id]: true}))
    notify('Refreshing odds, AI reading live evidence…','ok')
    let txId
    try {
      const hash = await writeContract(CONTRACT, account, 'refresh_odds', [id])
      txId = addTx({ market: marketLabel, type: 'Refresh Odds', txHash: hash })

      // Same pattern as resolve, poll actual state rather than trust tx
      // status alone, since ACCEPTED doesn't always mean the write landed
      // in time for a subsequent read.
      await new Promise(r => setTimeout(r, 8000))
      await loadMarkets()
      notify('Odds refreshed ✓, existing bets untouched','ok')
      updateTx(txId, { status: 'Confirmed' })
    } catch(e) { notify(e.message,'err'); if (txId) updateTx(txId, { status: 'Failed' }) }
    finally { setRefreshBusy(b => ({...b, [id]: false})) }
  }

  const cancelMarket = async (id) => {
    if (!canManage || busy[id]) return
    const current = markets.find(x => x.id === id)
    const marketLabel = shortQ(current?.question, id)
    setBusy(b => ({...b, [id]: true}))
    notify('Cancelling market…','ok')
    let txId
    try {
      const hash = await writeContract(CONTRACT, account, 'cancel_market', [id])
      txId = addTx({ market: marketLabel, type: 'Cancel', txHash: hash })

      let cancelled = false
      const start = Date.now()
      while (Date.now() - start < 30000 && !cancelled) {
        await new Promise(r => setTimeout(r, 3000))
        const raw = await readContract(CONTRACT, 'get_market', [id])
        try { cancelled = JSON.parse(raw)?.status === 'CANCELLED' } catch(e) {}
      }

      if (cancelled) {
        notify('Market cancelled, bettors can now claim refunds','ok')
        updateTx(txId, { status: 'Confirmed' })
        await loadMarkets()
      } else {
        notify("Couldn't confirm cancellation, check explorer",'err')
        updateTx(txId, { status: 'Pending' })
      }
    } catch(e) { notify(e.message,'err'); if (txId) updateTx(txId, { status: 'Failed' }) }
    finally { setBusy(b => ({...b, [id]: false})) }
  }

  const refundBet = async (id) => {
    if (refundBusy[id]) return
    const current = markets.find(x => x.id === id)
    const marketLabel = shortQ(current?.question, id)
    const bet = myBets[id]
    const amountLabel = bet ? (Number(bet.amount)/1e18).toFixed(4).replace(/\.?0+$/,'')+' GEN' : undefined
    setRefundBusy(b => ({...b, [id]: true}))
    notify('Requesting refund…','ok')
    let txId
    try {
      const hash = await writeContract(CONTRACT, account, 'refund', [id])
      txId = addTx({ market: marketLabel, type: 'Refund', outcome: bet?.outcome, amount: amountLabel, txHash: hash })

      // No polling here, unlike resolve/cancel/create. A refund is a
      // direct GEN transfer with no separate status field to check, so
      // once the tx is accepted the transfer already happened, this is
      // just a short pause before refreshing the list, not a real check.
      await new Promise(r => setTimeout(r, 3000))

      notify('Refund received ✓','ok')
      updateTx(txId, { status: 'Confirmed' })
      await loadMarkets()
    } catch(e) { notify(e.message,'err'); if (txId) updateTx(txId, { status: 'Failed' }) }
    finally { setRefundBusy(b => ({...b, [id]: false})) }
  }

  const settled = markets.filter(m => m.status === 'RESOLVED' || m.status === 'CANCELLED')
  const visible = (showSettled ? markets : markets.filter(m => m.status === 'OPEN'))
    .filter(m => typeFilter === 'all' || m.schedule_type === typeFilter)
    .filter(m => catFilter  === 'all' || m.category === catFilter)
    .slice()
    .sort((a, b) => {
      if (sortBy === 'closing') {
        const ta = Date.parse(a.deadline) || Infinity
        const tb = Date.parse(b.deadline) || Infinity
        return ta - tb
      }
      if (sortBy === 'newest')  return b.id - a.id
      if (sortBy === 'volume')  return (Number(b.total_pool)||0) - (Number(a.total_pool)||0)
      if (sortBy === 'bets')    return (b.total_bets||0) - (a.total_bets||0)
      return 0
    })

  return (
    <div className="wrap">
      <div className="page-head">
        <div className="page-title">Markets</div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {settled.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={() => setShowSettled(s=>!s)}>
              {showSettled ? 'Hide Settled' : `Show Settled (${settled.length})`}
            </button>
          )}
        </div>
      </div>

      <div className="filter-toolbar">
        <div className="filter-toolbar-row">
          <span className="sched-lbl">Type</span>
          {['all','daily','weekly','monthly','manual'].map(t => (
            <button
              key={t} className={`sched-btn${typeFilter===t?' on':''}`}
              onClick={()=>setTypeFilter(t)}
            >
              {t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          ))}
        </div>
        <div className="filter-toolbar-row">
          <span className="sched-lbl">Category</span>
          {[['all','All'],['crypto','₿ Crypto'],['sports','⚽ Sports'],['other','◈ Other']].map(([c,label]) => (
            <button
              key={c} className={`sched-btn${catFilter===c?' on':''}`}
              onClick={()=>setCatFilter(c)}
            >
              {label}
            </button>
          ))}
        </div>
        <select className="sort-select" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
          <option value="closing">Sort: Closing Soonest</option>
          <option value="newest">Sort: Newest</option>
          <option value="volume">Sort: Highest Volume</option>
          <option value="bets">Sort: Most Bets</option>
        </select>
      </div>

      <div className="mgrid">
        {visible.length === 0 ? (
          <div style={{gridColumn:'1/-1'}} className="empty">
            <div className="empty-title">{markets.length === 0 ? 'No markets yet' : (typeFilter!=='all'||catFilter!=='all') ? 'No markets match these filters' : 'No open markets'}</div>
            <div className="empty-sub">{markets.length === 0 ? 'Check back soon, or ask an admin to create one' : (typeFilter!=='all'||catFilter!=='all') ? 'Try a different filter above' : settled.length > 0 ? 'All markets have settled, click Show Settled to browse them' : ''}</div>
          </div>
        ) : visible.map(m => (
          <MarketCard
            key={m.id} m={m} myBet={myBets[m.id]}
            connected={connected} canManage={canManage}
            resolving={!!busy[m.id]} cancelling={!!busy[m.id]} refunding={!!refundBusy[m.id]}
            refreshingOdds={!!refreshBusy[m.id]}
            onBet={openBet} onResolve={resolveMarket} onCancel={cancelMarket} onRefund={refundBet}
            onRefreshOdds={refreshOdds}
          />
        ))}
      </div>

      <div className="txlog-card">
        <div className="txlog-head">
          <div className="txlog-title">
            <span className="txlog-icon">☰</span> Transaction Log
            <span className="txlog-count">{txLogs.length}</span>
          </div>
          {txLogs.length > 5 && (
            <button className="txlog-viewall" onClick={() => setTxOpen(o=>!o)}>
              {txOpen ? 'Show less' : 'View all'} <span className={`txlog-chev${txOpen?' up':''}`}>⌄</span>
            </button>
          )}
        </div>

        {txLogs.length === 0 ? (
          <div className="txlog-empty">No transactions yet, bets and market actions will show up here</div>
        ) : (
          <div className="txlog-table-wrap">
            <table className="txlog-table">
              <thead>
                <tr>
                  <th>Time</th><th>Market</th><th>Type</th><th>Outcome</th><th>Amount</th><th>Status</th><th>Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {(txOpen ? txLogs : txLogs.slice(0,5)).map(e => (
                  <tr key={e.id}>
                    <td className="txlog-t">{e.t}</td>
                    <td className="txlog-market">{e.market || '—'}</td>
                    <td><span className={`txlog-badge type-${(e.type||'').toLowerCase().replace(/\s+/g,'-')}`}>{e.type}</span></td>
                    <td>{e.outcome ? <span className={`txlog-badge outcome-${e.outcome.toLowerCase()==='yes'?'yes':e.outcome.toLowerCase()==='no'?'no':'other'}`}>{e.outcome}</span> : <span className="txlog-dash">—</span>}</td>
                    <td className="txlog-amount">{e.amount || <span className="txlog-dash">—</span>}</td>
                    <td><span className={`txlog-badge status-${(e.status||'pending').toLowerCase()}`}>{e.status || 'Pending'}</span></td>
                    <td>
                      {e.txHash ? (
                        <a className="txlog-hash" href={`${EXPLORER}/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                          {e.txHash.slice(0,6)}…{e.txHash.slice(-4)} <span className="txlog-ext">↗</span>
                        </a>
                      ) : <span className="txlog-dash">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {betModal && (
        <div className="mbg show" onClick={e=>e.target===e.currentTarget&&setBetModal(null)}>
          <div className="mbox">
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
              <div className="mbox-title" style={{marginBottom:0}}>Predict: {betModal.outcome}</div>
              <button onClick={() => setBetModal(null)} style={{background:'none',border:'none',color:'var(--muted)',fontSize:18,cursor:'pointer'}}>✕</button>
            </div>
            <div style={{fontSize:13,color:'var(--text3)',marginBottom:10,lineHeight:1.5,padding:'10px 12px',background:'var(--bg2)',borderRadius:8,border:'1px solid var(--border)'}}>{betModal.market?.question}</div>
            <div style={{fontSize:12,color:'var(--muted)',marginBottom:10,fontFamily:'var(--mono)'}}>Balance: {genBal?.toFixed(4) || '0.0000'} GEN</div>
            <div className="mfield">
              <label>Amount (GEN)</label>
              <input type="number" value={betAmt} min="0.1" step="0.1" onChange={e=>setBetAmt(parseFloat(e.target.value)||0)}/>
            </div>
            {betAmt > 0 && betModal.market && (() => {
              const i=(betModal.market.outcomes||[]).indexOf(betModal.outcome)
              const prob=betModal.market.ai_probs?.[i]||50
              const est=Math.floor(betAmt*100/Math.max(1,prob))
              return <div className="bet-payout-callout">If {betModal.outcome} ({prob}%) wins → <strong>{est} GEN</strong></div>
            })()}
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-outline" onClick={()=>setBetModal(null)} style={{flex:1}}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmBet} style={{flex:2}}>Confirm Prediction</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
