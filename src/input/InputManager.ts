import type { KartInput } from '../types'
import { clamp } from '../core/math'
import { TouchControls } from './TouchControls'

const ACCEL_KEYS = ['ArrowUp', 'KeyW']
const BRAKE_KEYS = ['ArrowDown', 'KeyS']
const LEFT_KEYS = ['ArrowLeft', 'KeyA']
const RIGHT_KEYS = ['ArrowRight', 'KeyD']
const DRIFT_KEYS = ['ShiftLeft', 'ShiftRight']
const NITRO_KEYS = ['ControlLeft', 'ControlRight', 'Space']
const SWALLOW = new Set([
  ...ACCEL_KEYS,
  ...BRAKE_KEYS,
  ...LEFT_KEYS,
  ...RIGHT_KEYS,
  ...DRIFT_KEYS,
  ...NITRO_KEYS,
])

/** 键盘 + 触控统一成一份 KartInput */
export class InputManager {
  readonly touch: TouchControls
  private keys = new Set<string>()
  private out: KartInput = { throttle: 0, steer: 0, drift: false, nitro: false }

  constructor(uiRoot: HTMLElement) {
    this.touch = new TouchControls(uiRoot)
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return
      this.keys.add(e.code)
      if (SWALLOW.has(e.code)) e.preventDefault()
    })
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code)
      if (SWALLOW.has(e.code)) e.preventDefault()
    })
    window.addEventListener('blur', () => this.keys.clear())
  }

  static get isTouchDevice(): boolean {
    return (
      'ontouchstart' in window ||
      (navigator.maxTouchPoints ?? 0) > 0 ||
      matchMedia('(pointer: coarse)').matches
    )
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c))
  }

  read(): KartInput {
    const kbAccel = this.any(ACCEL_KEYS)
    const kbBrake = this.any(BRAKE_KEYS)
    let throttle = (kbAccel ? 1 : 0) + (kbBrake ? -1 : 0)
    let steer = (this.any(RIGHT_KEYS) ? 1 : 0) + (this.any(LEFT_KEYS) ? -1 : 0)
    let drift = this.any(DRIFT_KEYS)
    let nitro = this.any(NITRO_KEYS)

    const t = this.touch
    if (t.engaged) {
      // 触控：自动油门，刹车键优先
      if (!kbAccel && !kbBrake) throttle = t.brake ? -1 : 1
      if (Math.abs(t.steer) > 0.08) steer = t.steer
      drift = drift || t.drift
      nitro = nitro || t.nitro
    }

    this.out.throttle = clamp(throttle, -1, 1)
    this.out.steer = clamp(steer, -1, 1)
    this.out.drift = drift
    this.out.nitro = nitro
    return this.out
  }
}
