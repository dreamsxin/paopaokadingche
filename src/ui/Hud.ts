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
  private nitroBar: HTMLElement
  private center: HTMLElement
  private countdown: HTMLElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private mapPath: Array<[number, number]> = []
  private mapScale = 1
  private mapOffset: [number, number] = [0, 0]
  private flashTimer = 0

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
    const chargeWrap = el('div', 'bar charge')
    this.chargeBar = el('i')
    chargeWrap.appendChild(this.chargeBar)
    const nitroWrap = el('div', 'bar nitro')
    this.nitroBar = el('i')
    nitroWrap.appendChild(this.nitroBar)
    gauge.append(this.speedText, chargeWrap, nitroWrap)

    this.center = el('div', 'hud-center')
    this.countdown = el('div', 'countdown hidden')

    this.canvas = el('canvas', 'hud-minimap')
    this.canvas.width = MAP_SIZE * 2
    this.canvas.height = MAP_SIZE * 2
    this.canvas.style.width = `${MAP_SIZE}px`
    this.canvas.style.height = `${MAP_SIZE}px`
    this.ctx = this.canvas.getContext('2d')!

    this.root.append(lapBox, timeBox, gauge, this.canvas, this.center, this.countdown)
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
    this.setCountdown(null)
  }

  setCountdown(text: string | null): void {
    this.countdown.textContent = text ?? ''
    this.countdown.classList.toggle('hidden', text === null)
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
    this.chargeBar.style.width = `${clamp(m.charge, 0, 1) * 100}%`
    this.nitroBar.style.width = `${clamp(m.gauge / 2, 0, 1) * 100}%`

    if (m.wrongWay) {
      this.flash('逆行！', 0.2)
    } else if (m.combo >= 2 && m.boosting) {
      this.flash(`连喷 x${m.combo}`, 0.5)
    }

    this.drawMap(m)
  }

  private drawMap(m: HudModel): void {
    const c = this.ctx
    const full = MAP_SIZE * 2
    c.clearRect(0, 0, full, full)
    c.lineWidth = 7
    c.strokeStyle = 'rgba(255,255,255,0.35)'
    c.beginPath()
    this.mapPath.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
    c.closePath()
    c.stroke()

    for (const k of m.karts) {
      const [x, y] = this.toMap(k.x, k.z)
      c.beginPath()
      c.arc(x, y, k.isPlayer ? 7 : 5, 0, Math.PI * 2)
      c.fillStyle = k.isPlayer ? '#ffd971' : `#${k.color.toString(16).padStart(6, '0')}`
      c.fill()
    }
  }
}
