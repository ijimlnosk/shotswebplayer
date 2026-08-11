import test from 'node:test'
import assert from 'node:assert/strict'
import { searchShorts } from './youtube.js'

function stubFetch(ok, body) {
  globalThis.fetch = async (url) => {
    stubFetch.lastUrl = url
    return { ok, json: async () => body }
  }
}

test('maps items and requests short videos only', async () => {
  stubFetch(true, {
    items: [
      {
        id: { videoId: 'abc123' },
        snippet: { title: 'hi', channelTitle: 'chan' },
      },
    ],
  })
  const out = await searchShorts('cats', 'KEY')
  assert.deepEqual(out, [{ id: 'abc123', title: 'hi', channel: 'chan' }])
  assert.match(stubFetch.lastUrl, /videoDuration=short/)
  assert.match(stubFetch.lastUrl, /q=cats/)
})

test('throws the API error message on failure', async () => {
  stubFetch(false, { error: { message: 'quota exceeded' } })
  await assert.rejects(() => searchShorts('cats', 'KEY'), /quota exceeded/)
})

test('empty response yields empty list', async () => {
  stubFetch(true, {})
  assert.deepEqual(await searchShorts('cats', 'KEY'), [])
})
