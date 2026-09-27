/** 单场比赛里累积的技术统计，结算面板与生涯总榜都读它 */
export interface RaceStatsData {
  /** 小喷次数 */
  boosts: number
  /** 本场最高连喷层数 */
  maxCombo: number
  /** 氮气使用次数 */
  nitros: number
  /** 最佳化漂移（轻点出喷）次数 */
  perfect: number
  /** 拉车头失败次数（只掉速没出喷） */
  fails: number
  /** 撞护栏次数 */
  wallHits: number
  /** 累计漂移时长 */
  driftTime: number
  /** 赛道外时长 */
  offRoadTime: number
  /** 峰值速度 km/h */
  topSpeed: number
}

export function createStats(): RaceStatsData {
  return {
    boosts: 0,
    maxCombo: 0,
    nitros: 0,
    perfect: 0,
    fails: 0,
    wallHits: 0,
    driftTime: 0,
    offRoadTime: 0,
    topSpeed: 0,
  }
}

export type Grade = 'S' | 'A' | 'B' | 'C'

/**
 * 评级：名次占一半，剩下看漂移技术（连喷层数、最佳化漂移、失败与撞墙扣分）。
 * 目的是让"跑得漂亮"也能拿高分，而不是只看第一名。
 */
export function gradeRace(
  rank: number,
  total: number,
  stats: RaceStatsData,
  finished: boolean,
): { grade: Grade; score: number } {
  const placement = total > 1 ? (total - rank) / (total - 1) : 1
  let score = placement * 50
  score += Math.min(stats.maxCombo, 10) * 3
  score += Math.min(stats.perfect, 10) * 1.5
  score += Math.min(stats.boosts, 40) * 0.35
  score -= stats.wallHits * 1.5
  score -= stats.fails * 0.5
  if (finished) score += 8
  score = Math.max(0, Math.min(100, score))
  const grade: Grade = score >= 75 ? 'S' : score >= 60 ? 'A' : score >= 45 ? 'B' : 'C'
  return { grade, score: Math.round(score) }
}
