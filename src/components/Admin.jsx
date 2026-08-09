import React, { useState } from 'react'
import { writeContract } from '../lib/gl.js'
import { CONTRACT, sh } from '../lib/config.js'

export default function Admin({ account, connected, onConnect, notify, admins, loadAdmins, isOwner }) {
  const [input,   setInput]   = useState('')
  const [adding,  setAdding]  = useState(false)
  const [removing,setRemoving]= useState('')

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
          <div className="gate-sub">Only the contract owner can manage admins.</div>
          <button className="btn btn-primary" onClick={onConnect}>Connect Wallet</button>
        </div>
      </div>
    )
  }

  if (!isOwner) {
    return (
      <div className="wrap">
        <div className="gate">
          <div className="gate-title">Owner only</div>
          <div className="gate-sub">This page is only visible to the contract owner.</div>
        </div>
      </div>
    )
  }

  const addAdmin = async () => {
    const addr = input.trim().toLowerCase()
    if (!addr.startsWith('0x') || addr.length !== 42) { notify('Enter a valid wallet address','err'); return }
    if (admins.includes(addr)) { notify('Already an admin','err'); return }
    setAdding(true)
    notify('Adding admin…','ok')
    try {
      await writeContract(CONTRACT, account, 'admin_add', [addr])
      await new Promise(r => setTimeout(r, 4000))
      await loadAdmins()
      setInput('')
      notify('Admin added ✓','ok')
    } catch(e) { notify(e.message,'err') }
    finally { setAdding(false) }
  }

  const removeAdmin = async (addr) => {
    setRemoving(addr)
    notify('Removing admin…','ok')
    try {
      await writeContract(CONTRACT, account, 'admin_remove', [addr])
      await new Promise(r => setTimeout(r, 4000))
      await loadAdmins()
      notify('Admin removed ✓','ok')
    } catch(e) { notify(e.message,'err') }
    finally { setRemoving('') }
  }

  return (
    <div className="wrap">
      <div className="page-head">
        <div className="page-title">Admin</div>
      </div>

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
    </div>
  )
}
