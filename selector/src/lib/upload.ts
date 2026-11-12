import { api, post } from './api'
import { deviceHeaders } from './device'
import { isAppleTouch } from './platform'
import type { UploadStarted } from '@shared/api'

export interface UploadHandle {
  promise: Promise<string>
  pause(): void
  resume(): void
  cancel(): void
}

const STORE = 'renplay:uploads'
/**
 * iPhone Safari reports upload progress rarely, and may not hand over the answer of a chunk the
 * server already has. A chunk quiet for CHECK_MS asks the server whether it arrived; one quiet for
 * STALL_MS that the server does not have is sent again.
 */
const CHECK_MS = 5_000
// Long enough for a 32 MB chunk on a slow mobile connection (about 0.3 MB/s).
const STALL_MS = 120_000
/**
 * Chunks in flight at once: a stalled one does not hold the others up. iPhone and iPad send one at
 * a time: measured on an iPhone over Wi-Fi, one 32 MB chunk at a time moved 23 to 27 MB/s, four
 * 8 MB chunks at once 5 MB/s together.
 */
const PARALLEL = 4
const TOUCH_PARALLEL = 1

function remember(file: File, id: string) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || '{}')
    all[`${file.name}:${file.size}:${file.lastModified}`] = id
    localStorage.setItem(STORE, JSON.stringify(all))
  } catch {}
}

function recall(file: File): string | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}')[`${file.name}:${file.size}:${file.lastModified}`] ?? null
  } catch {
    return null
  }
}

function forget(file: File) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || '{}')
    delete all[`${file.name}:${file.size}:${file.lastModified}`]
    localStorage.setItem(STORE, JSON.stringify(all))
  } catch {}
}

type Ranges = Array<[number, number]>

/** The chunks a file still needs, given the byte ranges the server has. */
function missing(size: number, chunk: number, have: Ranges): number[] {
  const out: number[] = []
  for (let at = 0; at < size; at += chunk) {
    const end = Math.min(size, at + chunk)
    if (!have.some(([a, b]) => a <= at && b >= end)) out.push(at)
  }
  return out
}

/**
 * Uploads a (possibly huge) archive in chunks, a few at once. Each chunk is its own request, so
 * proxies with request timeouts are fine. A chunk that stalls is sent again after a few seconds
 * while the others go on, and an interrupted upload resumes with what the server lacks (also after
 * a page reload, for the same file).
 */
export function uploadArchive(file: File, onProgress: (sent: number, total: number) => void): UploadHandle {
  let paused = false
  let cancelled = false
  let wake: Array<() => void> = []
  const requests = new Set<XMLHttpRequest>()
  const inFlight = new Map<number, number>()
  // When any chunk last moved: a chunk waiting for a free connection is not stalled while others move.
  let anyMoved = Date.now()
  let done = 0
  const report = () => onProgress(Math.min(file.size, done + [...inFlight.values()].reduce((a, b) => a + b, 0)), file.size)

  const problem = (id: string, e: unknown) =>
    void post(`/api/uploads/${id}/problem`, { message: `${(e as Error)?.name ?? 'Error'}: ${(e as Error)?.message ?? e}` }).catch(() => {})

  const sendChunk = (id: string, offset: number, data: Blob) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      requests.add(xhr)
      xhr.open('PUT', `/api/uploads/${id}?offset=${offset}`)
      for (const [name, value] of Object.entries(deviceHeaders())) xhr.setRequestHeader(name, value)
      let moved = Date.now()
      let started = false
      let arrived = false
      let checking = false
      const watch = setInterval(async () => {
        const now = Date.now()
        if (now - moved > STALL_MS && (started || now - anyMoved > STALL_MS)) {
          problem(id, new Error(`The chunk at ${Math.round(offset / 1048576)} MB stalled ${started ? 'partway' : 'before sending'}, sending it again`))
          xhr.abort()
        } else if (now - moved > CHECK_MS && !checking) {
          checking = true
          try {
            const s = await api<{ ranges?: Ranges }>(`/api/uploads/${id}`)
            if ((s.ranges ?? []).some(([a, b]) => a <= offset && b >= offset + data.size)) {
              arrived = true
              xhr.abort()
            }
          } catch {}
          checking = false
        }
      }, 2500)
      xhr.upload.onprogress = (e) => {
        moved = anyMoved = Date.now()
        if (e.loaded > 0) started = true
        inFlight.set(offset, e.loaded)
        report()
      }
      xhr.onloadend = () => {
        clearInterval(watch)
        requests.delete(xhr)
        inFlight.delete(offset)
      }
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)))
      xhr.onerror = () => reject(new Error('Network error'))
      xhr.onabort = () => (arrived ? resolve() : reject(new Error('stalled')))
      xhr.send(data)
    })

  const promise = (async () => {
    let id = recall(file)
    let chunk = 32 << 20
    let have: Ranges = []
    if (id) {
      try {
        const s = await api<{ received: number; size: number; ranges?: Ranges }>(`/api/uploads/${id}`)
        if (s.size === file.size) have = s.ranges ?? [[0, s.received]]
        else id = null
      } catch {
        id = null
      }
    }
    if (!id) {
      const r = await post<UploadStarted>('/api/uploads', { name: file.name, size: file.size })
      id = r.id
      chunk = r.chunkSize
      remember(file, id)
    }
    const queue = missing(file.size, chunk, have)
    done = file.size - queue.reduce((sum, at) => sum + Math.min(chunk, file.size - at), 0)
    report()
    const tries = new Map<number, number>()
    const upload = id

    const worker = async () => {
      for (;;) {
        if (cancelled) throw new Error('Upload cancelled')
        if (paused) await new Promise<void>((r) => wake.push(r))
        const at = queue.shift()
        if (at === undefined) return
        const length = Math.min(chunk, file.size - at)
        try {
          await sendChunk(upload, at, file.slice(at, at + length))
          done += length
          report()
        } catch (e) {
          if (cancelled) throw new Error('Upload cancelled')
          queue.unshift(at)
          if (paused) continue
          const n = (tries.get(at) ?? 0) + 1
          tries.set(at, n)
          if (n > 8) throw e
          // A stall is sent again at once. A network error waits a little longer each time.
          if ((e as Error).message !== 'stalled') await new Promise((r) => setTimeout(r, Math.min(15000, 500 * 2 ** n)))
        }
      }
    }
    await Promise.all(Array.from({ length: isAppleTouch() ? TOUCH_PARALLEL : PARALLEL }, worker))
    const finished = await post<{ path: string }>(`/api/uploads/${upload}/complete`)
    forget(file)
    return finished.path
  })()
  // A worker that fails stops the others: they see cancelled.
  promise.catch(() => {
    cancelled = true
    for (const r of requests) r.abort()
    for (const w of wake) w()
    wake = []
  })

  return {
    promise,
    pause() {
      paused = true
      for (const r of requests) r.abort()
    },
    resume() {
      paused = false
      for (const w of wake) w()
      wake = []
    },
    cancel() {
      cancelled = true
      paused = false
      for (const r of requests) r.abort()
      for (const w of wake) w()
      wake = []
      const id = recall(file)
      forget(file)
      if (id) void fetch(`/api/uploads/${id}`, { method: 'DELETE', headers: deviceHeaders() })
    },
  }
}
