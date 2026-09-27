import { DEFAULT_KART_STATS, type KartStats } from '../types'

/** 车型外形参数：只影响视觉，KartView 按它缩放共享几何 */
export interface KartStyle {
  /** 车体缩放 [长, 高, 宽] */
  body: [number, number, number]
  /** 车头长度倍率 */
  nose: number
  /** 尾翼宽度倍率 */
  wing: number
  /** 背鳍高度倍率 */
  fin: number
  /** 推进器数量 */
  thrusters: 1 | 2
}

export interface KartModel {
  id: string
  name: string
  series: string
  tagline: string
  /** 车库预览用的主色（赛道上仍按车手配色，保证辨识度） */
  tint: number
  style: KartStyle
  stats: KartStats
}

function stats(patch: Partial<KartStats>): KartStats {
  return { ...DEFAULT_KART_STATS, ...patch }
}

/**
 * 车型目录。四台竞速车走不同路线：均衡 / 极速 / 漂移集气 / 加速氮气。
 * 后续"粒子激活器改装"直接在 stats 上叠加即可。
 */
export const KART_MODELS: KartModel[] = [
  {
    id: 'marshmallow',
    name: '棉花糖 X',
    series: '棉花糖车系',
    tagline: '各项均衡，抓地稳，新手上手最快',
    tint: 0x7fc8ff,
    style: { body: [1, 1, 1], nose: 1, wing: 1, fin: 1, thrusters: 2 },
    stats: stats({}),
  },
  {
    id: 'burst',
    name: '爆裂 R',
    series: '爆裂车系',
    tagline: '极速最高，长直道之王，但入弯要早刹',
    tint: 0xff6a4d,
    style: { body: [1.1, 0.88, 1], nose: 1.4, wing: 0.8, fin: 0.6, thrusters: 2 },
    stats: stats({
      maxSpeed: 55,
      accel: 14.5,
      grip: 10.5,
      steerRate: 2.25,
      driftSteerMul: 1.72,
      driftGrip: 1.9,
      slipDrag: 0.75,
      chargeRate: 0.85,
      nitroPower: 1.05,
    }),
  },
  {
    id: 'alloy',
    name: '合金 EX',
    series: '合金车系',
    tagline: '漂移灵活、集气飞快，连喷手感最好',
    tint: 0xb98cff,
    style: { body: [0.92, 1.12, 1.08], nose: 0.8, wing: 1.3, fin: 1.35, thrusters: 1 },
    stats: stats({
      maxSpeed: 49.5,
      accel: 17.5,
      steerRate: 2.6,
      driftSteerMul: 2.0,
      driftGrip: 1.85,
      slipDrag: 0.56,
      chargeRate: 1.24,
    }),
  },
  {
    id: 'gale',
    name: '疾风 Z',
    series: '疾风车系',
    tagline: '起步与氮气爆发强，适合抢位混战',
    tint: 0x4fe0a8,
    style: { body: [1, 1, 0.94], nose: 1.12, wing: 1.1, fin: 0.9, thrusters: 2 },
    stats: stats({
      maxSpeed: 49.5,
      accel: 19.5,
      brake: 34,
      grip: 11.5,
      chargeRate: 1.06,
      nitroPower: 1.2,
    }),
  },
]

export const DEFAULT_MODEL_ID = KART_MODELS[0].id

export function getModel(id: string | undefined): KartModel {
  return KART_MODELS.find((m) => m.id === id) ?? KART_MODELS[0]
}

/** 车库里展示的五维（0..1），只用于 UI 条形图 */
export function modelRadar(model: KartModel): Array<{ label: string; value: number }> {
  const s = model.stats
  return [
    { label: '极速', value: (s.maxSpeed - 44) / 14 },
    { label: '加速', value: (s.accel - 13) / 8 },
    { label: '灵活', value: (s.driftSteerMul - 1.6) / 0.7 },
    { label: '集气', value: (s.chargeRate - 0.85) / 0.5 },
    { label: '氮气', value: (s.nitroPower - 0.95) / 0.35 },
  ]
}
