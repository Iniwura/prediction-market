import React from 'react'

// Catches any uncaught render error anywhere in the component tree.
// Without this, a single undefined-variable bug (like the 'points' crash
// we just fixed) takes down the ENTIRE app to a blank white screen with
// zero indication of what happened. This shows a recoverable message
// instead, and logs the real error to the console for debugging.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('Gen Markets crashed:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          padding: 24, textAlign: 'center', fontFamily: 'system-ui, sans-serif',
          background: '#080B18', color: '#fff',
        }}>
          <div style={{ fontSize: 40 }}>⚠</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: '#9CA3AF', maxWidth: 420, lineHeight: 1.6 }}>
            The app hit an unexpected error. This has been logged. Reloading usually fixes it.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: '#6366F1', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', marginTop: 8,
            }}
          >
            Reload App
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
