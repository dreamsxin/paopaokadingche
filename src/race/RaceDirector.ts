import { KartPhysics } from '../physics/KartPhysics'
import { BotDriver } from '../ai/BotDriver'
import type { TrackSpline } from '../track/TrackSpline'
import { DEFAULT_DRIVER_STATS, NEUTRAL_INPUT, type KartInput } from '../types'
import { getModel } from '../karts/catalog'
import { createStats, type RaceStatsData } from './RaceStats'
import { wrapPi } from '../core/math'

/** 检查点数量，用于防止抄近道 / 倒车刷圈 */
const CP_COUNT = 8
/** 路肩之外的缓冲宽度，超过即撞护栏（与 TrackBuilder 的护栏位置一致） */
const WALL_MARGIN = 4
/** 离开路面这么远就复位回赛道（撞墙已经兜住，这里只是保险） */
const RESPAWN_LATERAL = 16
const KART_RADIUS = 1.6

export interface RacerInit {
  id: string
  name: string
  isPlayer: boolean
  color: number
  /** AI 水平 0..1，玩家忽略 */
  skill?: number
  /** 车型 id，缺省用目录第一台 */
  modelId?: string
}

export interface Racer {
  id: string
  name: string
  isPlayer: boolean
  color: number
  modelId: string
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
  /** 本场技术统计 */
  stats: RaceStatsData
  /** 本圈各分段用时（索引 = 分段号） */
  sectors: number[]
  /** 最佳圈的分段用时，用于实时对比 */
  bestSectors: number[]
  lastCp: number
  lastWallTime: number
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
  /** 玩家刚过一个分段与自己最佳圈的差值（负=更快），消费后置空 */
  sectorFlash: { sector: number; delta: number } | null = null
  /** 玩家刚刚打出最佳化漂移小喷（供 HUD 播报 Perfect），消费后置 false */
  perfectFlash = false

  constructor(
    readonly track: TrackSpline,
    inits: RacerInit[],
    readonly totalLaps = 3,
  ) {
    inits.forEach((init, i) => {
      const model = getModel(init.modelId)
      const kart = new KartPhysics({ ...model.stats }, { ...DEFAULT_DRIVER_STATS })
      const racer: Racer = {
        id: init.id,
        name: init.name,
        isPlayer: init.isPlayer,
        color: init.color,
        modelId: model.id,
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
        stats: createStats(),
        sectors: new Array(CP_COUNT).fill(0),
        bestSectors: [],
        lastCp: 0,
        lastWallTime: -1,
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
      r.stats = createStats()
      r.sectors = new Array(CP_COUNT).fill(0)
      r.bestSectors = []
      r.lastCp = Math.min(CP_COUNT - 1, Math.floor(t * CP_COUNT))
      r.lastWallTime = -1
    })
    this.time = 0
    this.frozen = true
    this.finishedAll = false
    this.sectorFlash = null
    this.lapFlash = null
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

      const wall = this.track.halfWidth + WALL_MARGIN
      if (Math.abs(pr.lateral) > wall) this.hitWall(r, pr.t, wall, Math.sign(pr.lateral))
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
      if (!this.frozen) this.collectStats(r, dt)
    }

    this.resolveCollisions()
    this.updateRanking()
  }

  private autopilot(r: Racer): BotDriver {
    r.bot = new BotDriver(r.kart, this.track, 0.5, 7)
    return r.bot
  }

  /** 消费漂移事件并累积技术统计 */
  private collectStats(r: Racer, dt: number): void {
    const k = r.kart
    const s = r.stats
    s.topSpeed = Math.max(s.topSpeed, k.kmh)
    if (k.drift.state === 'drifting') s.driftTime += dt
    if (k.offRoad) s.offRoadTime += dt
    const events = k.drift.events
    for (const ev of events) {
      if (ev.type === 'boost') {
        s.boosts += 1
        s.maxCombo = Math.max(s.maxCombo, ev.combo)
        if (ev.optimized) {
          s.perfect += 1
          if (r.isPlayer) this.perfectFlash = true
        }
      } else if (ev.type === 'nitro') {
        s.nitros += 1
      } else {
        s.fails += 1
      }
    }
    events.length = 0
  }

  /** 与第 1 名的进度差（米），正数表示落后 */
  gapToLeader(r: Racer): number {
    const leader = this.ranking[0]
    if (!leader || leader === r) return 0
    return (leader.progress - r.progress) * this.track.length
  }

  /** 撞护栏：贴回墙面 + 速度投影到赛道方向，掉速但不会被弹飞或卡住 */
  private hitWall(r: Racer, t: number, wall: number, sign: number): void {
    const k = r.kart
    if (!this.frozen && this.time - r.lastWallTime > 0.6) {
      r.stats.wallHits += 1
      r.lastWallTime = this.time
    }
    const s = this.track.sampleAt(t)
    k.x = s.pos.x + s.right.x * sign * wall
    k.z = s.pos.z + s.right.z * sign * wall
    const along = Math.cos(k.velAngle) * s.tangent.x + Math.sin(k.velAngle) * s.tangent.z
    k.speed = Math.max(0, k.speed * (0.5 + 0.35 * Math.abs(along)))
    // 沿墙擦行：车头拉向赛道方向，并让速度方向与车头一致（不允许撞墙后原地打转）
    k.heading += wrapPi(s.angle - k.heading) * 0.6
    k.velAngle = k.heading
    k.slip = 0
    // 撞墙打断漂移集气
    k.drift.abort()
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

    // 分段计时：顺序通过下一个检查点才算，和最佳圈同分段对比
    if (!this.frozen && cp === (r.lastCp + 1) % CP_COUNT) {
      const done = r.lastCp
      const split = this.time - r.lapStart
      r.sectors[done] = split
      if (r.bestSectors.length === CP_COUNT && r.bestSectors[done] > 0 && r.isPlayer) {
        this.sectorFlash = { sector: done, delta: split - r.bestSectors[done] }
      }
      r.lastCp = cp
    }

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
          if (lapTime < r.bestLap) {
            r.bestLap = lapTime
            // 刷新最佳圈：把这一圈的分段存为对比基准
            r.sectors[CP_COUNT - 1] = lapTime
            r.bestSectors = [...r.sectors]
          }
          if (r.isPlayer) this.lapFlash = { lap: r.lap, time: lapTime }
        }
        r.sectors = new Array(CP_COUNT).fill(0)
        r.lastCp = 0
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
