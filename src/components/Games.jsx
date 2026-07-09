import React, { useState, useRef, useEffect } from 'react'
import { writeContract, readContract, waitForTxStatus, pollForChange } from '../lib/gl.js'
import { CONTRACT, fmt } from '../lib/config.js'

const MAX_WIN   = 5      // matches contract MAX_WIN constant
const MAX_STAKE_2X = Math.floor(MAX_WIN / 2) // coinflip + RPS: 2.5 → floor = 2

// Game payouts come back from the contract as raw wei integers.
// Convert to a readable GEN amount before ever showing them on screen.
function weiToGen(wei) {
  const n = Number(wei) || 0
  return (n / 1e18).toFixed(4).replace(/\.?0+$/, '') || '0'
}

// Mochi — GenLayer's official mascot (CC0, genlayer-foundation/genlayer-mascot).
// Used here purely for the win/loss reaction in each game's result screen.
const MOCHI = {
  up:   'https://raw.githubusercontent.com/genlayer-foundation/genlayer-mascot/main/assets/stickers/mochi-sticker-stonks-up.png',
  down: 'https://raw.githubusercontent.com/genlayer-foundation/genlayer-mascot/main/assets/stickers/mochi-sticker-stonks-down.png',
  tie:  'https://raw.githubusercontent.com/genlayer-foundation/genlayer-mascot/main/assets/stickers/mochi-sticker-love.png',
}
function MochiReaction({ result }) {
  const src = result === 'win' ? MOCHI.up : result === 'tie' ? MOCHI.tie : MOCHI.down
  const alt = result === 'win' ? 'Mochi celebrating' : result === 'tie' ? 'Mochi giving a friendly nod' : 'Mochi disappointed'
  return <img src={src} alt={alt} className="mochi-reaction" width={64} height={64}/>
}

const RPS_SVG = {
  ROCK:`<svg viewBox="0 0 80 80" fill="none"><path d="M22 55C22 40 18 28 18 21C18 14 24 12 29 14C30 10 34 8 38 10C40 7 44 6 48 8C50 5 55 6 57 12C61 10 65 13 64 20L62 42C65 40 70 42 70 49C70 56 65 64 58 68C53 72 46 74 40 74C32 74 26 68 22 55Z" fill="#D4AF87" stroke="#9A6F45" stroke-width="2"/></svg>`,
  PAPER:`<svg viewBox="0 0 80 80" fill="none"><rect x="20" y="52" width="40" height="24" rx="7" fill="#D4AF87" stroke="#9A6F45" stroke-width="2"/><rect x="20" y="18" width="9" height="36" rx="4.5" fill="#D4AF87" stroke="#9A6F45" stroke-width="2"/><rect x="31" y="12" width="9" height="42" rx="4.5" fill="#D4AF87" stroke="#9A6F45" stroke-width="2"/><rect x="42" y="14" width="9" height="40" rx="4.5" fill="#D4AF87" stroke="#9A6F45" stroke-width="2"/><rect x="53" y="18" width="9" height="36" rx="4.5" fill="#D4AF87" stroke="#9A6F45" stroke-width="2"/></svg>`,
  SCISSORS:`<svg viewBox="0 0 80 80" fill="none"><rect x="20" y="54" width="40" height="22" rx="7" fill="#D4AF87" stroke="#9A6F45" stroke-width="2"/><rect x="20" y="14" width="9" height="42" rx="4.5" fill="#D4AF87" stroke="#9A6F45" stroke-width="2"/><rect x="31" y="10" width="9" height="46" rx="4.5" fill="#D4AF87" stroke="#9A6F45" stroke-width="2"/><rect x="42" y="46" width="9" height="10" rx="4.5" fill="#D4AF87" stroke="#9A6F45" stroke-width="2"/><rect x="53" y="48" width="9" height="8" rx="4.5" fill="#D4AF87" stroke="#9A6F45" stroke-width="2"/></svg>`,
}

// ── Coin — 3D silver chrome with the Gen Markets mark etched in ────────────
function drawCoin(canvas, angle) {
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height,cx=W/2,cy=H/2-8,R=Math.min(W,H)/2-12
  ctx.clearRect(0,0,W,H)
  const sx=Math.cos(angle),ax=Math.abs(sx),isH=sx>=0

  // shadow
  ctx.save();ctx.translate(cx,cy+R+14);ctx.scale(ax*.85,.15)
  const sg=ctx.createRadialGradient(0,0,0,0,0,R)
  sg.addColorStop(0,'rgba(0,0,0,.5)');sg.addColorStop(1,'rgba(0,0,0,0)')
  ctx.fillStyle=sg;ctx.beginPath();ctx.ellipse(0,0,R,R,0,0,Math.PI*2);ctx.fill();ctx.restore()

  if(ax<0.08){
    ctx.save();ctx.translate(cx,cy)
    const eg=ctx.createLinearGradient(-6,-R,6,R)
    eg.addColorStop(0,'#6B7280');eg.addColorStop(.5,'#F3F4F6');eg.addColorStop(1,'#6B7280')
    ctx.fillStyle=eg;ctx.beginPath();ctx.ellipse(0,0,6,R,0,0,Math.PI*2);ctx.fill();ctx.restore();return
  }

  ctx.save();ctx.translate(cx,cy);ctx.scale(sx,1)

  // silver/chrome family — two tones distinguishing the faces without losing the metal identity
  const col = isH
    ? ['#FFFFFF','#E4E7EC','#9CA3AF','#54565C']
    : ['#F1F2F4','#C9CDD4','#7C828C','#3F4147']

  // bevelled rim
  ctx.beginPath();ctx.ellipse(0,0,R,R,0,0,Math.PI*2)
  ctx.strokeStyle=col[3];ctx.lineWidth=7;ctx.stroke()
  ctx.strokeStyle=col[2];ctx.lineWidth=3.5;ctx.stroke()

  // milled edge
  for(let i=0;i<36;i++){
    const a=(i/36)*Math.PI*2
    const x1=Math.cos(a)*(R-1), y1=Math.sin(a)*(R-1)
    const x2=Math.cos(a)*(R-6), y2=Math.sin(a)*(R-6)
    ctx.strokeStyle='rgba(0,0,0,.16)';ctx.lineWidth=1
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()
  }

  // face
  const bg=ctx.createRadialGradient(-R*.3,-R*.3,R*.05,0,0,R)
  bg.addColorStop(0,col[0]);bg.addColorStop(.45,col[1]);bg.addColorStop(.8,col[2]);bg.addColorStop(1,col[3])
  ctx.beginPath();ctx.ellipse(0,0,R-8,R-8,0,0,Math.PI*2);ctx.fillStyle=bg;ctx.fill()

  // specular highlight that slides across the face as it spins — this is
  // what actually sells the 3D illusion, a fixed highlight reads as flat
  const hlShift = Math.sin(angle)*R*.24
  const shine=ctx.createRadialGradient(-R*.3+hlShift,-R*.35,2,-R*.3+hlShift,-R*.35,R*.65)
  shine.addColorStop(0,'rgba(255,255,255,.65)');shine.addColorStop(1,'rgba(255,255,255,0)')
  ctx.fillStyle=shine;ctx.fill()

  if(ax>.16){
    ctx.scale(1/sx,1)
    // etched Gen Markets twin-triangle mark
    const s=R*.34
    ctx.save();ctx.translate(0,-R*.1)
    ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(s*.82,s*.6);ctx.lineTo(-s*.82,s*.6);ctx.closePath()
    ctx.fillStyle = isH ? 'rgba(60,65,75,.32)' : 'rgba(35,37,43,.38)'
    ctx.fill()
    ctx.beginPath();ctx.moveTo(0,-s*.42);ctx.lineTo(s*.44,s*.6);ctx.lineTo(-s*.44,s*.6);ctx.closePath()
    ctx.fillStyle = isH ? 'rgba(20,22,30,.55)' : 'rgba(12,13,16,.62)'
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = isH ? 'rgba(55,58,66,.82)' : 'rgba(30,31,36,.88)'
    ctx.font = `800 ${Math.floor(10*ax)}px 'DM Mono',monospace`
    ctx.textAlign='center';ctx.textBaseline='middle'
    ctx.fillText(isH?'HEADS':'TAILS', 0, R*.54)
  }
  ctx.restore()
}

// ── Compact status caption (secondary signal — the GAME animation above it is the real loader) ──
function StatusCaption({ status }) {
  const msgs = { '':'Submitting transaction…', PENDING:'Transaction pending…', ACCEPT:'Validators reached consensus', FINAL:'Finalizing…' }
  const key = Object.keys(msgs).find(k => k && status?.includes(k)) || ''
  return (
    <div>
      <div className="consensus-caption"><span className="spin-ring"/>{msgs[key] || 'Validators processing…'}</div>
      <span className="consensus-caption-sub">GenLayer Bradbury</span>
    </div>
  )
}

// ── Local win/loss history (no on-chain history list exists) ───────────────
function loadHistory(key) { try { return JSON.parse(localStorage.getItem('gm_hist_'+key) || '[]') } catch(e) { return [] } }
function pushHistory(key, result) {
  const h = loadHistory(key); h.unshift(result)
  localStorage.setItem('gm_hist_'+key, JSON.stringify(h.slice(0, 10)))
}
function HistoryStrip({ gameKey, refreshTick }) {
  const [hist, setHist] = useState([])
  useEffect(() => { setHist(loadHistory(gameKey)) }, [gameKey, refreshTick])
  const slots = [...hist, ...Array(10 - hist.length).fill(null)].slice(0, 10)
  return (
    <div className="history-strip">
      <span className="history-label">Recent</span>
      {slots.map((r, i) => <span key={i} className={`history-dot${r ? ' '+r : ' empty'}`} title={r || ''}/>)}
    </div>
  )
}

async function getLastGameRaw(account) {
  const raw = await readContract(CONTRACT, 'get_last_game', [account])
  return raw || ''
}
async function pollNewGame(account, prevRaw) {
  return pollForChange(async () => {
    const raw = await readContract(CONTRACT, 'get_last_game', [account])
    if (!raw || raw === prevRaw) return null
    try { return JSON.parse(raw) } catch(e) { return null }
  })
}

export default function Games({ account, connected, genBal, notify, onConnect }) {
  const [coinOpen, setCoinOpen] = useState(false)
  const [diceOpen, setDiceOpen] = useState(false)
  const [rpsOpen,  setRpsOpen]  = useState(false)
  const [tick,     setTick]     = useState(0)

  const check = amt => {
    if(!connected)  { notify('Connect wallet first','err'); return false }
    if(amt<0.1)     { notify('Minimum bet is 0.1 GEN','err'); return false }
    return true
  }
  const onGameEnd = (gameKey, resultStr) => {
    if (gameKey && resultStr) pushHistory(gameKey, resultStr)
    setTick(t => t+1)
  }

  return (
    <div className="wrap">
      <div className="page-head"><div className="page-title">Quick Games</div></div>
      {connected ? <>
        <div className="games-bal">
          <div>
            <div style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>Balance</div>
            <div style={{fontSize:24,fontWeight:900,color:'var(--text)',fontFamily:'var(--head)',letterSpacing:'-.04em'}}>{(genBal ?? 0).toFixed(4)} <span style={{fontSize:14,fontWeight:500,color:'var(--text3)'}}>GEN</span></div>
          </div>
          <div style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--mono)',textAlign:'right',lineHeight:1.8}}>Min bet: 1 GEN<br/>Max win: 5 GEN</div>
        </div>
        <div className="games-grid">
          <div className="gcard gcard-coin" onClick={() => setCoinOpen(true)}>
            <div className="gcard-art"><div className="gcard-coin-art">H</div></div>
            <div className="gcard-name">Coin Flip</div>
            <div className="gcard-desc">Call heads or tails. One flip, instant result. Win double your stake.</div>
            <div className="gcard-footer"><span className="gcard-odds">2× payout</span><button className="gcard-cta" onClick={e=>{e.stopPropagation();setCoinOpen(true)}}>Flip Now</button></div>
            <HistoryStrip gameKey="coin" refreshTick={tick}/>
          </div>
          <div className="gcard gcard-dice" onClick={() => setDiceOpen(true)}>
            <div className="gcard-art">
              <div className="gcard-dice-art" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:4,padding:9}}>
                <div className="dice-dot" style={{width:8,height:8,borderRadius:'50%'}}/><div/><div className="dice-dot" style={{width:8,height:8,borderRadius:'50%'}}/>
                <div/><div className="dice-dot" style={{width:8,height:8,borderRadius:'50%'}}/><div/>
                <div className="dice-dot" style={{width:8,height:8,borderRadius:'50%'}}/><div/><div className="dice-dot" style={{width:8,height:8,borderRadius:'50%'}}/>
              </div>
            </div>
            <div className="gcard-name">Dice Roll</div>
            <div className="gcard-desc">Set your target. Pick over or under. Lower odds means higher multiplier.</div>
            <div className="gcard-footer"><span className="gcard-odds">Up to 100×</span><button className="gcard-cta" onClick={e=>{e.stopPropagation();setDiceOpen(true)}}>Roll Now</button></div>
            <HistoryStrip gameKey="dice" refreshTick={tick}/>
          </div>
          <div className="gcard gcard-rps" onClick={() => setRpsOpen(true)}>
            <div className="gcard-art"><div className="gcard-rps-art" style={{display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{width:38,height:38}} dangerouslySetInnerHTML={{__html:RPS_SVG.ROCK}}/></div></div>
            <div className="gcard-name">Rock Paper Scissors</div>
            <div className="gcard-desc">Challenge the house. Win 2× on victory. Draw and your stake returns.</div>
            <div className="gcard-footer"><span className="gcard-odds">2× or push</span><button className="gcard-cta" onClick={e=>{e.stopPropagation();setRpsOpen(true)}}>Play Now</button></div>
            <HistoryStrip gameKey="rps" refreshTick={tick}/>
          </div>
        </div>
        <div className="mochi-credit">Mochi by GenLayer · CC0</div>
      </> : (
        <div className="gate">
          <div className="gate-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--indigo)" strokeWidth="1.8" strokeLinecap="round">
              <rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
            </svg>
          </div>
          <div className="gate-title">Connect to play</div>
          <div className="gate-sub">Connect your wallet to access GEN games.</div>
          <button className="btn btn-primary" onClick={onConnect}>Connect Wallet</button>
        </div>
      )}
      {coinOpen && <CoinModal account={account} genBal={genBal} check={check} notify={notify} onEnd={onGameEnd} onClose={() => setCoinOpen(false)}/>}
      {diceOpen && <DiceModal account={account} genBal={genBal} check={check} notify={notify} onEnd={onGameEnd} onClose={() => setDiceOpen(false)}/>}
      {rpsOpen  && <RpsModal  account={account} genBal={genBal} check={check} notify={notify} onEnd={onGameEnd} onClose={() => setRpsOpen(false)}/>}
    </div>
  )
}

// ── COIN FLIP — spins continuously for the FULL wait, settles only once the real result lands ──
function CoinModal({ account, genBal, check, notify, onEnd, onClose }) {
  const [side,setSide]=useState('HEADS')
  const [amt,setAmt]=useState(1)
  const [phase,setPhase]=useState('setup')
  const [result,setResult]=useState(null)
  const [txStatus,setTxStatus]=useState('')
  const cv=useRef(),animCv=useRef()
  const angleRef=useRef(0), rafRef=useRef(null)

  useEffect(()=>{ if(cv.current) drawCoin(cv.current, side==='HEADS'?0:Math.PI) },[side])
  useEffect(()=>() => { if(rafRef.current) cancelAnimationFrame(rafRef.current) },[])

  const spinForever = () => {
    const tick = () => {
      angleRef.current += 0.16
      if(animCv.current) drawCoin(animCv.current, angleRef.current)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }
  const stopSpin = () => { if(rafRef.current) cancelAnimationFrame(rafRef.current) }
  const settleTo = (isHeads, ms=750) => new Promise(resolve => {
    stopSpin()
    const twoPi=Math.PI*2, offset=isHeads?0:Math.PI
    let target = Math.ceil((angleRef.current-offset)/twoPi)*twoPi+offset
    if (target <= angleRef.current+0.4) target += twoPi
    const from=angleRef.current, delta=target-from, s=performance.now()
    const frame=(now)=>{
      const t=Math.min((now-s)/ms,1), e=1-Math.pow(1-t,3)
      angleRef.current = from+delta*e
      if(animCv.current) drawCoin(animCv.current, angleRef.current)
      if(t<1) rafRef.current=requestAnimationFrame(frame); else resolve()
    }
    rafRef.current=requestAnimationFrame(frame)
  })

  const play=async()=>{
    if(!check(amt))return
    setPhase('playing'); setTxStatus('')
    angleRef.current = 0
    spinForever()
    try {
      const prevRaw = await getLastGameRaw(account)
      const valueWei = BigInt(Math.round(amt * 1e18))
      const hash = await writeContract(CONTRACT, account, 'play_coinflip', [side], false, valueWei)
      waitForTxStatus(hash, setTxStatus).catch(()=>{})
      const gr = await pollNewGame(account, prevRaw) // coin keeps spinning the whole time this awaits
      await settleTo(gr?.outcome==='HEADS', 800)
      setResult(gr); onEnd(gr?.balance, 'coin', gr?.result==='WIN'?'win':'lose'); setPhase('result')
    } catch(e) { stopSpin(); notify(e.message,'err'); setPhase('setup'); setTxStatus('') }
  }

  const won = result?.result==='WIN'
  return (
    <div className="gm-modal show" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="gm-box">
        <div className="gm-head"><div className="gm-title" style={{color:'var(--amber)'}}>Coin Flip</div><button className="gm-close" onClick={onClose}>✕</button></div>
        {phase==='setup'&&<>
          <canvas ref={cv} className="coin-cv" width="160" height="160"/>
          <div className="gm-side-row">
            <button className={`gm-side-btn${side==='HEADS'?' on':''}`} onClick={()=>setSide('HEADS')} style={side==='HEADS'?{color:'var(--amber)',borderColor:'var(--amber)',background:'rgba(245,158,11,.1)'}:{}}>Heads ♦</button>
            <button className={`gm-side-btn${side==='TAILS'?' on':''}`} onClick={()=>setSide('TAILS')} style={side==='TAILS'?{color:'var(--amber)',borderColor:'var(--amber)',background:'rgba(245,158,11,.1)'}:{}}>Tails ★</button>
          </div>
          <div className="gm-stake"><label>Stake</label><input type="number" value={amt} min="0.1" step="0.1" onChange={e=>setAmt(parseFloat(e.target.value)||0)}/><span className="gm-bal">{(genBal ?? 0).toFixed(4)} GEN</span></div>
          <button className="gm-play-btn gm-play-coin" onClick={play}>Flip the Coin</button>
        </>}
        {phase==='playing'&&<>
          <canvas ref={animCv} className="coin-cv" width="160" height="160"/>
          <StatusCaption status={txStatus}/>
        </>}
        {phase==='result'&&result&&<>
          <canvas ref={el => { if(el) drawCoin(el, result.outcome==='HEADS'?0:Math.PI) }} className="coin-cv" width="160" height="160"/>
          <div className="gm-result" style={{marginTop:16}}>
            <MochiReaction result={won?"win":"lose"}/>
            <div className={`gm-badge ${won?'gm-win':'gm-lose'}`}>{won?'You Win':'You Lose'}</div>
            <div className="gm-res-title" style={{color:won?'var(--teal)':'var(--red)'}}>{result.outcome}</div>
            <div className="gm-res-sub">{won?'+'+weiToGen(result.payout)+' GEN':'–'+amt+' GEN'}</div>
            {won && <div style={{fontSize:10.5,color:'var(--muted)',textAlign:'center',marginTop:6,fontFamily:'var(--mono)',lineHeight:1.5}}>GEN sent — allow ~30 min for finality to fully reflect in your wallet</div>}
          </div>
          <div className="gm-btns">
            <button className="btn btn-outline" onClick={()=>{setPhase('setup');setResult(null)}} style={{flex:1}}>Play Again</button>
            <button className="btn btn-outline" onClick={onClose} style={{flex:1}}>Close</button>
          </div>
        </>}
      </div>
    </div>
  )
}

// ── DICE ROLL — marker sweeps continuously while waiting, settles on the real roll ──
function DiceModal({ account, genBal, check, notify, onEnd, onClose }) {
  const [dir,setDir]=useState('UNDER')
  const [target,setTgt]=useState(50)
  const [amt,setAmt]=useState(1)
  const [phase,setPhase]=useState('setup')
  const [result,setResult]=useState(null)
  const [txStatus,setTxStatus]=useState('')
  const [markerPos,setMarkerPos]=useState(null)
  const [markerState,setMarkerState]=useState('')
  const [markerTransition,setMarkerTransition]=useState('none')
  const sweepRef=useRef(null), tRef=useRef(0)

  const pct=dir==='UNDER'?target:100-target
  const mult=pct>0?(100/pct).toFixed(2):'∞'

  const startSweep = () => {
    setMarkerTransition('none')
    tRef.current = 0
    sweepRef.current = setInterval(() => {
      tRef.current += 0.09
      setMarkerPos(Math.round(50 + Math.sin(tRef.current)*44))
    }, 35)
  }
  const stopSweep = () => { if(sweepRef.current) clearInterval(sweepRef.current) }
  useEffect(() => () => stopSweep(), [])

  const play=async()=>{
    const ms=Math.max(1,Math.floor((MAX_WIN*target)/100));
    if(!check(amt,ms))return
    setPhase('playing'); setTxStatus(''); setMarkerState('')
    startSweep()
    try {
      const prevRaw = await getLastGameRaw(account)
      const valueWei = BigInt(Math.round(amt * 1e18))
      const hash = await writeContract(CONTRACT, account, 'play_dice', [dir, target], false, valueWei)
      waitForTxStatus(hash, setTxStatus).catch(()=>{})
      const g = await pollNewGame(account, prevRaw) // marker keeps sweeping the whole time this awaits
      stopSweep()
      const roll = parseInt(g.roll||0), won = g.result==='WIN'
      setMarkerTransition('left 1.1s cubic-bezier(.2,.85,.25,1.1)')
      await new Promise(r=>setTimeout(r,30))
      setMarkerPos(roll); setMarkerState(won?'win':'lose')
      await new Promise(r=>setTimeout(r,1300))
      setResult(g); onEnd(g?.balance, 'dice', won?'win':'lose'); setPhase('result')
    } catch(e) { stopSweep(); notify(e.message,'err'); setPhase('setup'); setTxStatus('') }
  }

  const Bar = ({ children }) => (
    <div className="dice-bar-wrap" style={{paddingTop:30}}>
      <div className="dice-bar-track">
        {dir==='UNDER' ? <>
          <div className="dice-bar-zone-win"  style={{width:target+'%'}}/>
          <div className="dice-bar-zone-lose" style={{width:(100-target)+'%'}}/>
        </> : <>
          <div className="dice-bar-zone-lose" style={{width:target+'%'}}/>
          <div className="dice-bar-zone-win"  style={{width:(100-target)+'%'}}/>
        </>}
        <div className="dice-bar-divider" style={{left:target+'%'}}/>
        {children}
      </div>
      <div className="dice-bar-scale"><span>0</span><span>50</span><span>99</span></div>
    </div>
  )

  return (
    <div className="gm-modal show" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="gm-box">
        <div className="gm-head"><div className="gm-title" style={{color:'var(--teal)'}}>Dice Roll</div><button className="gm-close" onClick={onClose}>✕</button></div>
        {phase==='setup'&&<>
          <div className="gm-side-row">
            <button className={`gm-side-btn${dir==='UNDER'?' on':''}`} onClick={()=>setDir('UNDER')} style={dir==='UNDER'?{color:'var(--teal)',borderColor:'var(--teal)',background:'rgba(20,184,166,.1)'}:{}}>Under</button>
            <button className={`gm-side-btn${dir==='OVER'?' on':''}`}  onClick={()=>setDir('OVER')}  style={dir==='OVER'? {color:'var(--teal)',borderColor:'var(--teal)',background:'rgba(20,184,166,.1)'}:{}}>Over</button>
          </div>
          <div className="dice-target-row"><label>Target</label><input type="range" min="5" max="95" value={target} onChange={e=>setTgt(parseInt(e.target.value))}/><span className="dice-target-val">{target}</span></div>
          <Bar/>
          <div className="dice-info">
            <div className="dice-stat"><div className="dice-stat-lbl">Win chance</div><div className="dice-stat-val">{pct}%</div></div>
            <div className="dice-stat"><div className="dice-stat-lbl">Multiplier</div><div className="dice-stat-val">{mult}×</div></div>
          </div>
          <div className="gm-stake"><label>Stake</label><input type="number" value={amt} min="0.1" step="0.1" onChange={e=>setAmt(parseFloat(e.target.value)||0)}/><span className="gm-bal">{(genBal ?? 0).toFixed(4)} GEN</span></div>
          <button className="gm-play-btn gm-play-dice" onClick={play}>Roll the Dice</button>
        </>}

        {phase==='playing'&&<>
          <Bar>
            {markerPos !== null && (
              <div className={`dice-marker ${markerState}`} style={{left:markerPos+'%', transition:markerTransition}}>{markerState && markerPos}</div>
            )}
          </Bar>
          <StatusCaption status={txStatus}/>
        </>}

        {phase==='result'&&result&&<>
          <Bar>
            <div className={`dice-marker ${result.result==='WIN'?'win':'lose'}`} style={{left:(result.roll||0)+'%'}}>{result.roll}</div>
          </Bar>
          <div className="gm-result">
            <MochiReaction result={result.result==='WIN'?'win':'lose'}/>
            <div className={`gm-badge ${result.result==='WIN'?'gm-win':'gm-lose'}`}>{result.result==='WIN'?'You Win':'You Lose'}</div>
            <div className="gm-res-title" style={{color:result.result==='WIN'?'var(--teal)':'var(--red)'}}>Rolled {result.roll}</div>
            <div className="gm-res-sub">{result.result==='WIN'?'+'+weiToGen(result.payout)+' GEN':'Needed '+(dir==='UNDER'?`0–${target-1}`:`${target}–99`)}</div>
            {result.result==='WIN' && <div style={{fontSize:10.5,color:'var(--muted)',textAlign:'center',marginTop:6,fontFamily:'var(--mono)',lineHeight:1.5}}>GEN sent — allow ~30 min for finality to fully reflect in your wallet</div>}
          </div>
          <div className="gm-btns">
            <button className="btn btn-outline" onClick={()=>{setPhase('setup');setResult(null)}} style={{flex:1}}>Play Again</button>
            <button className="btn btn-outline" onClick={onClose} style={{flex:1}}>Close</button>
          </div>
        </>}
      </div>
    </div>
  )
}

// ── RPS — hands bounce + house "thinks" through choices the whole wait ──
function RpsModal({ account, genBal, check, notify, onEnd, onClose }) {
  const [choice,setChoice]=useState('ROCK')
  const [amt,setAmt]=useState(1)
  const [phase,setPhase]=useState('setup')
  const [result,setResult]=useState(null)
  const [txStatus,setTxStatus]=useState('')
  const [cd,setCd]=useState('')
  const [houseGuess,setHouseGuess]=useState('ROCK')
  const [showImpact,setShowImpact]=useState(false)

  useEffect(() => {
    if (phase !== 'playing') return
    const opts=['ROCK','PAPER','SCISSORS']; let i=0
    const id = setInterval(() => { i=(i+1)%3; setHouseGuess(opts[i]) }, 380)
    return () => clearInterval(id)
  }, [phase])

  const play=async()=>{
    if(!check(amt))return
    setPhase('playing'); setTxStatus('')
    try {
      const prevRaw = await getLastGameRaw(account)
      const valueWei = BigInt(Math.round(amt * 1e18))
      const hash = await writeContract(CONTRACT, account, 'play_rps', [choice], false, valueWei)
      waitForTxStatus(hash, setTxStatus).catch(()=>{})
      const cdP=(async()=>{for(const n of ['3','2','1','GO!']){setCd(n);await new Promise(r=>setTimeout(r,n==='GO!'?400:650))}setCd('')})()
      const pollP = pollNewGame(account, prevRaw) // hands keep bouncing + house keeps cycling the whole time this awaits
      const [gr] = await Promise.all([pollP, cdP])
      setShowImpact(true)
      await new Promise(r=>setTimeout(r,500))
      setResult(gr||{}); onEnd(gr?.balance, 'rps', gr?.result==='WIN'?'win':gr?.result==='TIE'?'tie':'lose'); setPhase('result')
    } catch(e) { notify(e.message,'err'); setPhase('setup'); setTxStatus('') }
  }

  const won=result?.result==='WIN', tie=result?.result==='TIE'
  return (
    <div className="gm-modal show" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="gm-box">
        <div className="gm-head"><div className="gm-title" style={{color:'var(--violet)'}}>Rock Paper Scissors</div><button className="gm-close" onClick={onClose}>✕</button></div>
        {phase==='setup'&&<>
          <div className="rps-pick-row">
            {['ROCK','PAPER','SCISSORS'].map(c=>(
              <button key={c} className={`rps-btn${choice===c?' on':''}`} onClick={()=>setChoice(c)}>
                <div className="rps-icon" dangerouslySetInnerHTML={{__html:RPS_SVG[c]}}/>
                <div className="rps-lbl">{c}</div>
              </button>
            ))}
          </div>
          <div className="gm-stake"><label>Stake</label><input type="number" value={amt} min="0.1" step="0.1" onChange={e=>setAmt(parseFloat(e.target.value)||0)}/><span className="gm-bal">{(genBal ?? 0).toFixed(4)} GEN</span></div>
          <button className="gm-play-btn gm-play-rps" onClick={play}>Play!</button>
        </>}
        {phase==='playing'&&<>
          <div className="rps-vs-row">
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:10,color:'var(--muted)',marginBottom:6,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',fontFamily:'var(--mono)'}}>You</div>
              <div className="rps-hand bouncing" dangerouslySetInnerHTML={{__html:RPS_SVG[choice]}}/>
            </div>
            <span style={{fontSize:14,fontWeight:700,color:'var(--muted)',fontFamily:'var(--mono)'}}>vs</span>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:10,color:'var(--muted)',marginBottom:6,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',fontFamily:'var(--mono)'}}>House</div>
              <div className="rps-hand bouncing house" style={{transform:'scaleX(-1)'}} dangerouslySetInnerHTML={{__html:RPS_SVG[houseGuess]}}/>
            </div>
            {showImpact && <div className="rps-impact"><div className="rps-impact-burst"/></div>}
          </div>
          {cd ? <div className="countdown">{cd}</div> : <StatusCaption status={txStatus}/>}
        </>}
        {phase==='result'&&result&&<>
          <div className="rps-result-hands">
            <div className="rps-res-side"><div className="rps-res-hand" style={won?{filter:'drop-shadow(0 0 14px var(--teal))',transform:'scale(1.12)'}:tie?{}:{filter:'grayscale(1)',opacity:.25}} dangerouslySetInnerHTML={{__html:RPS_SVG[choice]}}/><div className="rps-res-lbl">You</div></div>
            <div className="rps-res-side"><div className="rps-res-hand" style={won?{filter:'grayscale(1)',opacity:.25}:tie?{}:{filter:'drop-shadow(0 0 14px var(--red))',transform:'scale(1.12)'}} dangerouslySetInnerHTML={{__html:RPS_SVG[result.house||'ROCK']}}/><div className="rps-res-lbl">House</div></div>
          </div>
          <div className="gm-result">
            <MochiReaction result={won?'win':tie?'tie':'lose'}/>
            <div className={`gm-badge ${won?'gm-win':tie?'gm-tie':'gm-lose'}`}>{won?'You Win':tie?'Tie':'You Lose'}</div>
            <div className="gm-res-title" style={{color:won?'var(--teal)':tie?'var(--indigo)':'var(--red)'}}>{won?choice+' beats '+result.house:tie?'Both played '+choice:result.house+' beats '+choice}</div>
            <div className="gm-res-sub">{won?'+'+weiToGen(result.payout)+' GEN':tie?'Stake returned':'Better luck next time'}</div>
            {won && <div style={{fontSize:10.5,color:'var(--muted)',textAlign:'center',marginTop:6,fontFamily:'var(--mono)',lineHeight:1.5}}>GEN sent — allow ~30 min for finality to fully reflect in your wallet</div>}
          </div>
          <div className="gm-btns">
            <button className="btn btn-outline" onClick={()=>{setPhase('setup');setResult(null);setShowImpact(false)}} style={{flex:1}}>Play Again</button>
            <button className="btn btn-outline" onClick={onClose} style={{flex:1}}>Close</button>
          </div>
        </>}
      </div>
    </div>
  )
}
