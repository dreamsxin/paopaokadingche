import type { RaceStatsData } from '../race/RaceStats'
import { getModel } from '../karts/catalog'

export interface LapRecord {
  time: number
  modelId: string
  modelName: string
  date: string
}

export interface TotalRecord {
  time: number
  rank: number
  total: number
  grade: string
  modelId: string
  modelName: string
  date: string
}

export interface CareerStats {
  races: number
  finishes: number
  wins: number
  podiums: number
  rankSum: number
  boosts: number
  maxCombo: number
  nitros: number
  perfect: number
  wallHits: number
  driftTime: number
  topSpeed: number
  bestLap: number
  bestTotal: number
}

export interface RecordsData {
  laps: LapRecord[]
  totals: TotalRecord[]
  career: CareerStats
}

export interface RaceResultInput {
  rank: number
  total: number
  finished: boolean
  totalTime: number
  bestLap: number
  modelId: string
  grade: string
  stats: RaceStatsData
}

export interface SubmitOutcome {
  /** 是否刷新了单圈榜第一 */
  newBestLap: boolean
  /** 是否刷新了总时间榜第一 */
  newBestTotal: boolean
  /** 本次成绩在单圈榜的名次（1 起，未上榜为 null） */
  lapRank: number | null
  /** 本次成绩在总时间榜的名次 */
  totalRank: number | null
}

const KEY = 'ppkdc.records'
const MAX_ENTRIES = 10

function emptyCareer(): CareerStats {
  return {
    races: 0,
    finishes: 0,
    wins: 0,
    podiums: 0,
    rankSum: 0,
    boosts: 0,
    maxCombo: 0,
    nitros: 0,
    perfect: 0,
    wallHits: 0,
    driftTime: 0,
    topSpeed: 0,
    bestLap: Infinity,
    bestTotal: Infinity,
  }
}

function emptyData(): RecordsData {
  return { laps: [], totals: [], career: emptyCareer() }
}

/** Infinity 无法进 JSON，存档里用 0 表示"还没有成绩" */
function reviveTime(v: number): number {
  return v > 0 ? v : Infinity
}

function serializeTime(v: number): number {
  return isFinite(v) ? v : 0
}

export function loadRecords(): RecordsData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyData()
    const parsed = JSON.parse(raw) as RecordsData
    const data = emptyData()
    if (Array.isArray(parsed.laps)) data.laps = parsed.laps.slice(0, MAX_ENTRIES)
    if (Array.isArray(parsed.totals)) data.totals = parsed.totals.slice(0, MAX_ENTRIES)
    if (parsed.career) {
      data.career = { ...data.career, ...parsed.career }
      data.career.bestLap = reviveTime(parsed.career.bestLap)
      data.career.bestTotal = reviveTime(parsed.career.bestTotal)
    }
    return data
  } catch {
    return emptyData()
  }
}

function save(data: RecordsData): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...data,
        career: {
          ...data.career,
          bestLap: serializeTime(data.career.bestLap),
          bestTotal: serializeTime(data.career.bestTotal),
        },
      }),
    )
  } catch {
    // 存储不可用时静默降级，排行榜仅在本次会话有效
  }
}

function today(): string {
  return new Date().toLocaleDateString('zh-CN')
}

/** 把一场比赛的成绩写入排行榜与生涯统计 */
export function submitResult(input: RaceResultInput): SubmitOutcome {
  const data = loadRecords()
  const model = getModel(input.modelId)
  const c = data.career

  c.races += 1
  c.rankSum += input.rank
  if (input.finished) c.finishes += 1
  if (input.rank === 1) c.wins += 1
  if (input.rank <= 3) c.podiums += 1
  c.boosts += input.stats.boosts
  c.nitros += input.stats.nitros
  c.perfect += input.stats.perfect
  c.wallHits += input.stats.wallHits
  c.driftTime += input.stats.driftTime
  c.maxCombo = Math.max(c.maxCombo, input.stats.maxCombo)
  c.topSpeed = Math.max(c.topSpeed, input.stats.topSpeed)

  const outcome: SubmitOutcome = {
    newBestLap: false,
    newBestTotal: false,
    lapRank: null,
    totalRank: null,
  }

  if (isFinite(input.bestLap) && input.bestLap > 0) {
    const prevBest = data.laps[0]?.time ?? Infinity
    const entry: LapRecord = {
      time: input.bestLap,
      modelId: model.id,
      modelName: model.name,
      date: today(),
    }
    data.laps.push(entry)
    data.laps.sort((a, b) => a.time - b.time)
    data.laps = data.laps.slice(0, MAX_ENTRIES)
    const idx = data.laps.indexOf(entry)
    outcome.lapRank = idx >= 0 ? idx + 1 : null
    outcome.newBestLap = input.bestLap < prevBest
    if (input.bestLap < c.bestLap) c.bestLap = input.bestLap
  }

  if (input.finished && input.totalTime > 0) {
    const prevBest = data.totals[0]?.time ?? Infinity
    const entry: TotalRecord = {
      time: input.totalTime,
      rank: input.rank,
      total: input.total,
      grade: input.grade,
      modelId: model.id,
      modelName: model.name,
      date: today(),
    }
    data.totals.push(entry)
    data.totals.sort((a, b) => a.time - b.time)
    data.totals = data.totals.slice(0, MAX_ENTRIES)
    const idx = data.totals.indexOf(entry)
    outcome.totalRank = idx >= 0 ? idx + 1 : null
    outcome.newBestTotal = input.totalTime < prevBest
    if (input.totalTime < c.bestTotal) c.bestTotal = input.totalTime
  }

  save(data)
  return outcome
}

export function resetRecords(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 忽略
  }
}
