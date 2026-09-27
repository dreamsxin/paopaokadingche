import * as THREE from 'three'
import type { KartPhysics } from '../physics/KartPhysics'
import { clamp, damp, makeRandom, wrapPi } from '../core/math'
import { cloudTexture } from './Materials'

/** 场景、相机、渲染器、跟车与自适应分辨率 */
export class SceneView {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  private camPos = new THREE.Vector3()
  private camLook = new THREE.Vector3()
  private ready = false
  private shake = 0

  // 自适应分辨率
  private basePixelRatio: number
  private scale = 1
  private avgFrame = 1 / 60
  private tuneCooldown = 0

  constructor(private readonly container: HTMLElement) {
    this.scene.fog = new THREE.Fog(0xbfe6ff, 260, 1000)

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 2600)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.basePixelRatio = Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2)
    this.renderer.setPixelRatio(this.basePixelRatio)
    this.renderer.setClearColor(0xbfe6ff)
    container.appendChild(this.renderer.domElement)

    this.scene.add(new THREE.HemisphereLight(0xe8f6ff, 0x4a7f4f, 1.0))
    const sun = new THREE.DirectionalLight(0xfff4d6, 1.15)
    sun.position.set(-260, 420, 180)
    this.scene.add(sun)

    this.scene.add(this.buildSky())
    this.scene.add(this.buildClouds())

    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  /** 渐变天空穹顶 */
  private buildSky(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x2f80d8) },
        bottomColor: { value: new THREE.Color(0xdcf3ff) },
        offset: { value: 260 },
        exponent: { value: 0.75 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos + vec3(0.0, offset, 0.0)).y;
          float k = pow(max(h, 0.0), exponent);
          gl_FragColor = vec4(mix(bottomColor, topColor, k), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 24, 14), mat)
    sky.matrixAutoUpdate = false
    sky.updateMatrix()
    return sky
  }

  /** 远景云层（确定性摆放的广告牌） */
  private buildClouds(): THREE.Group {
    const group = new THREE.Group()
    const tex = cloudTexture()
    const rng = makeRandom(90210)
    for (let i = 0; i < 16; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, fog: false }),
      )
      const a = rng() * Math.PI * 2
      const r = 620 + rng() * 620
      sprite.position.set(Math.cos(a) * r, 210 + rng() * 190, Math.sin(a) * r)
      const s = 200 + rng() * 260
      sprite.scale.set(s, s * 0.55, 1)
      group.add(sprite)
    }
    group.matrixAutoUpdate = false
    group.updateMatrixWorld(true)
    return group
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  /** 帧时间偏高就降采样，恢复后再升回去 */
  private tuneResolution(dt: number): void {
    this.avgFrame = damp(this.avgFrame, dt, 1.5, dt)
    this.tuneCooldown -= dt
    if (this.tuneCooldown > 0) return
    const prev = this.scale
    if (this.avgFrame > 1 / 45) this.scale = Math.max(0.6, this.scale - 0.1)
    else if (this.avgFrame < 1 / 58) this.scale = Math.min(1, this.scale + 0.1)
    if (prev !== this.scale) {
      this.renderer.setPixelRatio(this.basePixelRatio * this.scale)
      this.resize()
      this.tuneCooldown = 1.5
    }
  }

  /** 跟车：视角在"车头"与"速度方向"之间取折中，漂移时能看见车身横过来 */
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

    // 喷射时轻微抖动，强化推背感
    const wantShake = kart.drift.nitroTimer > 0 ? 0.16 : kart.drift.boostTimer > 0 ? 0.07 : 0
    this.shake = damp(this.shake, wantShake, 10, dt)
    const t = performance.now() * 0.001
    this.camera.position.set(
      this.camPos.x + Math.sin(t * 37) * this.shake,
      this.camPos.y + Math.sin(t * 53) * this.shake,
      this.camPos.z + Math.cos(t * 43) * this.shake,
    )
    this.camera.lookAt(this.camLook)

    const targetFov = 62 + (kart.drift.boosting ? 9 : 0) + Math.min(6, kart.speed * 0.08)
    this.camera.fov = damp(this.camera.fov, targetFov, 6, dt)
    this.camera.updateProjectionMatrix()
  }

  render(dt = 1 / 60): void {
    this.tuneResolution(clamp(dt, 1 / 240, 0.2))
    this.renderer.render(this.scene, this.camera)
  }
}
