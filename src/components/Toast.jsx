import React, { useEffect } from 'react'

export default function Toast({ message, type, onClear }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onClear, 4000)
    return () => clearTimeout(t)
  }, [message])

  if (!message) return null
  return <div className={`toast show ${type}`}>{message}</div>
}
