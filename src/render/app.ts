import * as THREE from "three";
import { ForcePowerController } from "../player/forcePowerController";
import { ThirdPersonController } from "../player/thirdPersonController";
import type { HudController } from "../ui/hud";
import { buildingColliders, cityBounds } from "../world/cityLayout";
import { createCity } from "../world/createCity";
import type { CarTrafficSystem } from "../world/carTrafficSystem";
import { createCarTrafficSystem } from "../world/carTrafficSystem";
import type { NpcSystem } from "../world/npcSystem";
import { createNpcSystem } from "../world/npcSystem";

export class CitySandboxApp {
  private readonly root: HTMLElement;
  private readonly hud: HudController;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(68, 1, 0.1, 700);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  private readonly clock = new THREE.Clock();
  private readonly playerPosition = new THREE.Vector3();
  private controller?: ThirdPersonController;
  private forcePowerController?: ForcePowerController;
  private npcSystem?: NpcSystem;
  private carTrafficSystem?: CarTrafficSystem;
  private isDisposed = false;
  private animationId = 0;

  constructor(root: HTMLElement, hud: HudController) {
    this.root = root;
    this.hud = hud;
  }

  async start(): Promise<void> {
    this.configureRenderer();
    this.configureScene();
    this.root.appendChild(this.renderer.domElement);
    this.resize();

    window.addEventListener("resize", this.resize);
    window.addEventListener("beforeunload", this.dispose);

    await createCity(this.scene, this.renderer);
    void createCarTrafficSystem(this.scene)
      .then((carTrafficSystem) => {
        if (this.isDisposed) {
          carTrafficSystem.dispose();
          return;
        }

        this.carTrafficSystem = carTrafficSystem;
      })
      .catch((error: unknown) => {
        console.error("Could not load traffic cars", error);
      });

    void createNpcSystem(this.scene)
      .then((npcSystem) => {
        if (this.isDisposed) {
          npcSystem.dispose();
          return;
        }

        this.npcSystem = npcSystem;
      })
      .catch((error: unknown) => {
        console.error("Could not load wandering NPCs", error);
      });

    this.controller = new ThirdPersonController({
      camera: this.camera,
      scene: this.scene,
      domElement: this.renderer.domElement,
      lockElement: this.hud.lockButton,
      bounds: cityBounds,
      colliders: buildingColliders,
      getTrafficColliders: () => this.carTrafficSystem?.getColliders() ?? [],
      getNpcColliders: () => this.npcSystem?.getColliders() ?? [],
      onLockChange: (isLocked) => this.hud.setLocked(isLocked),
    });
    this.forcePowerController = new ForcePowerController({
      camera: this.camera,
      domElement: this.renderer.domElement,
      getTargets: () => [...(this.npcSystem?.getForceTargets() ?? []), ...(this.carTrafficSystem?.getForceTargets() ?? [])],
      setHudProgress: (progress, isLocked) => this.hud.setForceProgress(progress, isLocked),
      setForceActive: (isActive) => this.controller?.setForcePose(isActive),
    });

    this.hud.setMessage("WASD moves. Hold Space to fly. Hold on a target to lift it, release to throw.");
    this.animate();
  }

  private configureRenderer(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color(0x9fb4c8);
    this.scene.fog = new THREE.Fog(0x9fb4c8, 95, 290);

    const hemisphere = new THREE.HemisphereLight(0xcad9e8, 0x46505b, 2.5);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xfff3d1, 4.4);
    sun.position.set(80, 120, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -130;
    sun.shadow.camera.right = 130;
    sun.shadow.camera.top = 130;
    sun.shadow.camera.bottom = -130;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 260;
    this.scene.add(sun);
  }

  private readonly animate = (): void => {
    const deltaSeconds = Math.min(this.clock.getDelta(), 0.05);
    this.controller?.update(deltaSeconds);
    if (this.controller) {
      this.controller.getPosition(this.playerPosition);
    }
    this.forcePowerController?.update(deltaSeconds);
    this.carTrafficSystem?.update(deltaSeconds);
    this.npcSystem?.update(deltaSeconds, this.controller ? this.playerPosition : undefined);
    this.hud.setPosition(this.controller?.getPositionLabel() ?? "loading");
    this.renderer.render(this.scene, this.camera);
    this.animationId = window.requestAnimationFrame(this.animate);
  };

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private readonly dispose = (): void => {
    this.isDisposed = true;
    window.cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("beforeunload", this.dispose);
    this.forcePowerController?.dispose();
    this.controller?.dispose();
    this.npcSystem?.dispose();
    this.carTrafficSystem?.dispose();
    this.renderer.dispose();
  };
}
