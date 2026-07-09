import React from 'react'
import Ticker from './Ticker.jsx'
import { fmt } from '../lib/config.js'

export default function Home({ markets, connected, onConnect, goTo }) {
  const open     = markets.filter(m => m.status === 'OPEN')
  const resolved = markets.filter(m => m.status === 'RESOLVED')
  const featured = open.slice(0, 4)

  return (
    <div>
      <Ticker/>
      <div className="wrap">
        <div className="home-hero">
          <div className="home-glow"/>
          <div className="home-eyebrow">
            <span className="home-eyebrow-dot"/>
            GenLayer Bradbury · AI Consensus
          </div>
          <h1 className="home-title">
            Prediction markets<br/>
            <span className="home-title-gradient">powered by AI consensus</span>
          </h1>
          <p className="home-sub">
            Make predictions on crypto and Web3 events. An AI referee fetches live evidence,
            multiple validators reach consensus on-chain — no oracle, no admin key.
          </p>
          <div className="home-btns">
            <button className="btn btn-primary" onClick={() => goTo('markets')}>Browse Markets</button>
            <button className="btn btn-outline" onClick={() => connected ? goTo('profile') : onConnect()}>
              {connected ? 'My Profile' : 'Connect Wallet'}
            </button>
          </div>
        </div>

        {/* How it works */}
        <div className="home-divider"><span>How it works</span></div>
        <div className="how-grid">
          {[
            { n:'01', color:'var(--indigo)', title:'Create a Market', desc:'Post a question with outcomes and a deadline. Provide an evidence URL so the AI knows where to look when resolving.' },
            { n:'02', color:'var(--violet)', title:'AI Sets the Odds', desc:'prompt_non_comparative consensus — validators independently verify the AI-set probabilities before the market opens.' },
            { n:'03', color:'var(--teal)',   title:'AI Resolves On-chain', desc:'Anyone calls resolve after the deadline. The AI fetches the evidence URL, validators use strict_eq to agree on the winner.' },
          ].map(s => (
            <div key={s.n} className="how-step">
              <div className="how-num" style={{color:s.color}}>{s.n}</div>
              <div className="how-title">{s.title}</div>
              <div className="how-desc">{s.desc}</div>
            </div>
          ))}
        </div>

        {/* Live markets preview */}
        {featured.length > 0 && <>
          <div className="home-divider"><span>Live Markets</span></div>
          <div className="home-grid">
            {featured.map(m => {
              const outs = m.outcomes || []
              return (
                <div key={m.id} className="home-mcard" onClick={() => goTo('markets')}>
                  <div className="home-mcard-q">{m.question.slice(0, 88)}{m.question.length > 88 ? '…' : ''}</div>
                  <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:10}}>
                    {outs.map((o, i) => {
                      const prob  = m.ai_probs?.[i] || Math.round(100 / outs.length)
                      const lo    = o.toLowerCase()
                      const color = lo==='yes' ? 'var(--green)' : lo==='no' ? 'var(--red)' : 'var(--indigo)'
                      return (
                        <div key={o} style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:11,fontWeight:800,minWidth:40,color,fontFamily:'var(--mono)'}}>{o}</span>
                          <div style={{flex:1,height:3,borderRadius:100,background:'var(--bg2)',overflow:'hidden'}}>
                            <div style={{width:prob+'%',height:'100%',borderRadius:100,background:color,transition:'width .4s'}}/>
                          </div>
                          <span style={{fontSize:12,fontWeight:900,fontFamily:'var(--head)',color,minWidth:36,textAlign:'right',letterSpacing:'-.04em'}}>{prob}%</span>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:11,fontFamily:'var(--mono)',color:'var(--muted)'}}>
                    <span>{((Number(m.total_pool)||0)/1e18).toFixed(4).replace(/\.?0+$/,'')||'0'} GEN pooled</span>
                    <span>{m.total_bets||0} bets</span>
                  </div>
                </div>
              )
            })}
          </div>
        </>}

        {/* Stats */}
        <div className="home-stats">
          {[
            [markets.length,                              'Total Markets'],
            [open.length,                                 'Open Now'],
            [resolved.length,                             'Resolved'],
            [markets.reduce((s, m) => s + (m.total_bets||0), 0), 'Total Bets'],
          ].map(([v, l]) => (
            <div key={l} style={{textAlign:'center'}}>
              <div className="home-stat-val">{fmt(v)}</div>
              <div className="home-stat-lbl">{l}</div>
            </div>
          ))}
        </div>

        {/* Consensus pattern card from the video */}
        <div className="consensus-card">
          <div className="consensus-card-title">Consensus on Gen Markets</div>
          <div className="consensus-row">
            <span className="consensus-fn">create_market</span>
            <span className="consensus-arrow">→</span>
            <span className="consensus-method pm">prompt_non_comparative</span>
            <span className="consensus-note">validators verify AI-set odds</span>
          </div>
          <div className="consensus-row">
            <span className="consensus-fn">resolve_market</span>
            <span className="consensus-arrow">→</span>
            <span className="consensus-method se">strict_eq</span>
            <span className="consensus-note">all validators must agree on winner</span>
          </div>
          <div className="consensus-row">
            <span className="consensus-fn">play_coinflip</span>
            <span className="consensus-arrow">→</span>
            <span className="consensus-method se">strict_eq</span>
            <span className="consensus-note">drand beacon mixed into RNG seed</span>
          </div>
          <div className="consensus-row">
            <span className="consensus-fn">place_bet</span>
            <span className="consensus-arrow">→</span>
            <span className="consensus-method det">deterministic</span>
            <span className="consensus-note">pure logic, no AI needed</span>
          </div>
        </div>
      </div>
    </div>
  )
}
