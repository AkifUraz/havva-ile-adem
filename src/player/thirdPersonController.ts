import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CityBounds, ColliderRect } from "../world/cityLayout";

interface ThirdPersonControllerOptions {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  domElement: HTMLElement;
  lockElement: HTMLElement;
  bounds: CityBounds;
  colliders: ColliderRect[];
  onLockChange?: (isLocked: boolean) => void;
}

const moveKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);
const characterId = "h";
const characterUrl = `/assets/npcs/character-${characterId}.glb`;

export class ThirdPersonController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly scene: THREE.Scene;
  private readonly domElement: HTMLElement;
  private readonly lockElement: HTMLElement;
  private readonly bounds: CityBounds;
  private readonly colliders: ColliderRect[];
  private readonly onLockChange?: (isLocked: boolean) => void;
  private readonly pressed = new Set<string>();
  private readonly character = new THREE.Group();
  private readonly placeholder = createPlaceholderCharacter();
  private readonly targetCameraPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly movement = new THREE.Vector3();
  private readonly nextPosition = new THREE.Vector3();
  private mixer?: THREE.AnimationMixer;
  private idleAction?: THREE.AnimationAction;
  private walkAction?: THREE.AnimationAction;
  private currentAction?: THREE.AnimationAction;
  private placeholderWalkTime = 0;
  private yaw = 0;
  private pitch = -0.18;
  private isLocked = false;
  private readonly playerRadius = 1.05;
  private readonly speed = 18;
  private readonly cameraDistance = 17;
  private readonly cameraHeight = 8.6;

  constructor(options: ThirdPersonControllerOptions) {
    this.camera = options.camera;
    this.scene = options.scene;
    this.domElement = options.domElement;
    this.lockElement = options.lockElement;
    this.bounds = options.bounds;
    this.colliders = options.colliders;
    this.onLockChange = options.onLockChange;

    this.character.name = "third-person-character";
    this.character.add(this.placeholder);
    this.character.position.set(0, 0.18, 88);
    this.character.rotation.y = this.yaw;
    this.scene.add(this.character);
    this.updateCamera(1);
    void this.loadCharacterModel();

    this.lockElement.addEventListener("click", this.requestLock);
    this.domElement.addEventListener("click", this.requestLock);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("keyup", this.handleKeyUp);
  }

  update(deltaSeconds: number): void {
    const forward = Number(this.pressed.has("KeyW") || this.pressed.has("ArrowUp")) - Number(this.pressed.has("KeyS") || this.pressed.has("ArrowDown"));
    const strafe = Number(this.pressed.has("KeyD") || this.pressed.has("ArrowRight")) - Number(this.pressed.has("KeyA") || this.pressed.has("ArrowLeft"));
    const isMoving = forward !== 0 || strafe !== 0;

    this.movement.set(0, 0, 0);

    if (isMoving) {
      this.movement.set(strafe, 0, -forward).normalize();
      this.movement.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      this.character.rotation.y = Math.atan2(this.movement.x, this.movement.z) + Math.PI;
      this.movement.multiplyScalar(this.speed * deltaSeconds);
    }

    this.moveAxis(this.movement.x, 0);
    this.moveAxis(0, this.movement.z);
    this.updateCharacterAnimation(deltaSeconds, isMoving);
    this.updateCamera(deltaSeconds);
  }

  dispose(): void {
    this.lockElement.removeEventListener("click", this.requestLock);
    this.domElement.removeEventListener("click", this.requestLock);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
    this.scene.remove(this.character);
  }

  getPositionLabel(): string {
    const { x, z } = this.character.position;
    return `${x.toFixed(1)}, ${z.toFixed(1)}`;
  }

  private readonly requestLock = (): void => {
    if (document.pointerLockElement !== this.domElement) {
      void this.domElement.requestPointerLock();
    }
  };

  private readonly handlePointerLockChange = (): void => {
    this.isLocked = document.pointerLockElement === this.domElement;
    this.onLockChange?.(this.isLocked);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.isLocked) {
      return;
    }

    this.yaw -= event.movementX * 0.002;
    this.pitch -= event.movementY * 0.0016;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.62, 0.34);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (moveKeys.has(event.code)) {
      this.pressed.add(event.code);
      event.preventDefault();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (moveKeys.has(event.code)) {
      this.pressed.delete(event.code);
      event.preventDefault();
    }
  };

  private moveAxis(deltaX: number, deltaZ: number): void {
    this.nextPosition.copy(this.character.position);
    this.nextPosition.x = THREE.MathUtils.clamp(this.nextPosition.x + deltaX, this.bounds.minX, this.bounds.maxX);
    this.nextPosition.z = THREE.MathUtils.clamp(this.nextPosition.z + deltaZ, this.bounds.minZ, this.bounds.maxZ);

    if (!this.intersectsBuilding(this.nextPosition.x, this.nextPosition.z)) {
      this.character.position.copy(this.nextPosition);
    }
  }

  private intersectsBuilding(x: number, z: number): boolean {
    return this.colliders.some(
      (collider) =>
        x > collider.minX - this.playerRadius &&
        x < collider.maxX + this.playerRadius &&
        z > collider.minZ - this.playerRadius &&
        z < collider.maxZ + this.playerRadius,
    );
  }

  private updateCamera(deltaSeconds: number): void {
    const horizontalDistance = this.cameraDistance * Math.cos(this.pitch);
    const verticalOffset = this.cameraHeight + this.cameraDistance * Math.sin(this.pitch);
    const behind = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(horizontalDistance);

    this.targetCameraPosition.copy(this.character.position).add(behind);
    this.targetCameraPosition.y += verticalOffset;

    const smoothing = 1 - Math.exp(-deltaSeconds * 9);
    this.camera.position.lerp(this.targetCameraPosition, smoothing);

    this.lookTarget.copy(this.character.position);
    this.lookTarget.y += 4.6;
    this.camera.lookAt(this.lookTarget);
  }

  private async loadCharacterModel(): Promise<void> {
    const loadingManager = new THREE.LoadingManager();
    loadingManager.setURLModifier((url) => {
      if (url.endsWith(`Textures/texture-${characterId}.png`)) {
        return `/assets/npcs/Textures/texture-${characterId}.png`;
      }

      return url;
    });
    const loader = new GLTFLoader(loadingManager);

    try {
      const gltf = await loader.loadAsync(characterUrl);
      const model = normalizeCharacterModel(gltf.scene);

      this.character.remove(this.placeholder);
      this.character.add(model);
      this.setupAnimation(model, gltf.animations);
    } catch (error) {
      console.error(`Could not load character-${characterId}.glb`, error);
    }
  }

  private setupAnimation(model: THREE.Group, clips: THREE.AnimationClip[]): void {
    this.mixer = new THREE.AnimationMixer(model);
    const idleClip = THREE.AnimationClip.findByName(clips, "idle");
    const walkClip = THREE.AnimationClip.findByName(clips, "walk");

    if (idleClip) {
      this.idleAction = this.mixer.clipAction(idleClip);
      this.idleAction.enabled = true;
      this.idleAction.play();
      this.currentAction = this.idleAction;
    }

    if (walkClip) {
      this.walkAction = this.mixer.clipAction(walkClip);
      this.walkAction.enabled = true;
      this.walkAction.timeScale = 1.15;
    }
  }

  private updateCharacterAnimation(deltaSeconds: number, isMoving: boolean): void {
    if (this.mixer) {
      const nextAction = isMoving ? this.walkAction : this.idleAction;

      if (nextAction && nextAction !== this.currentAction) {
        nextAction.reset().fadeIn(0.16).play();
        this.currentAction?.fadeOut(0.16);
        this.currentAction = nextAction;
      }

      this.mixer.update(deltaSeconds);
      return;
    }

    this.placeholderWalkTime += deltaSeconds * (isMoving ? 9 : 4);
    const sway = Math.sin(this.placeholderWalkTime);
    this.placeholder.position.y = isMoving ? Math.abs(sway) * 0.18 : Math.sin(this.placeholderWalkTime) * 0.04;
    this.placeholder.rotation.z = isMoving ? sway * 0.08 : 0;
  }
}

function createPlaceholderCharacter(): THREE.Group {
  const character = new THREE.Group();
  character.name = "third-person-placeholder";

  const coat = new THREE.MeshStandardMaterial({ color: 0x384f6b, roughness: 0.72 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0xd7c08a, roughness: 0.78 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc58f65, roughness: 0.68 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f252b, roughness: 0.84 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.78, 1.45, 6, 10), coat);
  body.position.y = 2.15;
  body.castShadow = true;
  character.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.52, 14, 10), skin);
  head.position.y = 3.45;
  head.castShadow = true;
  character.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.54, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), dark);
  hair.position.y = 3.62;
  hair.rotation.x = Math.PI;
  hair.castShadow = true;
  character.add(hair);

  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.28, 0.42), cloth);
  shoulder.position.set(0, 2.9, 0.02);
  shoulder.castShadow = true;
  character.add(shoulder);

  const armGeometry = new THREE.CapsuleGeometry(0.16, 1.05, 5, 8);
  const leftArm = new THREE.Mesh(armGeometry, cloth);
  leftArm.position.set(-1.08, 2.1, 0);
  leftArm.rotation.z = 0.22;
  leftArm.castShadow = true;
  character.add(leftArm);

  const rightArm = leftArm.clone();
  rightArm.position.x = 1.08;
  rightArm.rotation.z = -0.22;
  character.add(rightArm);

  const legGeometry = new THREE.CapsuleGeometry(0.19, 1.05, 5, 8);
  const leftLeg = new THREE.Mesh(legGeometry, dark);
  leftLeg.position.set(-0.32, 0.8, 0);
  leftLeg.castShadow = true;
  character.add(leftLeg);

  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.32;
  character.add(rightLeg);

  return character;
}

function normalizeCharacterModel(source: THREE.Group): THREE.Group {
  const model = source.clone(true);
  const wrapper = new THREE.Group();
  wrapper.name = `character-${characterId}-model`;

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const safeHeight = Math.max(size.y, 0.001);
  const scale = 4.3 / safeHeight;

  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  model.rotation.y = Math.PI;

  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  wrapper.add(model);
  return wrapper;
}
