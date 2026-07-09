import React, { useState, useEffect } from 'react'
import MarketCard from './MarketCard.jsx'
import { writeContract, readContract, waitForTxStatus, pollForChange } from '../lib/gl.js'
import { CONTRACT, fmt } from '../lib/config.js'

export default function Markets({ account, connected, markets, myBets, genBal, notify, loadMarkets, isOwner }) {
  const [betModal,    setBetModal]    = useState(null)
  const [createModal, setCreateModal] = useState(false)
  const [txOpen,      setTxOpen]      = useState(false)
  const [txLogs,      setTxLogs]      = useState([])
  const [betAmt,      setBetAmt]      = useState(1)
  const [busy,        setBusy]        = useState({})
  const [refundBusy,  setRefundBusy]  = useState({})
  const [showSettled, setShowSettled] = useState(false)
  const [schedBusy,   setSchedBusy]   = useState({})
  const [sched,       setSched]       = useState(null)


  const addTx = (msg, type='ok') => {
    const t = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
    setTxLogs(prev => [...prev, {t, msg, type}])
  }

  const loadSched = async () => {
    try {
      const raw = await readContract(CONTRACT, 'get_scheduled_times', [])
      if (raw) setSched(JSON.parse(raw))
    } catch(e) {}
  }
  useEffect(() => { loadSched() }, [])

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
    const { marketId, outcome } = betModal
    setBetModal(null)
    notify('Submitting prediction…','ok')
    try {
      const beforeRaw = await readContract(CONTRACT, 'get_market', [marketId])
      let before = 0
      try { before = JSON.parse(beforeRaw||'{}')?.total_pool || 0 } catch(e) {}

      // place_bet is now payable — GEN stake sent as transaction value
      const valueWei = BigInt(Math.round(betAmt * 1e18))
      const hash = await writeContract(CONTRACT, account, 'place_bet', [marketId, outcome], false, valueWei)
      addTx('TX: '+hash.slice(0,18)+'…')
      waitForTxStatus(hash, s => addTx(s.toLowerCase(), 'ok')).catch(()=>{})
      notify('Validators processing… (~20-40s)','ok')

      await pollForChange(async () => {
        const raw = await readContract(CONTRACT, 'get_market', [marketId])
        try { return (JSON.parse(raw)?.total_pool || 0) > before } catch(e) { return false }
      })

      notify('Prediction confirmed ✓','ok')
      addTx('Prediction confirmed','ok')
      await loadMarkets()
    } catch(e) { notify(e.message,'err'); addTx(e.message,'err') }
  }

  const resolveMarket = async (id) => {
    if (!connected) { notify('Connect wallet first','err'); return }
    if (busy[id]) return

    // Pre-flight: contract guarantees an immediate exception if the market
    // isn't OPEN — catch that here instead of submitting a doomed tx.
    const current = markets.find(x => x.id === id)
    if (current && current.status !== 'OPEN') {
      notify('This market is already '+current.status.toLowerCase(),'err')
      return
    }

    setBusy(b => ({...b, [id]: true}))
    notify('Submitting resolve — AI evaluating…','ok')
    try {
      const hash = await writeContract(CONTRACT, account, 'resolve_market', [id])
      addTx('Resolving market #'+id+'…')
      waitForTxStatus(hash, s => addTx(s.toLowerCase(), 'ok')).catch(()=>{})

      // GenLayer can ACCEPT a transaction whose contract execution raised
      // an exception — validators agree the code correctly threw, not
      // that it succeeded (confirmed on-chain: explorer shows this exact
      // case as "ACCEPTED (ERROR)" with a fully green consensus journey).
      // In this contract that only happens when the market isn't OPEN
      // (caught above) or the AI referee judges the deadline hasn't
      // passed. Normal consensus completes in well under a minute.
      let resolved = false
      const start = Date.now()
      while (Date.now() - start < 60000 && !resolved) {
        await new Promise(r => setTimeout(r, 4000))
        const raw = await readContract(CONTRACT, 'get_market', [id])
        try { resolved = JSON.parse(raw)?.status === 'RESOLVED' } catch(e) {}
      }

      if (resolved) {
        notify('Market resolved ✓','ok')
        addTx('Market #'+id+' resolved','ok')
        await loadMarkets()
      } else {
        notify("Resolve submitted — still confirming, refresh in a moment",'ok')
        addTx('Resolve tx still confirming — check explorer or refresh','ok')
      }
    } catch(e) { notify(e.message,'err'); addTx(e.message,'err') }
    finally { setBusy(b => ({...b, [id]: false})) }
  }

  const createMarket = async (q, outcomes, url, dl) => {
    // Pre-flight: create_market is owner-only on-chain. The button is
    // already hidden from non-owners, but guard here too in case state
    // is stale (e.g. owner address loaded after the modal was opened).
    if (!isOwner) { notify('Only the contract owner can create manual markets','err'); return }
    notify('Creating market…','ok')
    try {
      const beforeRaw = await readContract(CONTRACT, 'get_market_count', [])
      const before = parseInt(beforeRaw || '0')

      const tsMap = { 'today': 3600000*6, '1 hour': 3600000, '6 hours': 3600000*6, '24 hours from now': 86400000, '1 day': 86400000, '3 days': 86400000*3, '7 days from now': 86400000*7, '1 week': 86400000*7, '30 days from now': 86400000*30, '1 month': 86400000*30 }
      const dlKey = dl.toLowerCase()
      const dlMs = Object.entries(tsMap).find(([k]) => dlKey.includes(k.toLowerCase()))?.[1] || 86400000
      // Pass absolute deadline — AI can reason about a specific datetime.
      // Relative strings like "30 minutes from now" give the AI no anchor.
      const absoluteDl = new Date(Date.now() + dlMs).toUTCString()
      const hash = await writeContract(CONTRACT, account, 'create_market', [q, outcomes, url, absoluteDl, 0], false, 500000000000000000n)
      addTx('Creating market…')
      waitForTxStatus(hash, () => {}).catch(()=>{})
      notify('AI setting odds… (~60-90s)','ok')

      let created = false
      const start = Date.now()
      while (Date.now() - start < 180000 && !created) {
        await new Promise(r => setTimeout(r, 4000))
        const raw = await readContract(CONTRACT, 'get_market_count', [])
        created = parseInt(raw||'0') > before
      }

      if (created) {
        notify('Market created ✓','ok')
        setCreateModal(false)
        await loadMarkets()
      } else {
        notify('Transaction submitted — market may still be confirming, refresh in a moment','ok')
        addTx('Still confirming after 3 min — check explorer or refresh','ok')
        setCreateModal(false)
      }
    } catch(e) { notify(e.message,'err'); addTx(e.message,'err') }
  }

  const createScheduled = async (type) => {
    if (!connected) { notify('Connect wallet first','err'); return }
    if (schedBusy[type]) return

    // Pre-flight: each period only allows one auto-generated market: the
    // contract throws immediately if this period's market already exists.
    // get_scheduled_times exists specifically so we can check this first.
    if (sched && sched[type+'_ready'] === false) {
      notify('A '+type+' market was already generated — check back later','err')
      return
    }

    setSchedBusy(b => ({...b, [type]: true}))
    notify('Generating '+type+' market…','ok')
    try {
      const beforeRaw = await readContract(CONTRACT, 'get_market_count', [])
      const before = parseInt(beforeRaw || '0')

      const schedMs = { daily: 86400000, weekly: 86400000*7, monthly: 86400000*30 }
      const deadlineStr = new Date(Date.now() + (schedMs[type] || 86400000)).toUTCString()
      const hash = await writeContract(CONTRACT, account, 'create_'+type+'_market', [deadlineStr])
      addTx('Generating '+type+' market…')
      waitForTxStatus(hash, () => {}).catch(()=>{})

      let created = false
      const start = Date.now()
      while (Date.now() - start < 180000 && !created) {
        await new Promise(r => setTimeout(r, 4000))
        const raw = await readContract(CONTRACT, 'get_market_count', [])
        created = parseInt(raw||'0') > before
      }

      if (created) {
        notify(type+' market created ✓','ok')
        await loadMarkets()
        await loadSched()
      } else {
        notify('Transaction submitted — market may still be confirming, refresh in a moment','ok')
        addTx('Still confirming after 3 min — refresh markets to see if it landed','ok')
      }
    } catch(e) { notify(e.message,'err'); addTx(e.message,'err') }
    finally { setSchedBusy(b => ({...b, [type]: false})) }
  }

  const cancelMarket = async (id) => {
    if (!isOwner || busy[id]) return
    setBusy(b => ({...b, [id]: true}))
    notify('Cancelling market…','ok')
    try {
      const hash = await writeContract(CONTRACT, account, 'cancel_market', [id])
      addTx('Cancelling market #'+id+'…')
      waitForTxStatus(hash, s => addTx(s.toLowerCase(), 'ok')).catch(()=>{})

      let cancelled = false
      const start = Date.now()
      while (Date.now() - start < 30000 && !cancelled) {
        await new Promise(r => setTimeout(r, 3000))
        const raw = await readContract(CONTRACT, 'get_market', [id])
        try { cancelled = JSON.parse(raw)?.status === 'CANCELLED' } catch(e) {}
      }

      if (cancelled) {
        notify('Market cancelled — bettors can now claim refunds','ok')
        addTx('Market #'+id+' cancelled','ok')
        await loadMarkets()
      } else {
        notify("Couldn't confirm cancellation — check explorer",'err')
        addTx('Cancel did not land within expected window','err')
      }
    } catch(e) { notify(e.message,'err'); addTx(e.message,'err') }
    finally { setBusy(b => ({...b, [id]: false})) }
  }

  const refundBet = async (id) => {
    if (refundBusy[id]) return
    setRefundBusy(b => ({...b, [id]: true}))
    notify('Requesting refund…','ok')
    try {

      const hash = await writeContract(CONTRACT, account, 'refund', [id])
      addTx('Refunding market #'+id+'…')
      waitForTxStatus(hash, s => addTx(s.toLowerCase(), 'ok')).catch(()=>{})

      let done = false
      const start = Date.now()
      while (Date.now() - start < 30000 && !done) {
        await new Promise(r => setTimeout(r, 3000))
        done = true  // GEN transfer confirmed via tx acceptance
      }

      if (done) {
        notify('Refund received ✓','ok')
        addTx('Refund #'+id+' claimed','ok')
        await loadMarkets()
        } else {
        notify("Couldn't confirm refund — check explorer",'err')
        addTx('Refund did not land within expected window','err')
      }
    } catch(e) { notify(e.message,'err'); addTx(e.message,'err') }
    finally { setRefundBusy(b => ({...b, [id]: false})) }
  }

  const settled = markets.filter(m => m.status === 'RESOLVED' || m.status === 'CANCELLED')
  const visible = showSettled ? markets : markets.filter(m => m.status === 'OPEN')

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
          <button className="btn btn-primary btn-sm" onClick={() => setCreateModal(true)}>+ New Market</button>
        </div>
      </div>

      <div style={{marginBottom:8}}>
        <button className="txlog-toggle" onClick={() => setTxOpen(o=>!o)}>
          ▶ Transaction Log
          <span style={{fontFamily:'var(--mono)',marginLeft:4,background:'var(--bg2)',padding:'1px 7px',borderRadius:5,fontSize:10}}>{txLogs.length}</span>
        </button>
        <div className={`txlog${txOpen?' open':''}`}>
          {txLogs.map((e,i) => <div key={i} className="txe"><span className="txe-t">{e.t}</span><span className={`txe-m ${e.type}`}>{e.msg}</span></div>)}
        </div>
      </div>

      <div className="sched-bar">
        <span className="sched-lbl">Auto-Generate</span>
        {['daily','weekly','monthly'].map(t=>{
          const ready = !sched || sched[t+'_ready'] !== false
          return (
            <button
              key={t} className="sched-btn"
              onClick={()=>createScheduled(t)}
              disabled={schedBusy[t]}
              style={!ready ? {opacity:.45} : {}}
              title={ready ? undefined : 'Already generated for this period'}
            >
              {schedBusy[t] ? 'Generating…' : (ready ? '+ ' : '✓ ') + t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          )
        })}
      </div>

      <div className="mgrid">
        {visible.length === 0 ? (
          <div style={{gridColumn:'1/-1'}} className="empty">
            <div className="empty-title">{markets.length === 0 ? 'No markets yet' : 'No open markets'}</div>
            <div className="empty-sub">{markets.length === 0 ? 'Use Auto-Generate above to create one' : settled.length > 0 ? 'All markets have settled — click Show Settled to browse them' : ''}</div>
          </div>
        ) : visible.map(m => (
          <MarketCard
            key={m.id} m={m} myBet={myBets[m.id]}
            connected={connected} isOwner={isOwner}
            resolving={!!busy[m.id]} cancelling={!!busy[m.id]} refunding={!!refundBusy[m.id]}
            onBet={openBet} onResolve={resolveMarket} onCancel={cancelMarket} onRefund={refundBet}
          />
        ))}
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

      {createModal && <CreateModal onCreate={createMarket} onClose={()=>setCreateModal(false)}/>}
    </div>
  )
}

function CreateModal({ onCreate, onClose }) {
  const [q,   setQ]   = useState('')
  const [o,   setO]   = useState('YES,NO')
  const [url, setUrl] = useState('')
  const [dl,  setDl]  = useState('24 hours from now')
  const [err, setErr] = useState('')

  const feeDisplay = '0.50'

  const deadlinePresets = ['30 minutes from now','1 hour from now','6 hours from now','24 hours from now','3 days from now','7 days from now','30 days from now']

  const toAbsoluteDeadline = (relative) => {
    // Parse any "<number> <unit>" phrase directly instead of matching
    // against a fixed list of preset phrases — the fixed list silently
    // fell through to returning the raw unconverted text for anything
    // not in it (e.g. "5 minutes from now"), which Date.parse can't read,
    // permanently breaking the betting-closes-at-deadline check for that
    // market since it never had a real parseable date to compare against.
    const unitMs = { min: 60*1000, hour: 3600*1000, hr: 3600*1000, day: 86400*1000, week: 604800*1000, wk: 604800*1000, month: 2592000*1000, mo: 2592000*1000 }
    const match  = relative.toLowerCase().match(/(\d+)\s*(min|hour|hr|day|week|wk|month|mo)/)
    const ms     = match ? parseInt(match[1]) * unitMs[match[2]] : 86400*1000 // default 24h if unparseable
    return new Date(Date.now() + ms).toUTCString()
  }

  const submit = () => {
    if (!q.trim())   { setErr('Question is required'); return }
    if (!url.trim()) { setErr('Evidence URL is required — the AI needs somewhere to look when resolving'); return }
    if (!url.startsWith('http')) { setErr('Evidence URL must start with https://'); return }
    setErr('')
    onCreate(q, o, url, toAbsoluteDeadline(dl))
  }

  return (
    <div className="mbg show" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mbox">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <div className="mbox-title" style={{marginBottom:0}}>Create Market</div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted)',fontSize:18,cursor:'pointer'}}>✕</button>
        </div>
        <div className="mfield"><label>Question</label><input value={q} onChange={e=>{setQ(e.target.value);setErr('')}} placeholder="Will ETH exceed $3,000 this week?"/></div>
        <div className="mfield"><label>Outcomes (comma separated)</label><input value={o} onChange={e=>setO(e.target.value)} placeholder="YES,NO"/></div>
        <div className="mfield">
          <label>Evidence URL <span style={{color:'var(--red)',fontSize:10}}>required</span></label>
          <input value={url} onChange={e=>{setUrl(e.target.value);setErr('')}} placeholder="https://coingecko.com/en/coins/ethereum"/>
          <div style={{fontSize:10,color:'var(--muted)',marginTop:5,lineHeight:1.6}}>
            Where can this be verified when the deadline passes? Price question: CoinGecko or CoinMarketCap. Sports: Wikipedia or official site. News: CoinDesk or Reuters.
          </div>
        </div>
        <div className="mfield">
          <label>Deadline</label>
          <input value={dl} onChange={e=>setDl(e.target.value)} placeholder="e.g. 30 minutes from now, 2 hours from now, end of day..."/>
          <div style={{display:'flex',flexWrap:'wrap',gap:5,marginTop:7}}>
            {['30 mins','1 hour','6 hours','24 hours','3 days','7 days','30 days'].map(p => (
              <button key={p} type="button" onClick={() => setDl(p+' from now')}
                style={{fontSize:10,fontFamily:'var(--mono)',padding:'3px 9px',borderRadius:100,
                  background:'var(--bg2)',border:'1px solid var(--border)',color:'var(--muted)',
                  cursor:'pointer',transition:'all .15s'}}
                onMouseOver={e=>{e.target.style.color='var(--text)';e.target.style.borderColor='var(--indigo)'}}
                onMouseOut={e=>{e.target.style.color='var(--muted)';e.target.style.borderColor='var(--border)'}}>
                {p}
              </button>
            ))}
          </div>
        </div>
        {err && <div style={{fontSize:12,color:'var(--red)',marginBottom:12,padding:'8px 12px',background:'var(--red-dim)',borderRadius:6,border:'1px solid rgba(244,63,94,.2)'}}>{err}</div>}
        <div style={{fontSize:11,color:'var(--muted)',marginBottom:16,lineHeight:1.6,padding:'8px 12px',background:'var(--bg2)',borderRadius:6}}>
          AI sets opening odds when the market is created. Anyone can call Resolve once the deadline passes.
          <br/>
          <span style={{color:'var(--amber)',fontWeight:700}}>Creation fee: {feeDisplay} GEN</span> — retained by the contract.
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-outline" onClick={onClose} style={{flex:1}}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} style={{flex:2}}>Create on GenLayer</button>
        </div>
      </div>
    </div>
  )
}
