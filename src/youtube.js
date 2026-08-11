const API = 'https://www.googleapis.com/youtube/v3/search'

export async function searchShorts(query, key) {
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoDuration: 'short',
    maxResults: '25',
    q: query,
    key,
  })
  const res = await fetch(`${API}?${params}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
  return (data.items || []).map((item) => ({
    id: item.id.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
  }))
}
