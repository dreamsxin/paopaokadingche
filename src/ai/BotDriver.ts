import type { KartInput } from '../types'
import type { KartPhysics } from '../physics/KartPhysics'
import type { TrackProgress, TrackSpline } from '../track/TrackSpline'
import { clamp, wrapPi } from '../core/math'
import { getRacingLine, type RacingLine } from './RacingLine'

type BotPhase = 'cruise' | 'drift' | 'counter'

/** 与 RacingLine 的默认减速能力保持一致，用于估算刹车距离 */
const DECEL = 20

/**
 * AI 车手：沿预计算的赛车线行驶，按速度剖面提前刹车，并复用与玩家完全相同的
 * KartPhysics / DriftCharge —— AI 也必须靠"入漂 -> 集气 -> 拉车头出小喷"来跑快。
 * 后续换成远端玩家时，只要把 think() 的输出替换为网络输入即可。
 */
export class BotDriver {
  private readonly line: RacingLine
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
    this.line = getRacingLine(track)
    this.noisePhase = seed
  }

  think(dt: number, pr: TrackProgress): KartInput {
    this.noisePhase += dt * (1.1 + this.skill)
    this.cooldown = Math.max(0, this.cooldown - dt)
    const k = this.kart
    const len = this.track.length
    const hw = this.track.halfWidth
    const speed = Math.max(4, k.speed)

    // ---- 前方弯况 ----
    const previewDist = 14 + speed * 0.9
    const peak = this.line.peakCurvatureAhead(pr.t, previewDist)
    const here = this.line.curvatureAt(pr.t)
    // 入漂门槛：高手 R<100m 就漂，新手只在 R<71m 的急弯漂
    const kEnter = 0.01 + 0.004 * (1 - this.skill)
    const cornerDir = Math.sign(peak || here || 1)
    // 正在被甩向弯道外侧（护栏那一侧）
    const wideness = -pr.lateral * cornerDir // 越大表示越靠外
    const bailOut = wideness > hw * 0.34

    // ---- 瞄点：巡航走赛车线，漂移时收内线，让侧滑正好落在弯心 ----
    const aimDist = 7 + speed * 0.42
    const tAim = pr.t + aimDist / len
    const aimOffset =
      this.phase === 'cruise' ? this.line.offsetAt(tAim) : this.dir * hw * 0.78
    const target = this.track.pointAt(tAim, aimOffset)
    const noise = Math.sin(this.noisePhase * 2.3) * 0.05 * (1 - this.skill)
    const desired = Math.atan2(target.z - k.z, target.x - k.x)
    const err = wrapPi(desired - k.heading) + noise
    let steer = clamp(err * 2.8, -1, 1)

    // ---- 速度：按刹车距离查未来最低限速 ----
    const brakeDist = 10 + (speed * speed) / (2 * DECEL)
    const trust = 0.9 + 0.1 * this.skill // 低手把限速看得更死
    const vLimit = this.line.minLimitAhead(pr.t, brakeDist) * trust
    let throttle = 1
    if (speed > vLimit * 1.15) throttle = -1
    else if (speed > vLimit) throttle = 0

    let drift = false

    switch (this.phase) {
      case 'cruise': {
        if (
          this.cooldown <= 0 &&
          Math.abs(peak) > kEnter &&
          speed > 17 &&
          !bailOut &&
          Math.abs(pr.lateral) < hw * 0.75
        ) {
          this.phase = 'drift'
          this.dir = cornerDir || 1
          this.timer = 0
          drift = true
          steer = this.dir
        }
        break
      }
      case 'drift': {
        this.timer += dt
        if (bailOut) {
          // 已经被甩到外侧：立刻松漂移键恢复抓地救车，别硬撑到撞墙
          this.phase = 'cruise'
          this.cooldown = 0.5
          break
        }
        drift = true
        // 朝内线修正 + 弯内固定偏置；转向幅度设上限，避免侧滑角打到极限直接甩出去
        steer = clamp(err * 2.2 + 0.25 * this.dir, -0.8, 0.8)
        const chargeTarget = 0.38 + 0.42 * this.skill
        const minHold = 0.22 + 0.26 * this.skill
        const cornerEnding = Math.abs(here) < kEnter * 0.5
        const overSlip = Math.abs(k.slip) > 0.95
        // 气太少就别急着拉车头，否则只掉速不出喷（除非弯已经走完）
        const enough = k.drift.charge > 0.16
        const ready =
          this.timer > minHold && enough && (k.drift.charge > chargeTarget || cornerEnding)
        if (overSlip || ready || this.timer > 1.7 || k.drift.state === 'none') {
          this.phase = 'counter'
          this.timer = 0
        }
        break
      }
      case 'counter': {
        this.timer += dt
        // 断位拉车头：适度反打（打满会把车甩到反向侧滑），等 DriftCharge 结算小喷
        drift = true
        steer = -0.6 * this.dir
        const straightened = Math.abs(k.slip) < 0.22
        if (k.drift.state === 'none' || straightened || this.timer > 0.5) {
          this.phase = 'cruise'
          this.cooldown = Math.abs(k.slip) > 0.6 ? 0.45 : 0.15
          drift = false
          steer = clamp(err * 2.8, -1, 1)
        }
        break
      }
    }

    // 漂移/拉车头期间保持油门，掉速靠小喷补回来
    if (this.phase !== 'cruise') throttle = 1

    // 冲出路肩时往赛道里收
    if (Math.abs(pr.lateral) > hw * 0.9) {
      steer = clamp(steer - Math.sign(pr.lateral) * 0.45, -1, 1)
    }

    // 直道上放氮气（前方没有急弯才放）
    const nitro = k.drift.gauge >= 1 && Math.abs(peak) < kEnter * 0.6 && this.skill > 0.2

    return { throttle, steer, drift, nitro }
  }
}
