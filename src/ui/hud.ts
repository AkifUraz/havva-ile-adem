export interface HudController {
  element: HTMLDivElement;
  lockButton: HTMLButtonElement;
  setLocked(isLocked: boolean): void;
  setMessage(message: string): void;
  setPosition(position: string): void;
  setForceProgress(progress: number, isLocked: boolean): void;
  setReticleOffset(offsetX: number, offsetY: number): void;
}

export function createHud(root: HTMLElement): HudController {
  const element = document.createElement("div");
  element.className = "hud";

  const status = document.createElement("div");
  status.className = "hud__status";

  const title = document.createElement("div");
  title.className = "hud__title";
  title.textContent = "Modern City Sandbox";

  const position = document.createElement("div");
  position.className = "hud__position";
  position.textContent = "Position: loading";

  const message = document.createElement("div");
  message.className = "hud__message";
  message.textContent = "Loading city assets";

  const lockButton = document.createElement("button");
  lockButton.className = "hud__lock";
  lockButton.type = "button";
  lockButton.textContent = "Move the hidden mouse to aim. Hold on a target to use power. WASD moves.";

  const reticle = document.createElement("div");
  reticle.className = "hud__reticle";

  const reticleProgress = document.createElement("div");
  reticleProgress.className = "hud__reticle-progress";
  reticle.append(reticleProgress);

  status.append(title, position, message);
  element.append(status, reticle, lockButton);
  root.appendChild(element);

  return {
    element,
    lockButton,
    setLocked(isLocked: boolean) {
      lockButton.classList.toggle("hud__lock--hidden", isLocked);
    },
    setMessage(nextMessage: string) {
      message.textContent = nextMessage;
    },
    setPosition(nextPosition: string) {
      position.textContent = `Position: ${nextPosition}`;
    },
    setForceProgress(progress: number, isLocked: boolean) {
      const clampedProgress = Math.max(0, Math.min(1, progress));
      reticle.style.setProperty("--force-progress", `${clampedProgress}`);
      reticle.classList.toggle("hud__reticle--active", clampedProgress > 0);
      reticle.classList.toggle("hud__reticle--locked", isLocked);
    },
    setReticleOffset(offsetX: number, offsetY: number) {
      reticle.style.setProperty("--reticle-x", `${offsetX}px`);
      reticle.style.setProperty("--reticle-y", `${offsetY}px`);
    },
  };
}
