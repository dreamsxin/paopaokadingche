import type { KartInput } from '../types'
import type { KartPhysics } from '../physics/KartPhysics'
import type { TrackProgress, TrackSpline } from '../track/TrackSpline'
import { clamp, wrapPi } from '../core/math'

type BotPhase = 'cruise' | 'drift' | 'counter'

/**
 * AI 车手：复用与玩家完全相同的 KartPhysics / DriftCharge，
 * 所以 AI 也要靠"入漂 -> 集气 -> 拉车头出小喷"来跑快，手感与玩家一致。
 * 后续换成远端玩家时，只要把 think() 的输出替换为网络输入即可。
 */
export class BotDriver {
  private phase: BotPhase = 'cruise'
  private dir = 0
  private timer = 0
  private cooldown = 0
  private noisePhase: number

  constructor(
    private readonly kart: KartPhysics,
    private readonly track: TrackSpline,
    /** 0 = 新手，1 = 高手 */
    private readonly skill: number,
    seed = 0,
  ) {
    this.noisePhase = seed
  }

  think(dt: number, pr: TrackProgress): KartInput {
    this.noisePhase += dt * (1.1 + this.skill)
    this.cooldown = Math.max(0, this.cooldown - dt)
    const k = this.kart
    const len = this.track.length
    const hw = this.track.halfWidth
    const speed = Math.max(5, k.speed)

    // 前瞻：速度越快看得越远
    const aimDist = 13 + speed * 0.55
    const probeDist = 24 + speed * 0.95
    const curve = wrapPi(
      this.track.angleAt(pr.t + probeDist / len) - this.track.angleAt(pr.t + 5 / len),
    )
    const sharp = Math.abs(curve)

    // 走内线，弯越急贴得越内
    const lineOffset = Math.sign(curve) * Math.min(hw * 0.55, sharp * hw * 1.1)
    const target = this.track.pointAt(pr.t + aimDist / len, lineOffset)
    const desired = Math.atan2(target.z - k.z, target.x - k.x)
    const noise = Math.sin(this.noisePhase * 2.3) * 0.07 * (1 - this.skill)
    const err = wrapPi(desired - k.heading) + noise

    let steer = clamp(err * 2.5, -1, 1)
    let drift = false

    switch (this.phase) {
      case 'cruise': {
        const enterAngle = 0.62 - 0.22 * this.skill
        if (this.cooldown <= 0 && sharp > enterAngle && k.speed > 16) {
          this.phase = 'drift'
          this.dir = Math.sign(curve) || 1
          this.timer = 0
          drift = true
          steer = this.dir
        }
        break
      }
      case 'drift': {
        this.timer += dt
        drift = true
        steer = clamp(err * 2.5 + 0.3 * this.dir, -1, 1)
        const chargeTarget = 0.42 + 0.4 * this.skill
        const cornerDone = sharp < 0.2 || Math.abs(err) < 0.05
        if (
          k.drift.charge > chargeTarget ||
          cornerDone ||
          this.timer > 1.9 ||
          k.drift.state === 'none'
        ) {
          this.phase = 'counter'
          this.timer = 0
        }
        break
      }
      case 'counter': {
        this.timer += dt
        // 断位拉车头：反方向键 + 继续按住漂移键，等 DriftCharge 结算小喷
        drift = true
        steer = -this.dir
        if (k.drift.state === 'none' || this.timer > 0.6) {
          this.phase = 'cruise'
          this.cooldown = 0.18
          drift = false
          steer = clamp(err * 2.5, -1, 1)
        }
        break
      }
    }

    // 直道上放氮气
    const nitro = k.drift.gauge >= 1 && sharp < 0.22 && this.skill > 0.2

    // 冲出路肩时往赛道里收，避免长时间在草地上跑
    if (Math.abs(pr.lateral) > hw * 0.85) {
      steer = clamp(steer - Math.sign(pr.lateral) * 0.4, -1, 1)
    }

    return { throttle: 1, steer, drift, nitro }
  }
}
