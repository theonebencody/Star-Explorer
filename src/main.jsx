import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/tokens.css'
import './styles/layout.css'
import './styles/home.css'
import './styles/micro.css'
import './styles/global.css'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(<App />)

// Register service worker for caching
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/Infinita/sw.js').catch(() => {})
  })
}
