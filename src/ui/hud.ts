export interface HudController {
  element: HTMLDivElement;
  lockButton: HTMLButtonElement;
  setLocked(isLocked: boolean): void;
  setMessage(message: string): void;
  setPosition(position: string): void;
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
  lockButton.textContent = "Click to guide the character. WASD moves, mouse rotates camera, Esc releases.";

  status.append(title, position, message);
  element.append(status, lockButton);
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
  };
}
