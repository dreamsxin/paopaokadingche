import {
  DEFAULT_DRIVER_STATS,
  DEFAULT_KART_STATS,
  type DriverStats,
  type KartInput,
  type KartStats,
} from '../types'
import { clamp, damp, wrapPi } from '../core/math'
import { DriftCharge } from './DriftCharge'

/** 侧滑角上限，超过就等于打转了 */
const MAX_SLIP = 1.15
/** 漂移中即使方向键回中，车头也会持续朝漂移方向旋转的基础量 */
const DRIFT_BIAS = 0.55

/**
 * 街机化卡丁车运动学：车头朝向(heading) 与 速度方向(velAngle) 分离，
 * 两者夹角即侧滑角(slip)。抓地时速度方向快速收敛到车头，漂移时收敛很慢 —— 这就是"飘"。
 */
export class KartPhysics {
  x = 0
  z = 0
  /** 车头朝向，0 => +X */
  heading = 0
  /** 速度方向 */
  velAngle = 0
  /** 沿速度方向的标量速度 m/s */
  speed = 0
  /** 侧滑角（带符号） */
  slip = 0
  /** 是否在草地/赛道外（由 RaceDirector 每帧写入） */
  offRoad = false
  /** 冻结（倒计时阶段） */
  frozen = false
  /**
   * 当前推力（0 = 完全松油门，1 = 满油门，>1 = 小喷/氮气的额外推力）。
   * 升压比泄压慢，形成"动力建立"的手感；渲染层用它决定矢量喷口开度与尾焰长度。
   */
  thrust = 0
  readonly drift: DriftCharge

  constructor(
    readonly stats: KartStats = { ...DEFAULT_KART_STATS },
    readonly driver: DriverStats = { ...DEFAULT_DRIVER_STATS },
  ) {
    this.drift = new DriftCharge(stats, driver)
  }

  get forwardX(): number {
    return Math.cos(this.heading)
  }

  get forwardZ(): number {
    return Math.sin(this.heading)
  }

  /** km/h，用于 HUD */
  get kmh(): number {
    return Math.max(0, this.speed) * 3.6
  }

  reset(x: number, z: number, heading: number): void {
    this.x = x
    this.z = z
    this.heading = heading
    this.velAngle = heading
    this.speed = 0
    this.slip = 0
    this.offRoad = false
    this.thrust = 0
    this.drift.reset()
  }

  update(dt: number, input: KartInput): void {
    if (this.frozen) {
      this.speed *= 1 - Math.min(1, 8 * dt)
      return
    }
    const st = this.stats
    const d = this.drift
    d.update(dt, input, { speed: this.speed, slip: this.slip, maxSpeed: st.maxSpeed })

    // ---- 纵向：油门 / 刹车 / 喷射 ----
    // 多种加速取最强的一种，不叠加，否则氮气+小喷+起步会把速度推到荒谬的量级
    const boostMul =
      1 +
      Math.max(
        d.nitroTimer > 0 ? 0.3 * st.nitroPower : 0,
        d.boostTimer > 0 ? 0.12 + 0.11 * d.boostStrength : 0,
        d.launchTimer > 0 ? 0.16 : 0,
      )
    const offRoadMul = this.offRoad ? 0.6 : 1
    const targetMax = st.maxSpeed * boostMul * offRoadMul

    // 推力：松油门为 0，满油门为 1，小喷/氮气超过 1；升压慢、泄压快
    const wantThrust =
      d.nitroTimer > 0 ? 1.6 : d.boostTimer > 0 || d.launchTimer > 0 ? 1.25 : input.throttle > 0 ? 1 : 0
    this.thrust = damp(this.thrust, wantThrust, wantThrust > this.thrust ? 6.5 : 9, dt)

    if (d.boosting) {
      this.speed += (targetMax - this.speed) * Math.min(1, 7 * dt)
    } else if (input.throttle > 0) {
      const room = clamp(1 - this.speed / targetMax, 0, 1)
      // 乘上 thrust：刚给油时动力还没建立，松油门后也不会立刻满推力
      this.speed += st.accel * (0.35 + 0.65 * room) * input.throttle * Math.min(1, this.thrust) * dt
    } else if (input.throttle < 0) {
      this.speed += st.brake * input.throttle * dt
    } else {
      this.speed -= st.drag * dt * Math.sign(this.speed || 1)
      if (Math.abs(this.speed) < 0.3) this.speed = 0
    }

    if (this.speed > targetMax) {
      this.speed -= (this.speed - targetMax) * Math.min(1, 3 * dt)
    }
    if (this.offRoad) this.speed -= 7 * dt
    this.speed = clamp(this.speed, -11, st.maxSpeed * 1.6)

    // ---- 转向 ----
    const speedFactor = 1 / (1 + Math.max(0, this.speed) * 0.022)
    let rate = st.steerRate * (0.42 + 0.58 * speedFactor)
    let steer = input.steer
    if (d.state === 'drifting') {
      rate *= st.driftSteerMul
      steer = clamp(DRIFT_BIAS * d.driftDir + input.steer, -1, 1)
    }
    if (Math.abs(this.speed) > 0.4) {
      this.heading += steer * rate * dt * (this.speed < 0 ? -1 : 1)
    }

    // ---- 速度方向收敛（抓地 / 漂移） ----
    const gripRate = d.state === 'drifting' ? st.driftGrip : st.grip
    const diff = wrapPi(this.heading - this.velAngle)
    this.velAngle += diff * Math.min(1, gripRate * dt)
    this.slip = wrapPi(this.heading - this.velAngle)
    if (Math.abs(this.slip) > MAX_SLIP) {
      const s = Math.sign(this.slip) * MAX_SLIP
      this.velAngle = this.heading - s
      this.slip = s
    }

    // ---- 侧滑损耗：漂移必然掉速，靠小喷补回来 ----
    const slipLoss = Math.abs(this.slip) * st.slipDrag * d.lossMul
    this.speed *= 1 - Math.min(0.6, slipLoss * dt)

    // ---- 位移 ----
    this.x += Math.cos(this.velAngle) * this.speed * dt
    this.z += Math.sin(this.velAngle) * this.speed * dt
  }
}
