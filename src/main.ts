import { CitySandboxApp } from "./render/app";
import { createHud } from "./ui/hud";
import "./style.css";

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("Missing #app root element.");
}

const hud = createHud(appRoot);
const cityApp = new CitySandboxApp(appRoot, hud);

cityApp.start().catch((error: unknown) => {
  console.error(error);
  hud.setMessage("City assets could not be loaded. Check the console for details.");
});
