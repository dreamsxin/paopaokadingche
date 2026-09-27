/** 卡丁车输入。所有值均为归一化后的"意图"，与键盘/触控/AI/网络来源无关。 */
export interface KartInput {
  /** 1 = 加速，-1 = 刹车/倒退 */
  throttle: number
  /** -1 = 左，1 = 右 */
  steer: number
  /** 漂移键（Shift） */
  drift: boolean
  /** 氮气键（Ctrl） */
  nitro: boolean
}

export const NEUTRAL_INPUT: KartInput = { throttle: 0, steer: 0, drift: false, nitro: false }

/** 车辆性能。后续"粒子激活器改装"直接改这里的字段即可。 */
export interface KartStats {
  /** 极速 m/s */
  maxSpeed: number
  /** 加速度 m/s^2 */
  accel: number
  /** 刹车减速度 */
  brake: number
  /** 松油门自然减速 */
  drag: number
  /** 基础转向角速度 rad/s */
  steerRate: number
  /** 漂移时转向倍率（灵活性） */
  driftSteerMul: number
  /** 抓地力：速度方向向车头收敛的速率 */
  grip: number
  /** 漂移时的抓地力（越低越飘） */
  driftGrip: number
  /** 侧滑速度损耗系数 */
  slipDrag: number
  /** 集气效率倍率（漂移攒气快慢） */
  chargeRate: number
  /** 氮气威力 */
  nitroPower: number
  /** 防御（本期仅占位，道具赛使用） */
  defense: number
}

/** 车手/宠物加成。本期仅 startBoost 与 nitroTimeBonus 生效。 */
export interface DriverStats {
  expBonus: number
  coinBonus: number
  /** 氮气时长加成（秒） */
  nitroTimeBonus: number
  /** 起步加速时长（秒） */
  startBoost: number
}

export const DEFAULT_KART_STATS: KartStats = {
  maxSpeed: 50,
  accel: 16.5,
  brake: 32,
  drag: 3.4,
  steerRate: 2.5,
  driftSteerMul: 1.9,
  grip: 11,
  driftGrip: 2.0,
  slipDrag: 0.62,
  chargeRate: 1,
  nitroPower: 1,
  defense: 0,
}

export const DEFAULT_DRIVER_STATS: DriverStats = {
  expBonus: 0,
  coinBonus: 0,
  nitroTimeBonus: 0,
  startBoost: 0,
}

export type GameMode = 'single' | 'multi'

export interface MatchConfig {
  mode: GameMode
  /** 房间人数：2（等 1 人）/ 4（等 3 人）/ 6 */
  roomSize: number
  laps: number
}
