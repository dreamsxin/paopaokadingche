import { KartPhysics } from '../physics/KartPhysics'
import { BotDriver } from '../ai/BotDriver'
import type { TrackSpline } from '../track/TrackSpline'
import { DEFAULT_DRIVER_STATS, DEFAULT_KART_STATS, NEUTRAL_INPUT, type KartInput } from '../types'
import { wrapPi } from '../core/math'

/** 检查点数量，用于防止抄近道 / 倒车刷圈 */
const CP_COUNT = 8
/** 离开路面这么远就复位回赛道 */
const RESPAWN_LATERAL = 16
const KART_RADIUS = 1.6

export interface RacerInit {
  id: string
  name: string
  isPlayer: boolean
  color: number
  /** AI 水平 0..1，玩家忽略 */
  skill?: number
}

export interface Racer {
  id: string
  name: string
  isPlayer: boolean
  color: number
  kart: KartPhysics
  bot: BotDriver | null
  lap: number
  t: number
  prevT: number
  hint: number
  cps: boolean[]
  progress: number
  rank: number
  lapStart: number
  lapTimes: number[]
  bestLap: number
  finished: boolean
  finishTime: number
  lateral: number
  /** 最近一帧的转向输入，仅用于前轮视觉 */
  lastSteer: number
}

export class RaceDirector {
  readonly racers: Racer[] = []
  /** 排名顺序（第 1 名在前） */
  ranking: Racer[] = []
  time = 0
  frozen = true
  finishedAll = false
  /** 玩家刚刚完成的圈（供 HUD 播报），消费后置空 */
  lapFlash: { lap: number; time: number } | null = null

  constructor(
    readonly track: TrackSpline,
    inits: RacerInit[],
    readonly totalLaps = 3,
  ) {
    inits.forEach((init, i) => {
      const kart = new KartPhysics({ ...DEFAULT_KART_STATS }, { ...DEFAULT_DRIVER_STATS })
      const racer: Racer = {
        id: init.id,
        name: init.name,
        isPlayer: init.isPlayer,
        color: init.color,
        kart,
        bot: init.isPlayer
          ? null
          : new BotDriver(kart, track, init.skill ?? 0.6, 100 + i * 37),
        lap: 0,
        t: 0,
        prevT: 0,
        hint: 0,
        cps: new Array(CP_COUNT).fill(false),
        progress: 0,
        rank: i + 1,
        lapStart: 0,
        lapTimes: [],
        bestLap: Infinity,
        finished: false,
        finishTime: 0,
        lateral: 0,
        lastSteer: 0,
      }
      this.racers.push(racer)
    })
    this.ranking = [...this.racers]
    this.placeOnGrid()
  }

  get player(): Racer {
    return this.racers.find((r) => r.isPlayer) ?? this.racers[0]
  }

  /** 发车格：两列错开排在起跑线之后 */
  placeOnGrid(): void {
    const len = this.track.length
    const hw = this.track.halfWidth
    this.racers.forEach((r, i) => {
      const row = i >> 1
      const col = i % 2 === 0 ? -1 : 1
      const back = 10 + row * 8
      const t = (1 + (-back / len)) % 1
      const pos = this.track.pointAt(t, col * hw * 0.42)
      r.kart.reset(pos.x, pos.z, this.track.angleAt(t))
      r.kart.frozen = true
      // lap = -1 表示还没越过起跑线；第一次越线 -> 0，即第 1 圈开始
      r.lap = -1
      r.t = t
      r.prevT = t
      r.hint = Math.floor(t * this.track.count)
      // 发车格在起跑线之后，预先点亮检查点，保证起步越线被正常计入
      r.cps.fill(true)
      r.progress = r.lap + t
      r.lapTimes = []
      r.bestLap = Infinity
      r.finished = false
      r.finishTime = 0
    })
    this.time = 0
    this.frozen = true
    this.finishedAll = false
  }

  /** 倒计时结束：解冻并给起步加速 */
  startRace(): void {
    this.frozen = false
    this.time = 0
    for (const r of this.racers) {
      r.kart.frozen = false
      r.lapStart = 0
      r.kart.drift.launch()
    }
  }

  update(dt: number, playerInput: KartInput): void {
    if (!this.frozen) this.time += dt

    for (const r of this.racers) {
      const k = r.kart
      const pr = this.track.getProgress(k.x, k.z, r.hint)
      r.hint = pr.index
      r.t = pr.t
      r.lateral = pr.lateral
      k.offRoad = Math.abs(pr.lateral) > this.track.halfWidth

      if (Math.abs(pr.lateral) > RESPAWN_LATERAL) this.respawn(r)
      this.updateLap(r)

      let input: KartInput
      if (this.frozen) {
        input = NEUTRAL_INPUT
      } else if (r.finished) {
        // 冲线后交给 AI 自动驾驶收尾
        input = (r.bot ?? this.autopilot(r)).think(dt, pr)
      } else if (r.isPlayer) {
        input = playerInput
      } else {
        input = r.bot!.think(dt, pr)
      }
      k.update(dt, input)
      r.lastSteer = input.steer
      r.progress = r.lap + r.t
    }

    this.resolveCollisions()
    this.updateRanking()
  }

  private autopilot(r: Racer): BotDriver {
    r.bot = new BotDriver(r.kart, this.track, 0.5, 7)
    return r.bot
  }

  private respawn(r: Racer): void {
    const pos = this.track.pointAt(r.t, 0)
    const angle = this.track.angleAt(r.t)
    const keep = Math.max(0, r.kart.speed * 0.25)
    r.kart.reset(pos.x, pos.z, angle)
    r.kart.speed = keep
    r.hint = Math.floor(r.t * this.track.count)
  }

  private updateLap(r: Racer): void {
    const cp = Math.min(CP_COUNT - 1, Math.floor(r.t * CP_COUNT))
    r.cps[cp] = true
    const d = r.t - r.prevT
    if (d < -0.5) {
      // 正向越过起跑线
      const passed = r.cps.filter(Boolean).length
      if (passed >= CP_COUNT - 1) {
        const lapTime = this.time - r.lapStart
        r.lapStart = this.time
        r.lap += 1
        r.cps.fill(false)
        if (r.lap >= 1) {
          r.lapTimes.push(lapTime)
          if (lapTime < r.bestLap) r.bestLap = lapTime
          if (r.isPlayer) this.lapFlash = { lap: r.lap, time: lapTime }
        }
        if (r.lap >= this.totalLaps && !r.finished) {
          r.finished = true
          r.finishTime = this.time
          if (r.isPlayer) this.finishedAll = true
        }
      }
    } else if (d > 0.5) {
      // 倒车退过起跑线
      if (r.lap > -1) r.lap -= 1
      r.cps.fill(true)
    }
    r.prevT = r.t
  }

  private resolveCollisions(): void {
    const n = this.racers.length
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.racers[i].kart
        const b = this.racers[j].kart
        let dx = b.x - a.x
        let dz = b.z - a.z
        const distSq = dx * dx + dz * dz
        const min = KART_RADIUS * 2
        if (distSq > min * min || distSq < 1e-6) continue
        const dist = Math.sqrt(distSq)
        const nx = dx / dist
        const nz = dz / dist
        const push = (min - dist) * 0.5
        a.x -= nx * push
        a.z -= nz * push
        b.x += nx * push
        b.z += nz * push
        // 追尾方掉速，被撞方轻微提速（街机式碰撞）
        const relA = a.speed * (Math.cos(a.velAngle) * nx + Math.sin(a.velAngle) * nz)
        if (relA > 0) {
          a.speed *= 0.93
          b.speed = Math.min(b.speed + relA * 0.06, b.stats.maxSpeed * 1.2)
        }
      }
    }
  }

  private updateRanking(): void {
    this.ranking = [...this.racers].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      if (a.finished && b.finished) return a.finishTime - b.finishTime
      return b.progress - a.progress
    })
    this.ranking.forEach((r, i) => (r.rank = i + 1))
  }

  /** 当前车头与赛道方向是否反了（HUD 提示逆行） */
  isWrongWay(r: Racer): boolean {
    return Math.abs(wrapPi(this.track.angleAt(r.t) - r.kart.heading)) > 2 && r.kart.speed > 6
  }
}
