import { useEffect, useRef, useState } from "react";
import { searchShorts } from "./youtube.js";

// Key comes from the build-time env var, or from localStorage so the widget can
// be configured without a rebuild.
const envKey = import.meta.env.VITE_YT_API_KEY || "";

// macOS 위젯(WKWebView)이 이 페이지를 불러올 때는 URL 뒤에 ?embed=1 을 붙여서 로드함.
// 이 값이 있으면 검색창/제목/자체 버튼 같은 브라우저용 UI를 다 숨기고 영상만 보여줌
// (Swift가 이미 자체 검색 + 자체 글래스 버튼/투명도 슬라이더를 갖고 있어서 중복됨).
const isEmbed =
  new URLSearchParams(window.location.search).get("embed") === "1";

export default function App() {
  const [key, setKey] = useState(envKey || localStorage.getItem("ytKey") || "");
  const [query, setQuery] = useState(localStorage.getItem("lastQuery") || "");
  const [videos, setVideos] = useState([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  const player = useRef(null);
  const queue = useRef([]); // video ids, source of truth for the Swift bridge
  const cursor = useRef(0);
  const pending = useRef(null); // queue handed over before the player was ready
  const mountRef = useRef(null);
  const skippedCount = useRef(0); // 연속 재생 실패 개수 (전부 실패 시 무한루프 방지용)
  const requestingMoreRef = useRef(false); // Swift에 다음 페이지 요청 중복 방지용

  // --- YouTube IFrame API + window bridge --------------------------------
  // Swift calls these by name through evaluateJavaScript, so every one of them
  // has to live on window, not just in this component's scope.
  useEffect(() => {
    // 큐 끝에서 5개 이내로 남으면 Swift한테 "더 줘" 신호를 보내서 검색 결과가
    // 끊기지 않고 계속 이어지게 함 (진짜 쇼츠 피드처럼 무한 스크롤)
    function maybeRequestMore() {
      const remaining = queue.current.length - 1 - cursor.current;
      if (remaining > 5 || requestingMoreRef.current) return;
      requestingMoreRef.current = true;
      try {
        window.webkit.messageHandlers.requestMore.postMessage("more");
      } catch (e) {}
    }

    function play(i, { autoplay = true } = {}) {
      const ids = queue.current;
      if (!ids.length || !player.current) return;
      // 끝에서 clamp(고정)하지 않고 modulo로 순환시켜서, 마지막 영상 이후에도
      // 멈추지 않고 처음부터 계속 이어지게 함 (음수 인덱스도 안전하게 처리)
      const len = ids.length;
      cursor.current = ((i % len) + len) % len;
      setIndex(cursor.current);
      const args = { videoId: ids[cursor.current] };
      if (autoplay) player.current.loadVideoById(args);
      else player.current.cueVideoById(args);
      maybeRequestMore();
    }

    // volume: 0~100 정수 (YT IFrame API 스케일). Swift 볼륨 슬라이더(0~1)에 100을 곱해서 넘겨줌.
    // 음소거는 따로 관리하지 않고 이 함수 하나가 다 처리함: 0이면 음소거, 0보다 크면 그 크기로 소리 남
    window.setVolumeLevel = (volume) => {
      if (!player.current) return;
      if (volume <= 0) player.current.mute();
      else {
        player.current.unMute();
        player.current.setVolume(volume);
      }
    };

    // Swift가 다음 페이지 검색 결과를 가져오면 이 함수로 큐 끝에 이어붙임
    window.appendQueue = (ids) => {
      const fresh = Array.isArray(ids) ? ids.filter(Boolean) : [];
      if (!fresh.length) return;
      queue.current = [...queue.current, ...fresh];
      requestingMoreRef.current = false; // 새로 받았으니 나중에 또 부족해지면 다시 요청 가능하게
    };

    window.loadQueue = (ids, volume) => {
      queue.current = Array.isArray(ids) ? ids.filter(Boolean) : [];
      cursor.current = 0;
      setIndex(0);
      requestingMoreRef.current = false;
      if (!player.current) {
        pending.current = { ids: queue.current, volume };
        return;
      }
      window.setVolumeLevel(volume);
      play(0);
    };
    window.playNext = () => play(cursor.current + 1);
    window.playPrevious = () => play(cursor.current - 1);
    window.togglePlayPause = () => {
      if (!player.current) return;
      // 1 === YT.PlayerState.PLAYING
      if (player.current.getPlayerState() === 1) player.current.pauseVideo();
      else player.current.playVideo();
    };
    window.resumePlaying = () => player.current?.playVideo();

    function createPlayer() {
      if (player.current || !mountRef.current) return;
      player.current = new window.YT.Player(mountRef.current, {
        host: "https://www.youtube-nocookie.com",
        // autoplay/mute를 명시적으로 안 주면 브라우저 자동재생 정책에 막혀서
        // "재생하려면 클릭" 상태(유튜브 로고만 뜨는 화면)로 멈춰있게 됨
        playerVars: {
          autoplay: 1,
          mute: 1,
          controls: 0,
          playsinline: 1,
          modestbranding: 1,
          rel: 0,
          fs: 0,
          disablekb: 1,
        },
        events: {
          onReady: () => {
            setReady(true);
            const queued = pending.current;
            pending.current = null;
            if (queued) window.loadQueue(queued.ids, queued.volume);
          },
          onStateChange: (e) => {
            if (e.data === 1) skippedCount.current = 0; // 1 === PLAYING: 정상 재생되면 실패 카운트 리셋
            if (e.data === 0) window.playNext(); // 0 === ENDED: 다음 영상으로 이어서 재생
          },
          // 소유자가 임베드를 막았거나, 삭제/비공개/연령제한 등으로 재생 불가한 영상을 만나면
          // "오류가 발생했습니다" 화면에서 멈추지 말고 자동으로 다음 영상으로 넘어감
          onError: () => {
            skippedCount.current += 1;
            if (skippedCount.current >= queue.current.length) return; // 전부 실패 시 무한루프 방지
            window.playNext();
          },
        },
      });
    }

    // The API script fires this global exactly once when it finishes loading.
    window.onYouTubeIframeAPIReady = createPlayer;

    if (window.YT?.Player) {
      createPlayer();
    } else if (!document.getElementById("yt-iframe-api")) {
      const script = document.createElement("script");
      script.id = "yt-iframe-api";
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }

    // ponytail: globals are left installed on unmount on purpose — Swift may
    // call them at any time and this component lives for the page's lifetime.
  }, []);

  // --- search UI (embed 모드에서는 아예 쓰지 않음) -------------------------
  async function run(e) {
    e?.preventDefault();
    if (!query.trim() || !key) return;
    setLoading(true);
    setError("");
    try {
      const items = await searchShorts(query.trim(), key);
      setVideos(items);
      localStorage.setItem("lastQuery", query.trim());
      if (items.length === 0) setError("결과 없음");
      else
        window.loadQueue(
          items.map((v) => v.id),
          100,
        ); // 브라우저에서 직접 테스트할 땐 소리 켜진 채로
    } catch (err) {
      setError(err.message);
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isEmbed) return; // 위젯 안에서는 키보드 단축키도 필요 없음 (네이티브 버튼으로 제어)
    function onKey(e) {
      if (e.target.tagName === "INPUT") return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") window.playNext();
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") window.playPrevious();
      if (e.key === " ") {
        e.preventDefault();
        window.togglePlayPause();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function saveKey(value) {
    setKey(value);
    localStorage.setItem("ytKey", value);
  }

  const current = videos[index];

  return (
    <div className={isEmbed ? "app app--embed" : "app"}>
      {!isEmbed && (
        <form className="bar" onSubmit={run}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="쇼츠 검색"
          />
          <button type="submit" disabled={loading || !key || !ready}>
            {loading ? "..." : "검색"}
          </button>
        </form>
      )}

      {!isEmbed && !envKey && (
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
        {!isEmbed && !videos.length && (
          <div className="empty">{error || "검색어를 입력하세요"}</div>
        )}
      </div>

      {!isEmbed && current && (
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
      {!isEmbed && !!videos.length && error && (
        <div className="err">{error}</div>
      )}
    </div>
  );
}
