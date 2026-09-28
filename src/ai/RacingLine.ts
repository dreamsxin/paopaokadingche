import type { TrackSpline } from '../track/TrackSpline'
import { clamp, wrap01, wrapPi } from '../core/math'

export interface RacingLineOptions {
  /** 可用侧向加速度 m/s^2，决定过弯极限速度 */
  latAccel?: number
  /** 减速能力 m/s^2，用于把弯道限速往前回推成刹车点 */
  decel?: number
  /** 走线最多贴到路宽的比例 */
  gripWidth?: number
}

/**
 * 赛道走线：一次性预计算「每个采样点的目标横向偏移」与「安全速度上限」。
 * - 偏移用平滑后的曲率生成，并再做一次宽窗平滑，自然形成"外-内-外"的进弯/出弯轨迹
 * - 限速用 v = sqrt(a_lat / |κ|)，再做一次反向回推，得到提前刹车的速度剖面
 * 所有 AI 共享同一条线（只读），不产生额外每帧开销。
 */
export class RacingLine {
  readonly offsets: Float32Array
  readonly limits: Float32Array
  /** 平滑后的带符号曲率，正 = 向右（+lateral 方向）转 */
  readonly curvature: Float32Array
  private readonly ds: number

  constructor(
    private readonly track: TrackSpline,
    opts: RacingLineOptions = {},
  ) {
    const latAccel = opts.latAccel ?? 30
    const decel = opts.decel ?? 20
    const gripWidth = opts.gripWidth ?? 0.62
    const n = track.count
    const hw = track.halfWidth
    this.ds = track.length / n

    // 1) 曲率
    const raw = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const prev = track.samples[(i - 1 + n) % n].angle
      const next = track.samples[(i + 1) % n].angle
      raw[i] = wrapPi(next - prev) / (2 * this.ds)
    }
    this.curvature = smoothRing(raw, 6)

    // 2) 目标偏移：贴内线，再宽窗平滑出进/出弯的外侧余量
    // kRef 对应赛道最急弯的量级（彩虹村庄最小半径约 50m），保证急弯能吃满内线
    const kRef = 1 / 55
    const inside = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      inside[i] = clamp(this.curvature[i] / kRef, -1, 1) * hw * gripWidth
    }
    this.offsets = smoothRing(inside, 12)

    // 3) 弯道极限速度
    const limits = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const k = Math.max(Math.abs(this.curvature[i]), 1e-5)
      limits[i] = clamp(Math.sqrt(latAccel / k), 16, 120)
    }
    // 4) 反向回推刹车点（环形，多跑几圈让闭环收敛）
    for (let pass = 0; pass < 3; pass++) {
      for (let step = n - 1; step >= 0; step--) {
        const i = step
        const next = limits[(i + 1) % n]
        const reachable = Math.sqrt(next * next + 2 * decel * this.ds)
        if (limits[i] > reachable) limits[i] = reachable
      }
    }
    this.limits = limits
  }

  private indexAt(t: number): number {
    const n = this.track.count
    return Math.floor(wrap01(t) * n) % n
  }

  /** 该进度处的目标横向偏移 */
  offsetAt(t: number): number {
    return this.offsets[this.indexAt(t)]
  }

  /** 该进度处的安全速度上限 */
  limitAt(t: number): number {
    return this.limits[this.indexAt(t)]
  }

  curvatureAt(t: number): number {
    return this.curvature[this.indexAt(t)]
  }

  /** 未来 distance 米内的最低限速，用于决定何时收油/刹车 */
  minLimitAhead(t: number, distance: number): number {
    const n = this.track.count
    const steps = Math.max(1, Math.ceil(distance / this.ds))
    let start = this.indexAt(t)
    let min = Infinity
    for (let s = 0; s <= steps; s++) {
      const v = this.limits[(start + s) % n]
      if (v < min) min = v
    }
    return min
  }

  /** 未来 distance 米内绝对值最大的带符号曲率，用来判断即将到来的弯有多急、朝哪边 */
  peakCurvatureAhead(t: number, distance: number): number {
    const n = this.track.count
    const steps = Math.max(1, Math.ceil(distance / this.ds))
    const start = this.indexAt(t)
    let peak = 0
    for (let s = 0; s <= steps; s++) {
      const k = this.curvature[(start + s) % n]
      if (Math.abs(k) > Math.abs(peak)) peak = k
    }
    return peak
  }

  /** 走线上某点的世界坐标 */
  pointAt(t: number) {
    return this.track.pointAt(t, this.offsetAt(t))
  }

  /** 该进度处走线的切向角（含偏移带来的倾斜），用于判断出弯方向 */
  lineAngleAt(t: number, aheadMeters = 6): number {
    const a = this.pointAt(t)
    const b = this.pointAt(t + aheadMeters / this.track.length)
    return Math.atan2(b.z - a.z, b.x - a.x)
  }
}

/** 环形滑动平均 */
function smoothRing(src: Float32Array, radius: number): Float32Array {
  const n = src.length
  const out = new Float32Array(n)
  const width = radius * 2 + 1
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let k = -radius; k <= radius; k++) sum += src[(i + k + n) % n]
    out[i] = sum / width
  }
  return out
}

const cache = new WeakMap<TrackSpline, RacingLine>()

/** 同一条赛道共享一条走线 */
export function getRacingLine(track: TrackSpline): RacingLine {
  let line = cache.get(track)
  if (!line) {
    line = new RacingLine(track)
    cache.set(track, line)
  }
  return line
}
