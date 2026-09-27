import * as THREE from 'three'
import { wrap01 } from '../core/math'

export interface TrackSample {
  pos: THREE.Vector3
  /** 单位切向（前进方向） */
  tangent: THREE.Vector3
  /** 单位右向 = (-tz, 0, tx)，与卡丁车模型 local +Z 一致 */
  right: THREE.Vector3
  /** 从起点累计的弧长 */
  dist: number
  /** 切向角 atan2(tz, tx) */
  angle: number
}

export interface TrackProgress {
  /** 圈内进度 0..1 */
  t: number
  /** 最近采样点下标（作为下次查询的 hint） */
  index: number
  /** 横向偏移，正 = 赛道右侧 */
  lateral: number
  /** 该处赛道切向角 */
  angle: number
}

/**
 * 中心线样条：既用于生成路面网格，也提供 getProgress 供圈数/名次/AI 走线/出界回正使用。
 */
export class TrackSpline {
  readonly curve: THREE.CatmullRomCurve3
  readonly samples: TrackSample[] = []
  readonly length: number

  constructor(
    points: ReadonlyArray<readonly [number, number]>,
    readonly halfWidth: number,
    segments = 900,
  ) {
    const pts = points.map(([x, z]) => new THREE.Vector3(x, 0, z))
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5)

    let dist = 0
    let prev: THREE.Vector3 | null = null
    for (let i = 0; i < segments; i++) {
      const u = i / segments
      const pos = this.curve.getPointAt(u)
      const tangent = this.curve.getTangentAt(u).setY(0).normalize()
      if (prev) dist += pos.distanceTo(prev)
      prev = pos
      this.samples.push({
        pos,
        tangent,
        right: new THREE.Vector3(-tangent.z, 0, tangent.x),
        dist,
        angle: Math.atan2(tangent.z, tangent.x),
      })
    }
    // 闭合：最后一段回到起点
    this.length = dist + this.samples[this.samples.length - 1].pos.distanceTo(this.samples[0].pos)
  }

  get count(): number {
    return this.samples.length
  }

  sampleAt(t: number): TrackSample {
    const n = this.samples.length
    const i = Math.floor(wrap01(t) * n) % n
    return this.samples[i]
  }

  /** 赛道上某点的世界坐标（带横向偏移） */
  pointAt(t: number, lateral = 0): THREE.Vector3 {
    const s = this.sampleAt(t)
    return s.pos.clone().addScaledVector(s.right, lateral)
  }

  angleAt(t: number): number {
    return this.sampleAt(t).angle
  }

  /**
   * 世界坐标 -> 赛道进度。hint 为上次结果下标，命中局部窗口即可 O(1)。
   */
  getProgress(x: number, z: number, hint = 0): TrackProgress {
    const n = this.samples.length
    const back = 40
    const ahead = 110
    let best = -1
    let bestK = 0
    let bestD = Infinity
    for (let k = -back; k <= ahead; k++) {
      const i = (((hint + k) % n) + n) % n
      const p = this.samples[i].pos
      const dx = x - p.x
      const dz = z - p.z
      const d = dx * dx + dz * dz
      if (d < bestD) {
        bestD = d
        best = i
        bestK = k
      }
    }
    // 落在窗口边缘或离得太远说明 hint 失效（复位/传送），退化为全量搜索
    if (bestK === -back || bestK === ahead || bestD > 90000) {
      bestD = Infinity
      for (let i = 0; i < n; i++) {
        const p = this.samples[i].pos
        const dx = x - p.x
        const dz = z - p.z
        const d = dx * dx + dz * dz
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
    }

    const s = this.samples[best]
    const dx = x - s.pos.x
    const dz = z - s.pos.z
    const along = dx * s.tangent.x + dz * s.tangent.z
    const lateral = dx * s.right.x + dz * s.right.z
    return {
      t: wrap01((s.dist + along) / this.length),
      index: best,
      lateral,
      angle: s.angle,
    }
  }
}
