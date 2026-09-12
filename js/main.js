import { createGame } from "./game.js";

const root = document.getElementById("app");

try {
  createGame(root);
} catch (error) {
  console.error(error);
  const panel = root.querySelector("#panel-title");
  if (panel) {
    panel.innerHTML = "";
    const h = document.createElement("h2");
    h.textContent = "Could not start";
    const p = document.createElement("p");
    p.className = "tagline";
    p.textContent = String(error?.message ?? error);
    panel.append(h, p);
  }
}
