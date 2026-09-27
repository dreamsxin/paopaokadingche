import * as THREE from 'three'
import type { KartPhysics } from '../physics/KartPhysics'
import { damp, wrapPi } from '../core/math'

/** 场景、相机、渲染器与跟车逻辑 */
export class SceneView {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  private camPos = new THREE.Vector3()
  private camLook = new THREE.Vector3()
  private ready = false

  constructor(private readonly container: HTMLElement) {
    this.scene.background = new THREE.Color(0x7ec6f5)
    this.scene.fog = new THREE.Fog(0x9fd4f7, 220, 900)

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 2000)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)

    const hemi = new THREE.HemisphereLight(0xdff1ff, 0x3b6b3f, 0.95)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xfff3d0, 1.0)
    sun.position.set(-180, 320, 140)
    this.scene.add(sun)

    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  /** 跟车：视角方向在"车头"与"速度方向"之间取折中，漂移时能看见车身横过来 */
  follow(kart: KartPhysics, dt: number, snap = false): void {
    const blend = kart.velAngle + wrapPi(kart.heading - kart.velAngle) * 0.45
    const back = 10.5 + Math.min(6, kart.speed * 0.12)
    const height = 4.4
    const targetX = kart.x - Math.cos(blend) * back
    const targetZ = kart.z - Math.sin(blend) * back
    const lookX = kart.x + Math.cos(kart.heading) * 9
    const lookZ = kart.z + Math.sin(kart.heading) * 9

    if (!this.ready || snap) {
      this.camPos.set(targetX, height, targetZ)
      this.camLook.set(lookX, 1.4, lookZ)
      this.ready = true
    } else {
      this.camPos.x = damp(this.camPos.x, targetX, 6, dt)
      this.camPos.y = damp(this.camPos.y, height, 5, dt)
      this.camPos.z = damp(this.camPos.z, targetZ, 6, dt)
      this.camLook.x = damp(this.camLook.x, lookX, 9, dt)
      this.camLook.y = damp(this.camLook.y, 1.4, 6, dt)
      this.camLook.z = damp(this.camLook.z, lookZ, 9, dt)
    }
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.camLook)

    // 喷射时拉 FOV，制造速度感
    const targetFov = 62 + (kart.drift.boosting ? 9 : 0) + Math.min(6, kart.speed * 0.08)
    this.camera.fov = damp(this.camera.fov, targetFov, 6, dt)
    this.camera.updateProjectionMatrix()
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }
}
