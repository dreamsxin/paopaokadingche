import type { TrackSpline } from '../track/TrackSpline'
import { clamp, formatTime } from '../core/math'
import { el } from './dom'

export interface HudModel {
  lap: number
  totalLaps: number
  rank: number
  total: number
  time: number
  lastLap: number
  bestLap: number
  kmh: number
  /** 当前漂移集气 0..1 */
  charge: number
  /** 氮气槽 0..2 */
  gauge: number
  combo: number
  drifting: boolean
  boosting: boolean
  boostKind: 'none' | 'small' | 'nitro'
  wrongWay: boolean
  karts: Array<{ x: number; z: number; color: number; isPlayer: boolean }>
}

const MAP_SIZE = 132

export class Hud {
  readonly root: HTMLDivElement
  private lapText: HTMLElement
  private rankText: HTMLElement
  private timeText: HTMLElement
  private lapTimeText: HTMLElement
  private speedText: HTMLElement
  private chargeBar: HTMLElement
  private chargeWrap: HTMLElement
  private nitroCells: HTMLElement[] = []
  private comboBadge: HTMLElement
  private boostFx: HTMLElement
  private center: HTMLElement
  private countdown: HTMLElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private mapPath: Array<[number, number]> = []
  private mapScale = 1
  private mapOffset: [number, number] = [0, 0]
  private flashTimer = 0
  private lastCountdown: string | null = null

  constructor(parent: HTMLElement, track: TrackSpline) {
    this.root = el('div', 'hud hidden')

    const lapBox = el('div', 'hud-box hud-lap')
    this.rankText = el('div', 'hud-rank-big', '1 / 6')
    this.lapText = el('div', '', 'LAP 1/3')
    lapBox.append(this.rankText, this.lapText)

    const timeBox = el('div', 'hud-box hud-time')
    this.timeText = el('div', '', formatTime(0))
    this.lapTimeText = el('div', '', '单圈 --  最佳 --')
    timeBox.append(this.timeText, this.lapTimeText)

    const gauge = el('div', 'hud-gauge')
    this.speedText = el('div', 'hud-speed')
    this.speedText.innerHTML = '0<small>km/h</small>'
    this.chargeWrap = el('div', 'bar charge')
    this.chargeBar = el('i')
    this.chargeWrap.appendChild(this.chargeBar)
    const nitroRow = el('div', 'nitro-row')
    for (let i = 0; i < 2; i++) {
      const cell = el('div', 'nitro-cell')
      cell.appendChild(el('i'))
      this.nitroCells.push(cell)
      nitroRow.appendChild(cell)
    }
    this.comboBadge = el('div', 'combo-badge', '')
    gauge.append(this.comboBadge, this.speedText, this.chargeWrap, nitroRow)

    this.boostFx = el('div', 'boost-fx')
    this.center = el('div', 'hud-center')
    this.countdown = el('div', 'countdown hidden')

    this.canvas = el('canvas', 'hud-minimap')
    this.canvas.width = MAP_SIZE * 2
    this.canvas.height = MAP_SIZE * 2
    this.canvas.style.width = `${MAP_SIZE}px`
    this.canvas.style.height = `${MAP_SIZE}px`
    this.ctx = this.canvas.getContext('2d')!

    this.root.append(lapBox, timeBox, gauge, this.canvas, this.boostFx, this.center, this.countdown)
    parent.appendChild(this.root)
    this.prepareMap(track)
  }

  private prepareMap(track: TrackSpline): void {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const s of track.samples) {
      minX = Math.min(minX, s.pos.x)
      maxX = Math.max(maxX, s.pos.x)
      minZ = Math.min(minZ, s.pos.z)
      maxZ = Math.max(maxZ, s.pos.z)
    }
    const pad = 16
    const size = MAP_SIZE * 2 - pad * 2
    this.mapScale = Math.min(size / (maxX - minX), size / (maxZ - minZ))
    this.mapOffset = [
      pad + (size - (maxX - minX) * this.mapScale) / 2 - minX * this.mapScale,
      pad + (size - (maxZ - minZ) * this.mapScale) / 2 - minZ * this.mapScale,
    ]
    this.mapPath = track.samples
      .filter((_, i) => i % 6 === 0)
      .map((s) => this.toMap(s.pos.x, s.pos.z))
  }

  private toMap(x: number, z: number): [number, number] {
    return [x * this.mapScale + this.mapOffset[0], z * this.mapScale + this.mapOffset[1]]
  }

  show(): void {
    this.root.classList.remove('hidden')
  }

  hide(): void {
    this.root.classList.add('hidden')
    this.boostFx.classList.remove('small', 'nitro')
    this.setCountdown(null)
  }

  setCountdown(text: string | null): void {
    if (text === this.lastCountdown) return
    this.lastCountdown = text
    this.countdown.textContent = text ?? ''
    this.countdown.classList.toggle('hidden', text === null)
    // 重新触发缩放动画
    this.countdown.classList.remove('pop')
    if (text !== null) {
      void this.countdown.offsetWidth
      this.countdown.classList.add('pop')
    }
  }

  flash(text: string, seconds = 1.2): void {
    this.center.textContent = text
    this.center.classList.add('show')
    this.flashTimer = seconds
  }

  update(m: HudModel, dt: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      if (this.flashTimer <= 0) this.center.classList.remove('show')
    }

    this.rankText.textContent = `${m.rank} / ${m.total}`
    this.lapText.textContent = `LAP ${clamp(m.lap, 1, m.totalLaps)}/${m.totalLaps}`
    this.timeText.textContent = formatTime(m.time)
    this.lapTimeText.textContent = `单圈 ${m.lastLap > 0 ? formatTime(m.lastLap) : '--'} · 最佳 ${
      isFinite(m.bestLap) ? formatTime(m.bestLap) : '--'
    }`
    this.speedText.innerHTML = `${Math.round(m.kmh)}<small>km/h</small>`
    const charge = clamp(m.charge, 0, 1)
    this.chargeBar.style.width = `${charge * 100}%`
    this.chargeWrap.classList.toggle('max', charge > 0.92)

    // 氮气槽按格显示（满 1 格即可释放）
    for (let i = 0; i < this.nitroCells.length; i++) {
      const fill = clamp(m.gauge - i, 0, 1)
      const bar = this.nitroCells[i].firstElementChild as HTMLElement
      bar.style.width = `${fill * 100}%`
      this.nitroCells[i].classList.toggle('ready', fill >= 1)
    }

    const comboOn = m.combo >= 2
    this.comboBadge.textContent = comboOn ? `连喷 x${m.combo}` : ''
    this.comboBadge.classList.toggle('show', comboOn)

    this.boostFx.classList.toggle('small', m.boostKind === 'small')
    this.boostFx.classList.toggle('nitro', m.boostKind === 'nitro')

    if (m.wrongWay) this.flash('逆行！', 0.2)

    this.drawMap(m)
  }

  private drawMap(m: HudModel): void {
    const c = this.ctx
    const full = MAP_SIZE * 2
    c.clearRect(0, 0, full, full)
    c.lineJoin = 'round'
    c.lineCap = 'round'

    const path = () => {
      c.beginPath()
      this.mapPath.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
      c.closePath()
    }
    // 路面 + 边线
    c.lineWidth = 10
    c.strokeStyle = 'rgba(12,18,34,0.55)'
    path()
    c.stroke()
    c.lineWidth = 7
    c.strokeStyle = 'rgba(214,226,255,0.55)'
    path()
    c.stroke()

    // 起跑线
    if (this.mapPath.length) {
      const [sx, sy] = this.mapPath[0]
      c.fillStyle = '#ffd971'
      c.fillRect(sx - 5, sy - 5, 10, 10)
    }

    for (const k of m.karts) {
      const [x, y] = this.toMap(k.x, k.z)
      c.beginPath()
      c.arc(x, y, k.isPlayer ? 7 : 5, 0, Math.PI * 2)
      c.fillStyle = k.isPlayer ? '#ffd971' : `#${k.color.toString(16).padStart(6, '0')}`
      c.fill()
      c.lineWidth = 2
      c.strokeStyle = 'rgba(10,14,28,0.7)'
      c.stroke()
    }
  }
}
