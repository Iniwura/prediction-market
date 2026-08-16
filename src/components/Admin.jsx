import React, { useState, useEffect } from 'react'
import { readContract, writeContract, waitForTxStatus, pollForChange } from '../lib/gl.js'
import { CONTRACT, sh, genToWei, weiToGen } from '../lib/config.js'

export default function Admin({ account, connected, onConnect, notify, admins, loadAdmins, isOwner, isAdmin, canManage, markets, loadMarkets, solvency, loadSolvency }) {
  const [input,   setInput]   = useState('')
  const [adding,  setAdding]  = useState(false)
  const [removing,setRemoving]= useState('')
  const [createModal, setCreateModal] = useState(false)
  const [creatingMarket, setCreatingMarket] = useState(false)
  const [schedBusy, setSchedBusy] = useState({})
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const hasManageAccess = Boolean(canManage || isOwner || isAdmin)

  if (!connected) {
    return (
      <div className="wrap">
        <div className="gate">
          <div className="gate-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--indigo)" strokeWidth="1.8" strokeLinecap="round">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div className="gate-title">Connect your wallet</div>
          <div className="gate-sub">Connect a wallet with owner or admin access to manage markets.</div>
          <button className="btn btn-primary" onClick={onConnect}>Connect Wallet</button>
        </div>
      </div>
    )
  }

  if (!hasManageAccess) {
    return (
      <div className="wrap">
        <div className="gate">
          <div className="gate-title">Management access required</div>
          <div className="gate-sub">This page is available to the contract owner and authorized admins.</div>
        </div>
      </div>
    )
  }

  const addAdmin = async () => {
    if (!isOwner) { notify('Only the contract owner can manage admins','err'); return }
    const addr = input.trim().toLowerCase()
    if (!addr.startsWith('0x') || addr.length !== 42) { notify('Enter a valid wallet address','err'); return }
    if (admins.includes(addr)) { notify('Already an admin','err'); return }
    setAdding(true)
    notify('Adding admin…','ok')
    try {
      const hash = await writeContract(CONTRACT, account, 'admin_add', [addr])
      const status = await waitForTxStatus(hash)
      if (!status || status.includes('ERROR') || status === 'CANCELED' || status === 'UNDETERMINED') throw new Error('Admin transaction did not complete')
      await pollForChange(async () => {
        const raw = await readContract(CONTRACT, 'get_admins', [])
        try { return JSON.parse(raw || '[]').map(a => String(a).toLowerCase()).includes(addr) } catch (e) { return false }
      }, { intervalMs: 2000, timeoutMs: 30000 })
      await loadAdmins()
      setInput('')
      notify('Admin added ✓','ok')
    } catch(e) { notify(e.message,'err') }
    finally { setAdding(false) }
  }

  const removeAdmin = async (addr) => {
    if (!isOwner) { notify('Only the contract owner can manage admins','err'); return }
    setRemoving(addr)
    notify('Removing admin…','ok')
    try {
      const hash = await writeContract(CONTRACT, account, 'admin_remove', [addr])
      const status = await waitForTxStatus(hash)
      if (!status || status.includes('ERROR') || status === 'CANCELED' || status === 'UNDETERMINED') throw new Error('Admin transaction did not complete')
      await pollForChange(async () => {
        const raw = await readContract(CONTRACT, 'get_admins', [])
        try { return !JSON.parse(raw || '[]').map(a => String(a).toLowerCase()).includes(addr) } catch (e) { return false }
      }, { intervalMs: 2000, timeoutMs: 30000 })
      await loadAdmins()
      notify('Admin removed ✓','ok')
    } catch(e) { notify(e.message,'err') }
    finally { setRemoving('') }
  }

  const createMarket = async (q, outcomes, url, dl, deadlineTs) => {
    setCreatingMarket(true)
    notify('Creating market…','ok')
    try {
      const beforeRaw = await readContract(CONTRACT, 'get_market_count', [])
      const before = parseInt(beforeRaw || '0')

      // dl arrives already fully computed as an absolute UTC date string
      // by toAbsoluteDeadline() in CreateModal, use it directly.
      const hash = await writeContract(CONTRACT, account, 'create_market', [q, outcomes, url, dl, deadlineTs], false, 500000000000000000n)
      const status = await waitForTxStatus(hash)
      if (!status || status.includes('ERROR') || status === 'CANCELED' || status === 'UNDETERMINED') throw new Error('Market creation transaction did not complete')

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
        notify('Transaction submitted, market may still be confirming, refresh in a moment','ok')
        setCreateModal(false)
      }
    } catch(e) { notify(e.message,'err') }
    finally { setCreatingMarket(false) }
  }

  const withdraw = async () => {
    if (!isOwner) { notify('Only the contract owner can withdraw funds','err'); return }
    let amount
    try { amount = genToWei(withdrawAmount) } catch (e) { notify('Enter a valid GEN amount','err'); return }
    if (amount <= 0n) { notify('Withdrawal amount must be greater than zero','err'); return }
    setWithdrawing(true)
    try {
      const beforeRaw = await readContract(CONTRACT, 'get_solvency', [])
      const beforeBalance = BigInt(JSON.parse(beforeRaw || '{}').balance_wei || 0)
      const hash = await writeContract(CONTRACT, account, 'withdraw', [amount.toString()])
      notify('Withdrawal submitted','ok')
      const status = await waitForTxStatus(hash)
      if (!status || status.includes('ERROR') || status === 'CANCELED' || status === 'UNDETERMINED') throw new Error('Withdrawal did not complete')
      await pollForChange(async () => {
        const raw = await readContract(CONTRACT, 'get_solvency', [])
        try { return BigInt(JSON.parse(raw || '{}').balance_wei || 0) <= beforeBalance - amount } catch (e) { return false }
      }, { intervalMs: 2500, timeoutMs: 60000 })
      await loadSolvency()
      setWithdrawAmount('')
      notify('Withdrawal message committed; delivery runs at finalization','ok')
    } catch (e) { notify(e.message,'err') }
    finally { setWithdrawing(false) }
  }

  const createScheduled = async (type) => {
    if (schedBusy[type]) return
    setSchedBusy(b => ({...b, [type]: true}))
    notify('Generating '+type+' market…','ok')
    try {
      const beforeRaw = await readContract(CONTRACT, 'get_market_count', [])
      const before = parseInt(beforeRaw || '0')

      // The contract derives the authoritative deadline from deterministic
      // transaction time; browser values are display-only and omitted.
      const hash = await writeContract(CONTRACT, account, 'create_'+type+'_market', ['', ''])
      const status = await waitForTxStatus(hash)
      if (!status || status.includes('ERROR') || status === 'CANCELED' || status === 'UNDETERMINED') throw new Error('Scheduled market transaction did not complete')

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
      } else {
        notify('Transaction submitted, market may still be confirming, refresh in a moment','ok')
      }
    } catch(e) { notify(e.message,'err') }
    finally { setSchedBusy(b => ({...b, [type]: false})) }
  }

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <div className="page-title">Market administration</div>
          <div style={{fontSize:12,color:'var(--muted)',marginTop:4}}>Owners and admins can create markets; resolution and cancellation remain governed by the contract.</div>
        </div>
      </div>

      <div className="page-head" style={{padding:'0 0 14px'}}>
        <div style={{fontFamily:'var(--head)',fontWeight:800,fontSize:16,color:'var(--text)'}}>Markets</div>
        <button className="btn btn-primary btn-sm" onClick={() => setCreateModal(true)}>+ New Market</button>
      </div>

      <div className="sched-bar">
        <span className="sched-lbl">Auto-Generate</span>
        {['daily','weekly','monthly'].map(t=>(
          <button
            key={t} className="sched-btn"
            onClick={()=>createScheduled(t)}
            disabled={schedBusy[t]}
          >
            {schedBusy[t] ? 'Generating…' : '+ '+t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>

      {isOwner && <>
      <div className="filter-toolbar" style={{marginTop:16,display:'block'}}>
        <div style={{fontFamily:'var(--head)',fontWeight:800,fontSize:16,color:'var(--text)',marginBottom:10}}>Custody solvency</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,fontFamily:'var(--mono)',fontSize:12,color:'var(--text2)'}}>
          <span>Balance: {weiToGen(solvency?.balance_wei || 0, 4)} GEN</span>
          <span>Reserved: {weiToGen(solvency?.reserved_liabilities_wei || 0, 4)} GEN</span>
          <span>Surplus: {weiToGen(solvency?.withdrawable_surplus_wei || 0, 4)} GEN</span>
          <span>Committed outbound: {weiToGen(solvency?.committed_outbound_wei || 0, 4)} GEN</span>
        </div>
        <div style={{display:'flex',gap:8,marginTop:10}}>
          <input type="number" min="0" step="0.0001" value={withdrawAmount} onChange={e=>setWithdrawAmount(e.target.value)} placeholder="Amount in GEN" style={{flex:1}} />
          <button className="btn btn-primary btn-sm" disabled={withdrawing} onClick={withdraw}>{withdrawing ? 'Withdrawingâ€¦' : 'Withdraw surplus'}</button>
        </div>
      </div>

      <div style={{fontFamily:'var(--head)',fontWeight:800,fontSize:16,color:'var(--text)',margin:'32px 0 14px'}}>Admins</div>

      <div className="filter-toolbar" style={{flexDirection:'column',alignItems:'stretch',gap:0}}>
        <div className="mfield" style={{marginBottom:0}}>
          <label>Add admin wallet</label>
          <div style={{display:'flex',gap:8}}>
            <input
              type="text"
              placeholder="0x..."
              value={input}
              onChange={e=>setInput(e.target.value)}
              style={{flex:1}}
            />
            <button className="btn btn-primary btn-sm" disabled={adding} onClick={addAdmin}>
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      <div style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em',margin:'24px 0 10px'}}>
        {admins.length} admin{admins.length !== 1 ? 's' : ''}
      </div>

      {admins.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No admins yet</div>
          <div className="empty-sub">Admins can resolve, cancel, and manage markets alongside you, but never touch contract funds.</div>
        </div>
      ) : (
        <div className="mgrid" style={{gridTemplateColumns:'1fr'}}>
          {admins.map(addr => (
            <div key={addr} className="mcard" style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px'}}>
              <span style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--text2)'}}>{sh(addr)}</span>
              <button
                className="resolve-btn"
                disabled={removing===addr}
                style={{borderColor:'rgba(244,63,94,.25)',color:'var(--red)'}}
                onClick={() => removeAdmin(addr)}
              >
                {removing===addr ? 'Removing…' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}
      </>}

      {!isOwner && <div className="filter-toolbar" style={{marginTop:16}}>
        <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.6}}>Owner-only custody and admin-management controls are hidden for admin wallets. You can still create markets here; eligible resolve and cancel controls appear on the Markets page.</div>
      </div>}

      {createModal && <CreateModal onCreate={createMarket} onClose={()=>setCreateModal(false)} creating={creatingMarket}/>}
    </div>
  )
}

function CreateModal({ onCreate, onClose, creating }) {
  const [q,   setQ]   = useState('')
  const [o,   setO]   = useState('YES,NO')
  const [url, setUrl] = useState('')
  const [dl,  setDl]  = useState('24 hours from now')
  const [err, setErr] = useState('')
  const [stage, setStage] = useState(0)

  const feeDisplay = '0.50'

  const toAbsoluteDeadline = (relative) => {
    // Parse any "<number> <unit>" phrase directly instead of matching
    // against a fixed list of preset phrases, the fixed list silently
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
    const sources = url.split('|').map(s => s.trim()).filter(Boolean)
    if (sources.length === 0) { setErr('At least one HTTPS evidence source is required for later resolution'); return }
    if (sources.length > 3) { setErr('Use no more than 3 evidence sources separated by |'); return }
    const invalid = sources.find(source => !/^https:\/\//i.test(source))
    if (invalid) { setErr('Every evidence source must use https://'); return }
    const match = dl.toLowerCase().match(/(\d+)\s*(min|hour|hr|day|week|wk|month|mo)/)
    if (match && parseInt(match[1]) < 1) { setErr('Deadline must be at least 1 minute from now'); return }
    setErr('')
    const absolute = toAbsoluteDeadline(dl)
    onCreate(q, o, url, absolute, Math.floor(Date.parse(absolute) / 1000))
  }

  useEffect(() => {
    if (!creating) { setStage(0); return }
    const stages = [
      'Submitting to GenLayer…',
      'Confirming transaction…',
      'Waiting for state finalization…',
      'Almost there…',
    ]
    let i = 0
    const id = setInterval(() => { i = Math.min(i + 1, stages.length - 1); setStage(i) }, 15000)
    return () => clearInterval(id)
  }, [creating])

  const stageLabels = ['Submitting to GenLayer…','Confirming transaction…','Waiting for state finalization…','Almost there…']

  return (
    <div className="mbg show" onClick={e=>e.target===e.currentTarget && !creating && onClose()}>
      <div className="mbox">
        {creating ? (
          <div style={{padding:'32px 8px',textAlign:'center'}}>
            <div className="spin-ring spin-ring-lg" style={{margin:'0 auto 20px'}}/>
            <div style={{fontSize:15,fontWeight:700,color:'var(--text)',marginBottom:6}}>Creating market</div>
            <div style={{fontSize:12.5,color:'var(--text3)',fontFamily:'var(--mono)'}}>{stageLabels[stage]}</div>
            <div style={{fontSize:10.5,color:'var(--muted)',marginTop:14,lineHeight:1.6}}>
              This can take up to 3 minutes while the transaction is accepted and state becomes visible.<br/>Please don't close this window.
            </div>
          </div>
        ) : (
        <>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <div className="mbox-title" style={{marginBottom:0}}>Create Market</div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted)',fontSize:18,cursor:'pointer'}}>✕</button>
        </div>
        <div className="mfield"><label>Question</label><input value={q} onChange={e=>{setQ(e.target.value);setErr('')}} placeholder="Will ETH exceed $3,000 this week?"/></div>
        <div className="mfield"><label>Outcomes (comma separated)</label><input value={o} onChange={e=>setO(e.target.value)} placeholder="YES,NO"/></div>
        <div className="mfield">
          <label>Evidence sources <span style={{color:'var(--red)',fontSize:10}}>required</span></label>
          <input value={url} onChange={e=>{setUrl(e.target.value);setErr('')}} placeholder="https://coingecko.com/en/coins/ethereum|https://..."/>
          <div style={{fontSize:10,color:'var(--muted)',marginTop:5,lineHeight:1.6}}>
            Add 1–3 HTTPS sources separated by <span style={{fontFamily:'var(--mono)'}}>|</span>. The first source is primary; later sources corroborate or act as fallback. Single URLs remain supported.
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
          Opening probabilities start as deterministic equal shares. You can refresh them later with AI using live evidence. Anyone can call Resolve once the deadline passes.
          <br/>
          <span style={{color:'var(--amber)',fontWeight:700}}>Creation fee: {feeDisplay} GEN</span>, retained by the contract.
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-outline" onClick={onClose} style={{flex:1}}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} style={{flex:2}}>Create on GenLayer</button>
        </div>
        </>
        )}
      </div>
    </div>
  )
}
