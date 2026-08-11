import { useEffect, useRef, useState } from 'react'
import { searchShorts } from './youtube.js'

// Key comes from the build-time env var, or from localStorage so the widget can
// be configured without a rebuild.
const envKey = import.meta.env.VITE_YT_API_KEY || ''

export default function App() {
  const [key, setKey] = useState(envKey || localStorage.getItem('ytKey') || '')
  const [query, setQuery] = useState(localStorage.getItem('lastQuery') || '')
  const [videos, setVideos] = useState([])
  const [index, setIndex] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)

  const player = useRef(null)
  const queue = useRef([]) // video ids, source of truth for the Swift bridge
  const cursor = useRef(0)
  const pending = useRef(null) // queue handed over before the player was ready
  const mountRef = useRef(null)

  // --- YouTube IFrame API + window bridge --------------------------------
  // Swift calls these by name through evaluateJavaScript, so every one of them
  // has to live on window, not just in this component's scope.
  useEffect(() => {
    function play(i, { autoplay = true } = {}) {
      const ids = queue.current
      if (!ids.length || !player.current) return
      cursor.current = Math.min(Math.max(i, 0), ids.length - 1)
      setIndex(cursor.current)
      const args = { videoId: ids[cursor.current] }
      if (autoplay) player.current.loadVideoById(args)
      else player.current.cueVideoById(args)
    }

    window.loadQueue = (ids, muted) => {
      queue.current = Array.isArray(ids) ? ids.filter(Boolean) : []
      cursor.current = 0
      setIndex(0)
      if (!player.current) {
        pending.current = { ids: queue.current, muted }
        return
      }
      if (muted) player.current.mute()
      else player.current.unMute()
      play(0)
    }
    window.playNext = () => play(cursor.current + 1)
    window.playPrevious = () => play(cursor.current - 1)
    window.togglePlayPause = () => {
      if (!player.current) return
      // 1 === YT.PlayerState.PLAYING
      if (player.current.getPlayerState() === 1) player.current.pauseVideo()
      else player.current.playVideo()
    }
    window.resumePlaying = () => player.current?.playVideo()
    window.muteVideo = () => player.current?.mute()
    window.unmuteVideo = () => player.current?.unMute()

    function createPlayer() {
      if (player.current || !mountRef.current) return
      player.current = new window.YT.Player(mountRef.current, {
        host: 'https://www.youtube-nocookie.com',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            setReady(true)
            const queued = pending.current
            pending.current = null
            if (queued) window.loadQueue(queued.ids, queued.muted)
          },
          // 0 === ENDED: keep the feed rolling like a shorts reel.
          onStateChange: (e) => {
            if (e.data === 0) window.playNext()
          },
        },
      })
    }

    // The API script fires this global exactly once when it finishes loading.
    window.onYouTubeIframeAPIReady = createPlayer

    if (window.YT?.Player) {
      createPlayer()
    } else if (!document.getElementById('yt-iframe-api')) {
      const script = document.createElement('script')
      script.id = 'yt-iframe-api'
      script.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(script)
    }

    // ponytail: globals are left installed on unmount on purpose — Swift may
    // call them at any time and this component lives for the page's lifetime.
  }, [])

  // --- search UI ---------------------------------------------------------
  async function run(e) {
    e?.preventDefault()
    if (!query.trim() || !key) return
    setLoading(true)
    setError('')
    try {
      const items = await searchShorts(query.trim(), key)
      setVideos(items)
      localStorage.setItem('lastQuery', query.trim())
      if (items.length === 0) setError('결과 없음')
      else window.loadQueue(items.map((v) => v.id), true)
    } catch (err) {
      setError(err.message)
      setVideos([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT') return
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') window.playNext()
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') window.playPrevious()
      if (e.key === ' ') {
        e.preventDefault()
        window.togglePlayPause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function saveKey(value) {
    setKey(value)
    localStorage.setItem('ytKey', value)
  }

  const current = videos[index]

  return (
    <div className="app">
      <form className="bar" onSubmit={run}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="쇼츠 검색"
        />
        <button type="submit" disabled={loading || !key || !ready}>
          {loading ? '...' : '검색'}
        </button>
      </form>

      {!envKey && (
        <input
          className="keyInput"
          type="password"
          value={key}
          onChange={(e) => saveKey(e.target.value)}
          placeholder="YouTube Data API v3 키"
        />
      )}

      <div className="stage">
        <div className="frame">
          <div ref={mountRef} />
        </div>
        {!videos.length && (
          <div className="empty">{error || '검색어를 입력하세요'}</div>
        )}
      </div>

      {current && (
        <div className="meta">
          <div className="title">{current.title}</div>
          <div className="sub">
            {current.channel} · {index + 1}/{videos.length}
          </div>
          <div className="nav">
            <button onClick={() => window.playPrevious()}>↑</button>
            <button onClick={() => window.togglePlayPause()}>⏯</button>
            <button onClick={() => window.playNext()}>↓</button>
          </div>
        </div>
      )}
      {!!videos.length && error && <div className="err">{error}</div>}
    </div>
  )
}
