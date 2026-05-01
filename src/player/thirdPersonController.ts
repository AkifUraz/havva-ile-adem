import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CityBounds, ColliderRect } from "../world/cityLayout";
import type { TrafficCollider } from "../world/carTrafficSystem";
import type { NpcCollider } from "../world/npcSystem";
import { resolveAssetUrl } from "../world/assetResolver";

interface ThirdPersonControllerOptions {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  domElement: HTMLElement;
  lockElement: HTMLElement;
  bounds: CityBounds;
  colliders: ColliderRect[];
  getTrafficColliders?: () => TrafficCollider[];
  getNpcColliders?: () => NpcCollider[];
  onLockChange?: (isLocked: boolean) => void;
}

const moveKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);
const actionKeys = new Set(["Space"]);
const characterId = "h";
const characterUrl = `/assets/npcs/character-${characterId}.glb`;
const characterTextureUrl = "/assets/characters/Textures/player-robot-design.jpeg";

export class ThirdPersonController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly scene: THREE.Scene;
  private readonly domElement: HTMLElement;
  private readonly lockElement: HTMLElement;
  private readonly bounds: CityBounds;
  private readonly colliders: ColliderRect[];
  private readonly getTrafficColliders?: () => TrafficCollider[];
  private readonly getNpcColliders?: () => NpcCollider[];
  private readonly onLockChange?: (isLocked: boolean) => void;
  private readonly pressed = new Set<string>();
  private readonly character = new THREE.Group();
  private readonly placeholder = createPlaceholderCharacter();
  private readonly targetCameraPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly movement = new THREE.Vector3();
  private readonly nextPosition = new THREE.Vector3();
  private mixer?: THREE.AnimationMixer;
  private idleAction?: THREE.AnimationAction;
  private walkAction?: THREE.AnimationAction;
  private currentAction?: THREE.AnimationAction;
  private visualRoot?: THREE.Object3D;
  private leftArm?: THREE.Object3D;
  private rightArm?: THREE.Object3D;
  private placeholderWalkTime = 0;
  private forcePoseAmount = 0;
  private flightPoseAmount = 0;
  private wantsForcePose = false;
  private yaw = 0;
  private pitch = -0.22;
  private isLocked = false;
  private isDraggingLook = false;
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private movementInputSignature = "";
  private movementYawBase = 0;
  private verticalVelocity = 0;
  private readonly playerRadius = 1.08;
  private readonly speed = 18;
  private readonly cameraDistance = 7.2;
  private readonly cameraHeight = 6.7;
  private readonly groundY = 0.18;
  private readonly maxFlightY = 72;

  constructor(options: ThirdPersonControllerOptions) {
    this.camera = options.camera;
    this.scene = options.scene;
    this.domElement = options.domElement;
    this.lockElement = options.lockElement;
    this.bounds = options.bounds;
    this.colliders = options.colliders;
    this.getTrafficColliders = options.getTrafficColliders;
    this.getNpcColliders = options.getNpcColliders;
    this.onLockChange = options.onLockChange;

    this.character.name = "third-person-character";
    this.visualRoot = this.placeholder;
    this.character.add(this.placeholder);
    this.character.position.set(0, 0.18, 88);
    this.character.rotation.y = this.yaw;
    this.scene.add(this.character);
    this.updateCamera(1);
    void this.loadCharacterModel();

    this.domElement.tabIndex = 0;
    this.domElement.style.outline = "none";
    this.lockElement.addEventListener("click", this.requestLock);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("mousemove", this.handleMouseMove);
    this.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.domElement.addEventListener("pointercancel", this.handlePointerUp);
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("keyup", this.handleKeyUp);
  }

  update(deltaSeconds: number): void {
    const forward = Number(this.pressed.has("KeyW") || this.pressed.has("ArrowUp")) - Number(this.pressed.has("KeyS") || this.pressed.has("ArrowDown"));
    const strafe = Number(this.pressed.has("KeyD") || this.pressed.has("ArrowRight")) - Number(this.pressed.has("KeyA") || this.pressed.has("ArrowLeft"));
    const isMoving = forward !== 0 || strafe !== 0;
    const inputSignature = `${strafe}:${forward}`;

    this.movement.set(0, 0, 0);

    if (isMoving) {
      if (inputSignature !== this.movementInputSignature) {
        this.movementInputSignature = inputSignature;
        this.movementYawBase = this.yaw;
      }

      this.movement.set(strafe, 0, -forward).normalize();
      this.movement.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.movementYawBase);
      const isBackpedaling = forward < 0;
      const targetYaw = isBackpedaling ? this.movementYawBase : Math.atan2(-this.movement.x, -this.movement.z);
      this.yaw = lerpAngle(this.yaw, targetYaw, 1 - Math.exp(-deltaSeconds * 5.2));
      this.character.rotation.y = this.yaw;
      this.movement.multiplyScalar(this.speed * deltaSeconds);
    } else {
      this.movementInputSignature = "";
      this.movementYawBase = this.yaw;
    }

    this.moveAxis(this.movement.x, 0);
    this.moveAxis(0, this.movement.z);
    this.updateFlight(deltaSeconds);
    this.updateCharacterAnimation(deltaSeconds, isMoving);
    this.updateCamera(deltaSeconds);
  }

  dispose(): void {
    this.lockElement.removeEventListener("click", this.requestLock);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("mousemove", this.handleMouseMove);
    this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.domElement.removeEventListener("pointercancel", this.handlePointerUp);
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
    this.scene.remove(this.character);
  }

  getPositionLabel(): string {
    const { x, y, z } = this.character.position;
    return `${x.toFixed(1)}, ${z.toFixed(1)}, height ${Math.max(0, y - this.groundY).toFixed(1)}`;
  }

  getPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.character.position);
  }

  setForcePose(isActive: boolean): void {
    this.wantsForcePose = isActive;
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

    this.rotateLook(event.movementX, event.movementY, 0.002, 0.0016);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button > 0) {
      return;
    }

    this.domElement.focus();
    this.isDraggingLook = true;
    this.activePointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.isLocked || !this.isDraggingLook || event.pointerId !== this.activePointerId) {
      return;
    }

    const deltaX = event.clientX - this.lastPointerX;
    const deltaY = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    const sensitivity = event.pointerType === "touch" ? 0.006 : 0.0032;
    this.rotateLook(deltaX, deltaY, sensitivity, sensitivity * 0.8);
    event.preventDefault();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }

    this.isDraggingLook = false;
    this.activePointerId = null;

    if (this.domElement.hasPointerCapture(event.pointerId)) {
      this.domElement.releasePointerCapture(event.pointerId);
    }

    event.preventDefault();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (moveKeys.has(event.code) || actionKeys.has(event.code)) {
      this.pressed.add(event.code);
      event.preventDefault();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (moveKeys.has(event.code) || actionKeys.has(event.code)) {
      this.pressed.delete(event.code);
      event.preventDefault();
    }
  };

  private moveAxis(deltaX: number, deltaZ: number): void {
    this.nextPosition.copy(this.character.position);
    this.nextPosition.x = THREE.MathUtils.clamp(this.nextPosition.x + deltaX, this.bounds.minX, this.bounds.maxX);
    this.nextPosition.z = THREE.MathUtils.clamp(this.nextPosition.z + deltaZ, this.bounds.minZ, this.bounds.maxZ);

    if (
      !this.intersectsBuilding(this.nextPosition.x, this.nextPosition.z, this.character.position.y) &&
      !this.intersectsTraffic(this.nextPosition.x, this.nextPosition.z) &&
      !this.intersectsNpc(this.nextPosition.x, this.nextPosition.z)
    ) {
      this.character.position.copy(this.nextPosition);
    }
  }

  private intersectsBuilding(x: number, z: number, y: number): boolean {
    return this.colliders.some(
      (collider) =>
        x > collider.minX - this.playerRadius &&
        x < collider.maxX + this.playerRadius &&
        z > collider.minZ - this.playerRadius &&
        z < collider.maxZ + this.playerRadius &&
        y < collider.maxY - 0.45,
    );
  }

  private intersectsTraffic(x: number, z: number): boolean {
    return this.getTrafficColliders?.().some((collider) => {
      const dx = x - collider.x;
      const dz = z - collider.z;
      const along = dx * Math.sin(collider.yaw) + dz * Math.cos(collider.yaw);
      const across = dx * Math.cos(collider.yaw) - dz * Math.sin(collider.yaw);
      return Math.abs(along) < collider.halfLength + this.playerRadius && Math.abs(across) < collider.halfWidth + this.playerRadius;
    }) ?? false;
  }

  private intersectsNpc(x: number, z: number): boolean {
    return this.getNpcColliders?.().some((collider) => Math.hypot(x - collider.x, z - collider.z) < this.playerRadius + collider.radius) ?? false;
  }

  private updateFlight(deltaSeconds: number): void {
    const wantsLift = this.pressed.has("Space") && this.character.position.y < this.maxFlightY;
    const targetVelocity = wantsLift ? 11 : -13;
    const supportY = this.getSupportHeight(this.character.position.x, this.character.position.z);
    const smoothing = wantsLift ? 1 - Math.exp(-deltaSeconds * 10) : 1 - Math.exp(-deltaSeconds * 5);
    this.verticalVelocity = THREE.MathUtils.lerp(this.verticalVelocity, targetVelocity, smoothing);
    this.character.position.y += this.verticalVelocity * deltaSeconds;

    if (this.character.position.y >= this.maxFlightY) {
      this.character.position.y = this.maxFlightY;
      this.verticalVelocity = Math.min(this.verticalVelocity, 0);
    }

    if (this.character.position.y <= supportY) {
      this.character.position.y = supportY;
      this.verticalVelocity = 0;
    }
  }

  private getSupportHeight(x: number, z: number): number {
    return this.colliders.reduce((supportY, collider) => {
      const isInsideRoof =
        x > collider.minX - this.playerRadius * 0.35 &&
        x < collider.maxX + this.playerRadius * 0.35 &&
        z > collider.minZ - this.playerRadius * 0.35 &&
        z < collider.maxZ + this.playerRadius * 0.35;

      return isInsideRoof ? Math.max(supportY, collider.maxY) : supportY;
    }, this.groundY);
  }

  private updateCamera(deltaSeconds: number): void {
    const supportY = this.getSupportHeight(this.character.position.x, this.character.position.z);
    const flightLookAmount = THREE.MathUtils.clamp((this.character.position.y - supportY) / 28, 0, 1);
    const effectivePitch = THREE.MathUtils.lerp(this.pitch, Math.min(this.pitch, -0.62), flightLookAmount);
    const horizontalDistance = this.cameraDistance * Math.cos(effectivePitch);
    const verticalOffset = this.cameraHeight + this.cameraDistance * Math.sin(effectivePitch) + flightLookAmount * 3.8;
    this.cameraForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    this.cameraRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
    const behind = this.cameraForward.clone().multiplyScalar(-horizontalDistance);
    const shoulderOffset = this.cameraRight.clone().multiplyScalar(2.15);

    this.targetCameraPosition.copy(this.character.position).add(behind).add(shoulderOffset);
    this.targetCameraPosition.y += verticalOffset;

    const smoothing = 1 - Math.exp(-deltaSeconds * 9);
    this.camera.position.lerp(this.targetCameraPosition, smoothing);

    this.lookTarget.copy(this.character.position).addScaledVector(this.cameraForward, 13 + flightLookAmount * 8);
    this.lookTarget.y += 3.45 - flightLookAmount * 18;
    this.camera.lookAt(this.lookTarget);
  }

  private rotateLook(deltaX: number, deltaY: number, yawSensitivity: number, pitchSensitivity: number): void {
    this.yaw -= deltaX * yawSensitivity;
    this.pitch -= deltaY * pitchSensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.72, 0.16);
  }

  private async loadCharacterModel(): Promise<void> {
    const loadingManager = new THREE.LoadingManager();
    loadingManager.setURLModifier((url) => {
      if (url.endsWith(`Textures/texture-${characterId}.png`)) {
        return resolveAssetUrl(characterTextureUrl);
      }

      return url;
    });
    const loader = new GLTFLoader(loadingManager);

    try {
      const gltf = await loader.loadAsync(resolveAssetUrl(characterUrl));
      const model = normalizeCharacterModel(gltf.scene);

      this.character.remove(this.placeholder);
      this.character.add(model);
      this.visualRoot = model;
      this.leftArm = model.getObjectByName("arm-left");
      this.rightArm = model.getObjectByName("arm-right");
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
      const isGrounded = Math.abs(this.character.position.y - this.getSupportHeight(this.character.position.x, this.character.position.z)) < 0.08;
      const nextAction = isMoving && isGrounded ? this.walkAction : this.idleAction;

      if (nextAction && nextAction !== this.currentAction) {
        nextAction.reset().fadeIn(0.16).play();
        this.currentAction?.fadeOut(0.16);
        this.currentAction = nextAction;
      }

      this.mixer.update(deltaSeconds);
      this.updateVisualPose(deltaSeconds);
      return;
    }

    this.placeholderWalkTime += deltaSeconds * (isMoving ? 9 : 4);
    const sway = Math.sin(this.placeholderWalkTime);
    this.placeholder.position.y = isMoving ? Math.abs(sway) * 0.18 : Math.sin(this.placeholderWalkTime) * 0.04;
    this.placeholder.rotation.z = isMoving ? sway * 0.08 : 0;
    this.updateVisualPose(deltaSeconds);
  }

  private updateVisualPose(deltaSeconds: number): void {
    const targetAmount = this.wantsForcePose ? 1 : 0;
    this.forcePoseAmount = THREE.MathUtils.lerp(this.forcePoseAmount, targetAmount, 1 - Math.exp(-deltaSeconds * 12));
    const supportY = this.getSupportHeight(this.character.position.x, this.character.position.z);
    const flightTarget = THREE.MathUtils.clamp((this.character.position.y - supportY) / 9, 0, 1);
    this.flightPoseAmount = THREE.MathUtils.lerp(this.flightPoseAmount, flightTarget, 1 - Math.exp(-deltaSeconds * 5.4));
    const forceAmount = this.forcePoseAmount;
    const flightAmount = this.flightPoseAmount;

    if (this.visualRoot) {
      this.visualRoot.rotation.x = -1.18 * flightAmount;
      this.visualRoot.position.y = Math.sin(flightAmount * Math.PI) * 0.35;
    }

    if (this.leftArm && this.rightArm) {
      const armForward = Math.max(forceAmount, flightAmount);
      this.leftArm.rotation.x = -1.05 * forceAmount - 0.75 * flightAmount;
      this.leftArm.rotation.y = -0.18 * forceAmount - 0.12 * flightAmount;
      this.leftArm.rotation.z = 0.48 * forceAmount + 0.2 * armForward;
      this.rightArm.rotation.x = -1.05 * forceAmount - 0.75 * flightAmount;
      this.rightArm.rotation.y = 0.18 * forceAmount + 0.12 * flightAmount;
      this.rightArm.rotation.z = -0.48 * forceAmount - 0.2 * armForward;
    }
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
  const scale = 3.75 / safeHeight;

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

function lerpAngle(from: number, to: number, amount: number): number {
  const delta = THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;
  return from + delta * amount;
}
