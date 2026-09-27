import { TrackSpline } from '../TrackSpline'

/**
 * 「彩虹村庄」：起点长直道 -> 高速右弯组 -> 发夹弯 -> S 弯 -> 收尾中速弯回到起点。
 * 弯型刻意做出"长弯（拖漂）+ 连续小弯（连喷）"两类，方便验证漂移集气手感。
 */
const CENTERLINE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [160, 0],
  [270, 14],
  [340, 80],
  [345, 175],
  [292, 250],
  [200, 276],
  [110, 258],
  [58, 198],
  [-10, 196],
  [-78, 244],
  [-168, 262],
  [-248, 228],
  [-286, 148],
  [-262, 62],
  [-186, 12],
  [-92, -12],
]

export const VILLAGE_TRACK = {
  id: 'village',
  name: '彩虹村庄',
  halfWidth: 9,
  laps: 3,
  centerline: CENTERLINE,
}

export function createVillageTrack(): TrackSpline {
  return new TrackSpline(CENTERLINE, VILLAGE_TRACK.halfWidth)
}
