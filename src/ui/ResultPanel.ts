import { formatTime } from '../core/math'
import type { RaceStatsData } from '../race/RaceStats'
import type { SubmitOutcome } from '../data/Records'
import { button, el } from './dom'

export interface ResultRow {
  rank: number
  name: string
  isPlayer: boolean
  finished: boolean
  totalTime: number
  bestLap: number
  modelName: string
  /** 与第 1 名的时间差（秒），第 1 名为 0 */
  gap: number
}

export interface ResultSummary {
  grade: string
  score: number
  stats: RaceStatsData
  lapTimes: number[]
  outcome: SubmitOutcome
}

export interface ResultHandlers {
  onRestart: () => void
  onBoard: () => void
  onMenu: () => void
}

export class ResultPanel {
  readonly root: HTMLDivElement
  private title: HTMLElement
  private badges: HTMLDivElement
  private list: HTMLDivElement
  private statsBox: HTMLDivElement
  private lapsBox: HTMLDivElement

  constructor(parent: HTMLElement) {
    this.root = el('div', 'panel hidden')
    const head = el('div', 'result-head')
    this.title = el('h1', 'title', '结算')
    head.appendChild(this.title)
    this.root.appendChild(head)

    this.badges = el('div', 'badges')
    this.root.appendChild(this.badges)

    this.list = el('div', 'result-list')
    this.root.appendChild(this.list)

    this.lapsBox = el('div', 'hint', '')
    this.root.appendChild(this.lapsBox)

    this.statsBox = el('div', 'stats-grid')
    this.root.appendChild(this.statsBox)

    const row = el('div', 'row')
    row.appendChild(button('再来一局', 'btn', () => this.handlers.onRestart()))
    row.appendChild(button('排行榜', 'btn secondary', () => this.handlers.onBoard()))
    row.appendChild(button('返回主菜单', 'btn secondary', () => this.handlers.onMenu()))
    this.root.appendChild(row)
    parent.appendChild(this.root)
  }

  private handlers: ResultHandlers = {
    onRestart: () => {},
    onBoard: () => {},
    onMenu: () => {},
  }

  show(rows: ResultRow[], summary: ResultSummary, handlers: ResultHandlers): void {
    this.handlers = handlers
    const me = rows.find((r) => r.isPlayer)

    this.title.textContent = me ? `第 ${me.rank} 名` : '结算'
    this.title.className = 'title'

    // 评级与新纪录
    this.badges.innerHTML = ''
    this.badges.appendChild(
      el('span', `badge grade-${summary.grade}`, `评级 ${summary.grade} · ${summary.score} 分`),
    )
    if (summary.outcome.newBestLap) {
      this.badges.appendChild(el('span', 'badge record', '单圈新纪录！'))
    } else if (summary.outcome.lapRank) {
      this.badges.appendChild(el('span', 'badge', `单圈榜第 ${summary.outcome.lapRank}`))
    }
    if (summary.outcome.newBestTotal) {
      this.badges.appendChild(el('span', 'badge record', '总时间新纪录！'))
    } else if (summary.outcome.totalRank) {
      this.badges.appendChild(el('span', 'badge', `总时间榜第 ${summary.outcome.totalRank}`))
    }

    // 名次表
    this.list.innerHTML = ''
    for (const r of rows) {
      const row = el('div', `result-row rank-${r.rank}${r.isPlayer ? ' me' : ''}`)
      row.appendChild(el('span', 'pos', String(r.rank)))
      const name = el('span', 'name')
      name.appendChild(el('span', '', r.name))
      name.appendChild(el('span', 'tag', ` ${r.modelName}`))
      row.appendChild(name)
      row.appendChild(el('span', 'time', r.finished ? formatTime(r.totalTime) : '未完成'))
      row.appendChild(
        el('span', 'time gap', r.rank === 1 ? '—' : r.finished ? `+${r.gap.toFixed(2)}s` : '—'),
      )
      row.appendChild(el('span', 'time', isFinite(r.bestLap) ? formatTime(r.bestLap) : '--'))
      this.list.appendChild(row)
    }

    // 单圈明细
    this.lapsBox.textContent = summary.lapTimes.length
      ? summary.lapTimes.map((t, i) => `第${i + 1}圈 ${formatTime(t)}`).join('   ')
      : ''

    // 本局技术统计
    const s = summary.stats
    const items: Array<[string, string]> = [
      ['最高连喷', `x${s.maxCombo}`],
      ['小喷次数', `${s.boosts}`],
      ['完美漂移', `${s.perfect}`],
      ['氮气', `${s.nitros}`],
      ['漂移时长', `${s.driftTime.toFixed(1)}s`],
      ['峰值速度', `${Math.round(s.topSpeed)} km/h`],
      ['撞墙', `${s.wallHits}`],
      ['脱轨时长', `${s.offRoadTime.toFixed(1)}s`],
    ]
    this.statsBox.innerHTML = ''
    for (const [label, value] of items) {
      const cell = el('div', 'stat-cell')
      cell.appendChild(el('div', 'stat-cell-value', value))
      cell.appendChild(el('div', 'stat-cell-label', label))
      this.statsBox.appendChild(cell)
    }

    this.root.classList.remove('hidden')
  }

  hide(): void {
    this.root.classList.add('hidden')
  }
}
