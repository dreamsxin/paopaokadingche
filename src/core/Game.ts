import { GameStateMachine } from './GameStateMachine'
import { Loop } from './Loop'
import { InputManager } from '../input/InputManager'
import { RaceDirector, type RacerInit } from '../race/RaceDirector'
import { createVillageTrack, VILLAGE_TRACK } from '../track/tracks/village'
import { buildTrack } from '../track/TrackBuilder'
import { SceneView } from '../render/SceneView'
import { KartView } from '../render/KartView'
import { Hud } from '../ui/Hud'
import { MainMenu, type MenuChoice } from '../ui/MainMenu'
import { RoomPanel } from '../ui/RoomPanel'
import { ResultPanel, type ResultRow } from '../ui/ResultPanel'
import { RoomController } from '../lobby/RoomController'
import { lobbyStats, tickLocalLobby } from '../net/NetAdapter'
import { NEUTRAL_INPUT, type MatchConfig } from '../types'

const COLORS = [0x2f6bff, 0xff5a3d, 0x37d67a, 0xffc93c, 0xb06bff, 0x00c9c9]
const AI_NAMES = ['皮蛋', '黑妞', '大头', '小橘子', '阿龙']
const COUNTDOWN = 3.4
const RESULT_DELAY = 1.4

export class Game {
  private readonly sm = new GameStateMachine()
  private readonly track = createVillageTrack()
  private readonly view: SceneView
  private readonly input: InputManager
  private readonly hud: Hud
  private readonly menu: MainMenu
  private readonly roomPanel: RoomPanel
  private readonly result: ResultPanel
  private readonly loop: Loop

  private director: RaceDirector | null = null
  private room: RoomController | null = null
  private views = new Map<string, KartView>()
  private config: MatchConfig = { mode: 'single', roomSize: 6, laps: VILLAGE_TRACK.laps }
  private countdown = 0
  private resultTimer = 0
  private lobbyRenderAcc = 0
  private menuRefreshAcc = 0
  private cameraSnap = true

  constructor(viewport: HTMLElement, uiRoot: HTMLElement) {
    this.view = new SceneView(viewport)
    this.view.scene.add(buildTrack(this.track))

    this.input = new InputManager(uiRoot)
    this.hud = new Hud(uiRoot, this.track)
    this.menu = new MainMenu(uiRoot)
    this.roomPanel = new RoomPanel(uiRoot)
    this.result = new ResultPanel(uiRoot)

    this.loop = new Loop(
      (dt) => this.fixedUpdate(dt),
      (_alpha, dt) => this.render(dt),
    )

    this.sm.go('menu')
    this.showMenu()
    this.loop.start()
  }

  // ---------------- 状态流转 ----------------

  private showMenu(): void {
    this.room?.close()
    this.room = null
    this.hud.hide()
    this.result.hide()
    this.roomPanel.hide()
    this.input.touch.show(false)
    this.menu.show((choice) => this.onMenuPick(choice), (size) => lobbyStats(size))
  }

  private onMenuPick(choice: MenuChoice): void {
    this.config = { mode: choice.mode, roomSize: choice.roomSize, laps: VILLAGE_TRACK.laps }
    this.menu.hide()
    if (choice.mode === 'single') {
      this.buildRace(this.singleRacers())
      this.enterCountdown()
    } else {
      this.enterLobby()
    }
  }

  private enterLobby(): void {
    this.sm.go('lobby')
    this.room = new RoomController()
    this.roomPanel.show({
      onFill: () => this.room?.fillNow(),
      onCancel: () => {
        this.sm.go('menu')
        this.showMenu()
      },
    })
    this.room.open(
      this.config.roomSize,
      { id: 'self', name: '我', kind: 'self', skill: 1 },
      (snapshot) => this.roomPanel.render(snapshot, this.room?.readyCountdown ?? 0),
    )
  }

  private enterCountdown(): void {
    this.sm.go('countdown')
    this.roomPanel.hide()
    this.result.hide()
    this.countdown = COUNTDOWN
    this.resultTimer = 0
    this.cameraSnap = true
    this.hud.show()
    this.input.touch.show(InputManager.isTouchDevice)
  }

  private enterRacing(): void {
    this.sm.go('racing')
    this.hud.setCountdown(null)
    this.hud.flash('GO!', 0.8)
    this.director?.startRace()
  }

  private enterResult(): void {
    this.sm.go('result')
    this.hud.hide()
    this.input.touch.show(false)
    const rows: ResultRow[] = (this.director?.ranking ?? []).map((r) => ({
      rank: r.rank,
      name: r.name,
      isPlayer: r.isPlayer,
      finished: r.finished,
      totalTime: r.finishTime,
      bestLap: r.bestLap,
    }))
    this.result.show(rows, {
      onRestart: () => {
        this.result.hide()
        this.director?.placeOnGrid()
        this.enterCountdown()
      },
      onMenu: () => {
        this.sm.go('menu')
        this.showMenu()
      },
    })
  }

  // ---------------- 车手构建 ----------------

  private singleRacers(): RacerInit[] {
    const list: RacerInit[] = [
      { id: 'self', name: '我', isPlayer: true, color: COLORS[0] },
    ]
    AI_NAMES.forEach((name, i) => {
      list.push({
        id: `ai-${i}`,
        name,
        isPlayer: false,
        color: COLORS[(i + 1) % COLORS.length],
        skill: 0.35 + i * 0.12,
      })
    })
    return list
  }

  private buildRace(inits: RacerInit[]): void {
    for (const v of this.views.values()) v.dispose(this.view.scene)
    this.views.clear()
    this.director = new RaceDirector(this.track, inits, this.config.laps)
    this.director.racers.forEach((r, i) => {
      this.views.set(r.id, new KartView(r.color, this.view.scene, i + 1))
    })
    this.resultTimer = 0
  }

  // ---------------- 主循环 ----------------

  private fixedUpdate(dt: number): void {
    // 大厅模拟（别人的房间人数变化）与游戏状态无关，始终推进
    tickLocalLobby(dt)

    switch (this.sm.state) {
      case 'menu': {
        // 主菜单上的"可加入房间数"要跟着大厅变
        this.menuRefreshAcc += dt
        if (this.menuRefreshAcc >= 0.5) {
          this.menuRefreshAcc = 0
          this.menu.refresh()
        }
        break
      }
      case 'lobby': {
        const room = this.room
        if (!room) break
        const ready = room.tick(dt)
        this.lobbyRenderAcc += dt
        if (room.snapshot && this.lobbyRenderAcc >= 0.1) {
          this.lobbyRenderAcc = 0
          this.roomPanel.render(room.snapshot, room.readyCountdown)
        }
        if (ready && room.snapshot) {
          const inits: RacerInit[] = room.snapshot.players.map((p, i) => ({
            id: p.id,
            name: p.name,
            isPlayer: p.kind === 'self',
            color: COLORS[i % COLORS.length],
            skill: p.skill,
          }))
          this.buildRace(inits)
          // 房间已开赛，从大厅移除
          room.close()
          this.room = null
          this.enterCountdown()
        }
        break
      }
      case 'countdown': {
        this.countdown -= dt
        this.director?.update(dt, NEUTRAL_INPUT)
        const n = Math.ceil(this.countdown - 0.6)
        this.hud.setCountdown(n > 0 ? String(Math.min(3, n)) : 'GO!')
        if (this.countdown <= 0) this.enterRacing()
        break
      }
      case 'racing': {
        const director = this.director
        if (!director) break
        director.update(dt, this.input.read())
        const flash = director.lapFlash
        if (flash) {
          director.lapFlash = null
          if (flash.lap < director.totalLaps) this.hud.flash(`第 ${flash.lap} 圈完成`, 1.1)
        }
        if (director.finishedAll) {
          this.resultTimer += dt
          if (this.resultTimer >= RESULT_DELAY) this.enterResult()
        }
        break
      }
      default:
        break
    }
  }

  private render(dt: number): void {
    const director = this.director
    if (director) {
      for (const r of director.racers) {
        this.views.get(r.id)?.sync(r.kart, dt, { steer: r.lastSteer })
      }
      const me = director.player
      this.view.follow(me.kart, dt, this.cameraSnap)
      this.cameraSnap = false

      if (this.sm.state === 'racing' || this.sm.state === 'countdown') {
        this.hud.update(
          {
            lap: me.lap + 1,
            totalLaps: director.totalLaps,
            rank: me.rank,
            total: director.racers.length,
            time: director.time,
            lastLap: me.lapTimes.length ? me.lapTimes[me.lapTimes.length - 1] : 0,
            bestLap: me.bestLap,
            kmh: me.kart.kmh,
            charge: me.kart.drift.charge,
            gauge: me.kart.drift.gauge,
            combo: me.kart.drift.comboCount,
            drifting: me.kart.drift.state === 'drifting',
            boosting: me.kart.drift.boosting,
            boostKind:
              me.kart.drift.nitroTimer > 0
                ? 'nitro'
                : me.kart.drift.boostTimer > 0
                  ? 'small'
                  : 'none',
            wrongWay: this.sm.state === 'racing' && director.isWrongWay(me),
            karts: director.racers.map((r) => ({
              x: r.kart.x,
              z: r.kart.z,
              color: r.color,
              isPlayer: r.isPlayer,
            })),
          },
          dt,
        )
      }
    }
    this.view.render(dt)
  }
}
