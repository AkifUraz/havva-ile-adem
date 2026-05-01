import * as THREE from "three";

interface FeedbackParticle {
  object: THREE.Object3D;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
}

export interface FeedbackSystem {
  addLaserSpark(position: THREE.Vector3): void;
  addDustBurst(position: THREE.Vector3, scale: number): void;
  shake(amount: number, seconds: number): void;
  update(deltaSeconds: number, camera: THREE.Camera): void;
  dispose(): void;
}

const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0a8 });
const dustMaterial = new THREE.MeshBasicMaterial({ color: 0xb7b0a5, transparent: true, opacity: 0.42 });

export function createFeedbackSystem(scene: THREE.Scene): FeedbackSystem {
  const particles: FeedbackParticle[] = [];
  let shakeTime = 0;
  let shakeDuration = 0;
  let shakeAmount = 0;
  let shakeSeed = 0;

  return {
    addLaserSpark(position: THREE.Vector3) {
      if (particles.length > 80) {
        return;
      }

      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), sparkMaterial);
      spark.position.copy(position);
      scene.add(spark);
      particles.push({
        object: spark,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 4, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 4),
        age: 0,
        lifetime: 0.24,
      });
    },
    addDustBurst(position: THREE.Vector3, scale: number) {
      for (let index = 0; index < 10 && particles.length < 100; index += 1) {
        const dust = new THREE.Mesh(new THREE.SphereGeometry(0.42 + Math.random() * 0.28, 7, 5), dustMaterial.clone());
        dust.position.copy(position);
        scene.add(dust);
        particles.push({
          object: dust,
          velocity: new THREE.Vector3((Math.random() - 0.5) * scale * 5, 2 + Math.random() * scale * 3, (Math.random() - 0.5) * scale * 5),
          age: 0,
          lifetime: 0.8 + Math.random() * 0.45,
        });
      }
    },
    shake(amount: number, seconds: number) {
      shakeAmount = Math.max(shakeAmount, amount);
      shakeDuration = Math.max(shakeDuration, seconds);
      shakeTime = Math.max(shakeTime, seconds);
      shakeSeed += 1;
    },
    update(deltaSeconds: number, camera: THREE.Camera) {
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.age += deltaSeconds;

        if (particle.age >= particle.lifetime) {
          scene.remove(particle.object);
          particles.splice(index, 1);
          continue;
        }

        particle.velocity.y -= 7 * deltaSeconds;
        particle.object.position.addScaledVector(particle.velocity, deltaSeconds);
        particle.object.scale.multiplyScalar(1 + deltaSeconds * 0.9);

        const material = particle.object instanceof THREE.Mesh ? particle.object.material : undefined;
        if (material instanceof THREE.MeshBasicMaterial) {
          material.opacity = Math.max(0, 1 - particle.age / particle.lifetime) * 0.42;
        }
      }

      if (shakeTime > 0) {
        const progress = shakeDuration > 0 ? shakeTime / shakeDuration : 0;
        const amount = shakeAmount * progress;
        camera.position.x += Math.sin(shakeSeed * 12.989 + shakeTime * 70) * amount;
        camera.position.y += Math.cos(shakeSeed * 78.233 + shakeTime * 53) * amount * 0.45;
        shakeTime = Math.max(0, shakeTime - deltaSeconds);

        if (shakeTime === 0) {
          shakeAmount = 0;
          shakeDuration = 0;
        }
      }
    },
    dispose() {
      particles.forEach((particle) => scene.remove(particle.object));
      particles.length = 0;
    },
  };
}
