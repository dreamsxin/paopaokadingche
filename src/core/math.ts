export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** 把角度规整到 (-PI, PI] */
export function wrapPi(a: number): number {
  let x = (a + Math.PI) % (Math.PI * 2)
  if (x < 0) x += Math.PI * 2
  return x - Math.PI
}

/** 把进度规整到 [0, 1) */
export function wrap01(t: number): number {
  const x = t % 1
  return x < 0 ? x + 1 : x
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

/** 帧率无关的指数逼近 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

/** 确定性伪随机（不依赖 Math.random，保证赛道装饰/AI 参数可复现） */
export function makeRandom(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "--'--\"---"
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 1000)
  return `${m}'${String(s).padStart(2, '0')}"${String(ms).padStart(3, '0')}`
}
