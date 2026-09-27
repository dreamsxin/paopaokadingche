import { clamp } from '../core/math'

interface PadDef {
  key: 'brake' | 'drift' | 'nitro'
  label: string
  wide?: boolean
}

const PADS: PadDef[] = [
  { key: 'brake', label: '刹车' },
  { key: 'drift', label: '漂移' },
  { key: 'nitro', label: '氮气', wide: true },
]

/**
 * 移动端虚拟摇杆 + 按钮。移动端默认自动油门，摇杆只管方向。
 */
export class TouchControls {
  readonly root: HTMLDivElement
  steer = 0
  brake = false
  drift = false
  nitro = false
  /** 是否正在使用触控（决定 InputManager 是否接管油门） */
  engaged = false

  private stickId: number | null = null
  private knob!: HTMLElement
  private stick!: HTMLElement

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'touch hidden'
    this.buildStick()
    this.buildPads()
    parent.appendChild(this.root)
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible)
    if (!visible) this.reset()
  }

  reset(): void {
    this.steer = 0
    this.brake = false
    this.drift = false
    this.nitro = false
    this.stickId = null
    this.engaged = false
    if (this.knob) this.knob.style.transform = ''
    for (const el of Array.from(this.root.querySelectorAll('.pad'))) {
      el.classList.remove('active')
    }
  }

  private buildStick(): void {
    const stick = document.createElement('div')
    stick.className = 'stick'
    const knob = document.createElement('i')
    stick.appendChild(knob)
    this.stick = stick
    this.knob = knob

    const move = (e: PointerEvent) => {
      const rect = stick.getBoundingClientRect()
      const r = rect.width / 2
      const dx = e.clientX - (rect.left + r)
      const dy = e.clientY - (rect.top + r)
      const nx = clamp(dx / (r * 0.8), -1, 1)
      const ny = clamp(dy / (r * 0.8), -1, 1)
      this.steer = nx
      this.knob.style.transform = `translate(${nx * r * 0.55}px, ${ny * r * 0.55}px)`
    }

    stick.addEventListener('pointerdown', (e) => {
      this.stickId = e.pointerId
      this.engaged = true
      stick.setPointerCapture(e.pointerId)
      move(e)
      e.preventDefault()
    })
    stick.addEventListener('pointermove', (e) => {
      if (this.stickId === e.pointerId) move(e)
    })
    const end = (e: PointerEvent) => {
      if (this.stickId !== e.pointerId) return
      this.stickId = null
      this.steer = 0
      this.knob.style.transform = ''
    }
    stick.addEventListener('pointerup', end)
    stick.addEventListener('pointercancel', end)
    this.root.appendChild(stick)
  }

  private buildPads(): void {
    const pads = document.createElement('div')
    pads.className = 'pads'
    for (const def of PADS) {
      const btn = document.createElement('button')
      btn.className = `pad${def.wide ? ' wide' : ''}`
      btn.textContent = def.label
      const set = (on: boolean) => {
        this[def.key] = on
        btn.classList.toggle('active', on)
        if (on) this.engaged = true
      }
      btn.addEventListener('pointerdown', (e) => {
        set(true)
        btn.setPointerCapture(e.pointerId)
        e.preventDefault()
      })
      btn.addEventListener('pointerup', () => set(false))
      btn.addEventListener('pointercancel', () => set(false))
      btn.addEventListener('pointerleave', () => set(false))
      pads.appendChild(btn)
    }
    this.root.appendChild(pads)
  }
}
