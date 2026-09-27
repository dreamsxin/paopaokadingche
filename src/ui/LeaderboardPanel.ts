import { formatTime } from '../core/math'
import { loadRecords, resetRecords } from '../data/Records'
import { button, el } from './dom'

type Tab = 'lap' | 'total' | 'career'

/** 排行榜：单圈榜 / 总时间榜 / 生涯总榜（本地存档） */
export class LeaderboardPanel {
  readonly root: HTMLDivElement
  private tabs = new Map<Tab, HTMLButtonElement>()
  private body: HTMLDivElement
  private tab: Tab = 'lap'
  private onClose: () => void = () => {}

  constructor(parent: HTMLElement) {
    this.root = el('div', 'panel hidden')
    this.root.appendChild(el('h1', 'title', '排行榜'))

    const tabRow = el('div', 'row tabs')
    const defs: Array<[Tab, string]> = [
      ['lap', '最佳单圈'],
      ['total', '总时间'],
      ['career', '生涯统计'],
    ]
    for (const [key, label] of defs) {
      const btn = button(label, 'btn secondary tab', () => {
        this.tab = key
        this.render()
      })
      this.tabs.set(key, btn)
      tabRow.appendChild(btn)
    }
    this.root.appendChild(tabRow)

    this.body = el('div', 'board')
    this.root.appendChild(this.body)

    const row = el('div', 'row')
    row.appendChild(button('返回', 'btn', () => this.onClose()))
    row.appendChild(
      button('清空记录', 'btn secondary', () => {
        resetRecords()
        this.render()
      }),
    )
    this.root.appendChild(row)
    parent.appendChild(this.root)
  }

  show(onClose: () => void, tab: Tab = 'lap'): void {
    this.onClose = onClose
    this.tab = tab
    this.render()
    this.root.classList.remove('hidden')
  }

  hide(): void {
    this.root.classList.add('hidden')
  }

  private render(): void {
    for (const [key, btn] of this.tabs) btn.classList.toggle('active', key === this.tab)
    const data = loadRecords()
    this.body.innerHTML = ''

    if (this.tab === 'lap') {
      if (!data.laps.length) {
        this.body.appendChild(el('div', 'hint', '还没有单圈记录，先跑一局吧'))
        return
      }
      data.laps.forEach((rec, i) => {
        const row = el('div', `board-row rank-${i + 1}`)
        row.appendChild(el('span', 'pos', String(i + 1)))
        row.appendChild(el('span', 'name', rec.modelName))
        row.appendChild(el('span', 'time', formatTime(rec.time)))
        row.appendChild(el('span', 'tag', rec.date))
        this.body.appendChild(row)
      })
      return
    }

    if (this.tab === 'total') {
      if (!data.totals.length) {
        this.body.appendChild(el('div', 'hint', '还没有完赛记录，跑完 3 圈就会上榜'))
        return
      }
      data.totals.forEach((rec, i) => {
        const row = el('div', `board-row rank-${i + 1}`)
        row.appendChild(el('span', 'pos', String(i + 1)))
        row.appendChild(el('span', 'name', `${rec.modelName} · 第${rec.rank}/${rec.total}名`))
        row.appendChild(el('span', 'time', formatTime(rec.time)))
        row.appendChild(el('span', 'tag', `${rec.grade} · ${rec.date}`))
        this.body.appendChild(row)
      })
      return
    }

    const c = data.career
    const avgRank = c.races ? (c.rankSum / c.races).toFixed(2) : '--'
    const items: Array<[string, string]> = [
      ['总场次', `${c.races}`],
      ['完赛数', `${c.finishes}`],
      ['冠军', `${c.wins}`],
      ['前三', `${c.podiums}`],
      ['平均名次', avgRank],
      ['最佳单圈', isFinite(c.bestLap) ? formatTime(c.bestLap) : '--'],
      ['最佳总时间', isFinite(c.bestTotal) ? formatTime(c.bestTotal) : '--'],
      ['最高连喷', `x${c.maxCombo}`],
      ['累计小喷', `${c.boosts}`],
      ['累计氮气', `${c.nitros}`],
      ['完美漂移', `${c.perfect}`],
      ['峰值速度', `${Math.round(c.topSpeed)} km/h`],
      ['累计漂移', `${Math.round(c.driftTime)}s`],
      ['撞墙总数', `${c.wallHits}`],
    ]
    const grid = el('div', 'stats-grid')
    for (const [label, value] of items) {
      const cell = el('div', 'stat-cell')
      cell.appendChild(el('div', 'stat-cell-value', value))
      cell.appendChild(el('div', 'stat-cell-label', label))
      grid.appendChild(cell)
    }
    this.body.appendChild(grid)
  }
}
