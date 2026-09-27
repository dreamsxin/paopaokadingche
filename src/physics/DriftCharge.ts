import type { DriverStats, KartInput, KartStats } from '../types'
import { clamp } from '../core/math'

export type DriftState = 'none' | 'drifting'

export interface DriftEvent {
  type: 'boost' | 'nitro' | 'fail'
  strength: number
  /** 连喷层数 */
  combo: number
  /** 是否由最佳化漂移（轻点）结算出来的 */
  optimized: boolean
}

export interface DriftContext {
  speed: number
  /** 当前侧滑角（弧度，带符号） */
  slip: number
  maxSpeed: number
}

/** 入漂门槛：太慢时按 Shift 不进入漂移 */
const MIN_DRIFT_SPEED = 11
/** 侧滑收敛到该角度以内，反方向键才算"拉车头成功" */
const RELEASE_SLIP = 0.42
/** 轻点漂移键的时长上限（最佳化漂移） */
const TAP_TIME = 0.22
/** 满槽 = 1 格，最多存 2 格 */
const MAX_GAUGE = 2

/**
 * 漂移集气状态机：漂移 -> 集气（拖漂） -> 拉车头出小喷 -> 连喷。
 * 只管"气"与"喷"，不碰运动学；KartPhysics 读取这里的输出。
 */
export class DriftCharge {
  state: DriftState = 'none'
  /** 漂移方向：-1 左漂，1 右漂 */
  driftDir = 0
  /** 当前漂移累积的气 0..1 */
  charge = 0
  driftTime = 0
  /** 连喷层数 */
  comboCount = 0
  comboWindow = 0
  /** 氮气槽（格） */
  gauge = 0
  /** 小喷剩余时间 */
  boostTimer = 0
  /** 小喷强度 0..1 */
  boostStrength = 0
  /** 氮气剩余时间 */
  nitroTimer = 0
  /** 起步加速剩余时间 */
  launchTimer = 0
  /** 本次漂移是否为轻点（最佳化漂移，损耗更低） */
  optimized = false
  /** 待消费的事件（HUD / 特效 / 音效） */
  events: DriftEvent[] = []

  private prevDrift = false
  private prevNitro = false
  private holdTime = 0

  constructor(
    private readonly stats: KartStats,
    private readonly driver: DriverStats,
  ) {}

  get boosting(): boolean {
    return this.boostTimer > 0 || this.nitroTimer > 0 || this.launchTimer > 0
  }

  /** 侧滑损耗倍率：轻点/短漂损耗低，长时间拖漂损耗高 */
  get lossMul(): number {
    if (this.state !== 'drifting') return 1
    return this.driftTime < TAP_TIME ? 0.6 : 1
  }

  reset(): void {
    this.state = 'none'
    this.driftDir = 0
    this.charge = 0
    this.driftTime = 0
    this.comboCount = 0
    this.comboWindow = 0
    this.gauge = 0
    this.boostTimer = 0
    this.boostStrength = 0
    this.nitroTimer = 0
    this.launchTimer = 0
    this.optimized = false
    this.events.length = 0
    this.prevDrift = false
    this.prevNitro = false
    this.holdTime = 0
  }

  launch(): void {
    this.launchTimer = 0.45 + this.driver.startBoost
  }

  /** 外部打断漂移（撞墙等）：气全丢，并记一次失败 */
  abort(): void {
    if (this.state !== 'drifting') return
    this.state = 'none'
    this.charge = 0
    this.driftTime = 0
    this.comboCount = 0
    this.comboWindow = 0
    this.events.push({ type: 'fail', strength: 0, combo: 0, optimized: false })
  }

  update(dt: number, input: KartInput, ctx: DriftContext): void {
    // 事件队列只保留最近若干条，未被消费也不会堆积
    if (this.events.length > 8) this.events.splice(0, this.events.length - 8)
    this.boostTimer = Math.max(0, this.boostTimer - dt)
    this.nitroTimer = Math.max(0, this.nitroTimer - dt)
    this.launchTimer = Math.max(0, this.launchTimer - dt)
    this.comboWindow = Math.max(0, this.comboWindow - dt)
    if (this.comboWindow === 0) this.comboCount = 0

    const held = input.drift
    if (held) this.holdTime += dt
    const slipAbs = Math.abs(ctx.slip)

    if (this.state === 'none') {
      if (held && !this.prevDrift) this.holdTime = 0
      if (held && Math.abs(input.steer) > 0.25 && ctx.speed > MIN_DRIFT_SPEED) {
        this.state = 'drifting'
        this.driftDir = Math.sign(input.steer)
        this.charge = 0
        this.driftTime = 0
        this.optimized = false
      }
    } else {
      this.driftTime += dt
      // 拖漂：侧滑越大 + 速度越高 + 连喷层数越多，集气越快
      const slipQ = clamp(slipAbs / 0.8, 0, 1)
      const speedQ = 0.45 + 0.55 * clamp(ctx.speed / ctx.maxSpeed, 0, 1)
      const comboMul = 1 + Math.min(this.comboCount, 6) * 0.08
      this.charge = Math.min(
        1,
        this.charge + (0.2 + 0.95 * slipQ) * speedQ * comboMul * this.stats.chargeRate * dt,
      )

      // 断位拉车头：反方向键（+漂移键）把车头校正回来即出小喷。
      // 气太少时忽略反打，避免入漂瞬间的微小反向输入白白打断漂移。
      const counter = input.steer * this.driftDir < -0.25
      if (counter && slipAbs < RELEASE_SLIP && this.charge > 0.12) {
        this.release(true)
      } else if (!held) {
        // 松键：车头已经回正才有喷，否则只剩速度损耗
        this.release(slipAbs < RELEASE_SLIP && this.charge > 0.1)
      } else if (ctx.speed < 5) {
        this.state = 'none'
        this.charge = 0
      }
    }

    if (!held) this.holdTime = 0

    // 氮气：满 1 格可手动释放
    if (input.nitro && !this.prevNitro && this.gauge >= 1 && this.nitroTimer <= 0) {
      this.gauge -= 1
      this.nitroTimer = (1.9 + this.driver.nitroTimeBonus) * this.stats.nitroPower
      this.events.push({ type: 'nitro', strength: 1, combo: this.comboCount, optimized: false })
    }

    this.prevDrift = held
    this.prevNitro = input.nitro
  }

  private release(success: boolean): void {
    const c = this.charge
    const short = this.driftTime < TAP_TIME
    this.state = 'none'
    this.charge = 0
    this.driftTime = 0
    this.optimized = short

    if (success && c > 0.08) {
      // 漂得越久喷得越猛；轻点的最佳化漂移有小幅奖励
      this.boostStrength = Math.min(1, c * (short ? 1.2 : 1))
      this.boostTimer = 0.34 + 0.5 * this.boostStrength
      this.gauge = Math.min(MAX_GAUGE, this.gauge + c * 0.5)
      this.comboCount += 1
      // 连喷窗口：小喷结束后 0.25s 内重新入漂即保留层数
      this.comboWindow = this.boostTimer + 0.25
      this.events.push({
        type: 'boost',
        strength: this.boostStrength,
        combo: this.comboCount,
        optimized: short,
      })
    } else {
      this.comboCount = 0
      this.comboWindow = 0
      this.events.push({ type: 'fail', strength: 0, combo: 0, optimized: false })
    }
  }
}
