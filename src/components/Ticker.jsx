import React, { useState, useEffect } from 'react'

const COINS = [
  { id: 'bitcoin', sym: 'BTC' }, { id: 'ethereum', sym: 'ETH' },
  { id: 'solana', sym: 'SOL' }, { id: 'ripple', sym: 'XRP' },
  { id: 'dogecoin', sym: 'DOGE' }, { id: 'chainlink', sym: 'LINK' },
  { id: 'avalanche-2', sym: 'AVAX' },
]

export default function Ticker() {
  const [items, setItems] = useState([])

  useEffect(() => {
    const load = async () => {
      try {
        const ids = COINS.map(c => c.id).join(',')
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`)
        if (!r.ok) return
        const data = await r.json()
        setItems(COINS.map(c => {
          const d = data[c.id]; if (!d) return null
          const chg = d.usd_24h_change || 0, up = chg >= 0
          const price = d.usd >= 1000 ? '$' + d.usd.toLocaleString('en-US', { maximumFractionDigits: 0 })
            : d.usd >= 1 ? '$' + d.usd.toFixed(2) : '$' + d.usd.toFixed(4)
          return { sym: c.sym, price, chg: Math.abs(chg).toFixed(2), up }
        }).filter(Boolean))
      } catch (e) {}
    }
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])

  if (!items.length) return <div className="ticker" />

  const track = items.map((item, i) => (
    <span key={i} className="ticker-item">
      <span className="ticker-sym">{item.sym}</span>
      <span className="ticker-price">{item.price}</span>
      <span className={item.up ? 'tick-up' : 'tick-dn'}>{item.up ? '▲' : '▼'}{item.chg}%</span>
    </span>
  ))

  return (
    <div className="ticker">
      <div className="ticker-track">{track}{track}</div>
    </div>
  )
}
