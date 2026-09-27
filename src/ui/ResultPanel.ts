import { formatTime } from '../core/math'
import { button, el } from './dom'

export interface ResultRow {
  rank: number
  name: string
  isPlayer: boolean
  finished: boolean
  totalTime: number
  bestLap: number
}

export class ResultPanel {
  readonly root: HTMLDivElement
  private title: HTMLElement
  private list: HTMLDivElement

  constructor(parent: HTMLElement) {
    this.root = el('div', 'panel hidden')
    this.title = el('h1', 'title', '结算')
    this.list = el('div', 'result-list')
    const row = el('div', 'row')
    row.appendChild(button('再来一局', 'btn', () => this.onRestart()))
    row.appendChild(button('返回主菜单', 'btn secondary', () => this.onMenu()))
    this.root.append(this.title, this.list, row)
    parent.appendChild(this.root)
  }

  private onRestart: () => void = () => {}
  private onMenu: () => void = () => {}

  show(rows: ResultRow[], handlers: { onRestart: () => void; onMenu: () => void }): void {
    this.onRestart = handlers.onRestart
    this.onMenu = handlers.onMenu
    const me = rows.find((r) => r.isPlayer)
    this.title.textContent = me ? `第 ${me.rank} 名` : '结算'
    this.list.innerHTML = ''
    for (const r of rows) {
      const row = el('div', `result-row rank-${r.rank}${r.isPlayer ? ' me' : ''}`)
      row.appendChild(el('span', 'pos', String(r.rank)))
      row.appendChild(el('span', 'name', r.name))
      row.appendChild(
        el(
          'span',
          'time',
          r.finished ? formatTime(r.totalTime) : '未完成',
        ),
      )
      row.appendChild(el('span', 'time', isFinite(r.bestLap) ? formatTime(r.bestLap) : '--'))
      this.list.appendChild(row)
    }
    this.root.classList.remove('hidden')
  }

  hide(): void {
    this.root.classList.add('hidden')
  }
}
