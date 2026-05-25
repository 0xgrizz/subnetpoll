import * as THREE from "https://unpkg.com/three@0.160.1/build/three.module.min.js";

const PLOT_SCALE = 3.15;
const AUTO_ROTATE_SPEED = 0.0018;
const COLOR_BY_TONE = {
  legit: 0x42f36f,
  bunk: 0xff465b,
  tie: 0x65a8ff,
  quiet: 0x687386
};

let activeLab = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function colorForTone(tone) {
  return COLOR_BY_TONE[tone] || COLOR_BY_TONE.quiet;
}

function createLine(start, end, color, opacity = 0.72) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...start),
    new THREE.Vector3(...end)
  ]);
  const material = new THREE.LineBasicMaterial({
    color,
    opacity,
    transparent: true
  });

  return new THREE.Line(geometry, material);
}

function makeLabelSprite(text, color = "#f7fbff") {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const font = "800 34px Inter, ui-sans-serif, system-ui, sans-serif";
  context.font = font;
  const metrics = context.measureText(text);
  const width = Math.ceil(metrics.width + 34);
  const height = 62;

  canvas.width = width;
  canvas.height = height;
  context.font = font;
  context.fillStyle = "rgba(7, 11, 18, 0.78)";
  context.strokeStyle = "rgba(255, 255, 255, 0.18)";
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(1, 1, width - 2, height - 2, 12);
  context.fill();
  context.stroke();
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width / height * 0.34, 0.34, 1);
  sprite.userData.disposableTexture = texture;

  return sprite;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material.map) material.map.dispose();
        material.dispose();
      });
    }
    if (child.userData?.disposableTexture) child.userData.disposableTexture.dispose();
  });
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    disposeObject(child);
  }
}

function disposeLab() {
  if (!activeLab) return;
  cancelAnimationFrame(activeLab.frame);
  activeLab.cleanups.forEach((cleanup) => cleanup());
  disposeObject(activeLab.scene);
  activeLab.renderer.dispose();
  activeLab.host.innerHTML = "";
  activeLab = null;
}

function resizeLab(lab) {
  const rect = lab.host.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(320, Math.floor(rect.height));

  lab.camera.aspect = width / height;
  lab.camera.updateProjectionMatrix();
  lab.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  lab.renderer.setSize(width, height, false);
}

function makeTooltipHtml(point) {
  return `
    <strong>${escapeHtml(point.subnet)}</strong>
    <span>${escapeHtml(point.ticker)}</span>
    <div><em>X ${escapeHtml(point.xLabel)}</em><b>${escapeHtml(point.xValue)}</b></div>
    <div><em>Y ${escapeHtml(point.yLabel)}</em><b>${escapeHtml(point.yValue)}</b></div>
    <div><em>Z ${escapeHtml(point.zLabel)}</em><b>${escapeHtml(point.zValue)}</b></div>
    <div><em>Size ${escapeHtml(point.sizeLabel)}</em><b>${escapeHtml(point.sizeValue)}</b></div>
    <small>${escapeHtml(point.meta)}</small>
  `;
}

function positionTooltip(lab, event) {
  if (!lab.hovered) return;
  const root = lab.host.closest(".three-lab");
  const rootRect = root.getBoundingClientRect();
  const sceneRect = lab.host.getBoundingClientRect();
  const tooltipRect = lab.tooltip.getBoundingClientRect();
  const minY = clamp(sceneRect.top - rootRect.top + 10, 10, rootRect.height - tooltipRect.height - 10);
  const x = clamp(event.clientX - rootRect.left + 14, 10, rootRect.width - tooltipRect.width - 10);
  const y = clamp(event.clientY - rootRect.top + 14, minY, rootRect.height - tooltipRect.height - 10);
  lab.tooltip.style.left = `${x}px`;
  lab.tooltip.style.top = `${y}px`;
}

function setHovered(lab, mesh, event) {
  if (lab.hovered === mesh) {
    if (event) positionTooltip(lab, event);
    return;
  }

  if (lab.hovered) {
    lab.hovered.material.emissiveIntensity = lab.hovered.userData.selected ? 0.42 : 0.12;
  }

  lab.hovered = mesh || null;
  lab.host.classList.toggle("is-hovering-point", Boolean(mesh));

  if (!mesh) {
    lab.tooltip.hidden = true;
    return;
  }

  mesh.material.emissiveIntensity = 0.72;
  lab.tooltip.innerHTML = makeTooltipHtml(mesh.userData.point);
  lab.tooltip.hidden = false;
  if (event) positionTooltip(lab, event);
}

function pickPoint(lab, event) {
  const rect = lab.renderer.domElement.getBoundingClientRect();
  lab.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  lab.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  lab.raycaster.setFromCamera(lab.pointer, lab.camera);
  const intersections = lab.raycaster.intersectObjects(lab.pointMeshes, false);
  return intersections[0]?.object || null;
}

function updateHover(lab, event) {
  if (lab.dragging) return;
  setHovered(lab, pickPoint(lab, event), event);
}

function addPointerHandlers(lab) {
  const canvas = lab.renderer.domElement;

  const onPointerDown = (event) => {
    lab.dragging = true;
    lab.dragMoved = false;
    lab.lastPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (!lab.dragging) {
      updateHover(lab, event);
      return;
    }

    const dx = event.clientX - lab.lastPointer.x;
    const dy = event.clientY - lab.lastPointer.y;
    lab.dragMoved = lab.dragMoved || Math.abs(dx) + Math.abs(dy) > 4;
    lab.world.rotation.y += dx * 0.006;
    lab.world.rotation.x = clamp(lab.world.rotation.x + dy * 0.006, -1.15, 1.15);
    lab.lastPointer = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event) => {
    canvas.releasePointerCapture?.(event.pointerId);
    lab.dragging = false;
  };
  const onPointerLeave = () => {
    lab.dragging = false;
    setHovered(lab, null);
  };
  const onClick = (event) => {
    if (lab.dragMoved) return;
    const mesh = pickPoint(lab, event);
    if (!mesh) return;
    window.dispatchEvent(new CustomEvent("thumbsflow:select", {
      detail: { key: mesh.userData.point.key }
    }));
  };
  const onWheel = (event) => {
    event.preventDefault();
    lab.camera.position.z = clamp(lab.camera.position.z + event.deltaY * 0.006, 4.2, 10.5);
    lab.camera.lookAt(0, 0, 0);
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  lab.cleanups.push(
    () => canvas.removeEventListener("pointerdown", onPointerDown),
    () => canvas.removeEventListener("pointermove", onPointerMove),
    () => canvas.removeEventListener("pointerup", onPointerUp),
    () => canvas.removeEventListener("pointercancel", onPointerUp),
    () => canvas.removeEventListener("pointerleave", onPointerLeave),
    () => canvas.removeEventListener("click", onClick),
    () => canvas.removeEventListener("wheel", onWheel)
  );
}

function buildAxes(lab, axes) {
  clearGroup(lab.axesGroup);

  const cubeGeometry = new THREE.BoxGeometry(PLOT_SCALE * 2, PLOT_SCALE * 2, PLOT_SCALE * 2);
  const cubeEdges = new THREE.EdgesGeometry(cubeGeometry);
  const cube = new THREE.LineSegments(
    cubeEdges,
    new THREE.LineBasicMaterial({ color: 0x31415d, opacity: 0.58, transparent: true })
  );
  lab.axesGroup.add(cube);

  const grid = new THREE.GridHelper(PLOT_SCALE * 2, 8, 0x324058, 0x1d2738);
  grid.position.y = -PLOT_SCALE;
  grid.material.transparent = true;
  grid.material.opacity = 0.62;
  lab.axesGroup.add(grid);

  lab.axesGroup.add(createLine([-PLOT_SCALE, 0, 0], [PLOT_SCALE, 0, 0], 0x65a8ff, 0.95));
  lab.axesGroup.add(createLine([0, -PLOT_SCALE, 0], [0, PLOT_SCALE, 0], 0xffab47, 0.95));
  lab.axesGroup.add(createLine([0, 0, -PLOT_SCALE], [0, 0, PLOT_SCALE], 0x42f36f, 0.95));

  const xLabel = makeLabelSprite(`X ${axes.x.label}`, "#65a8ff");
  xLabel.position.set(PLOT_SCALE + 0.52, 0, 0);
  const yLabel = makeLabelSprite(`Y ${axes.y.label}`, "#ffab47");
  yLabel.position.set(0, PLOT_SCALE + 0.52, 0);
  const zLabel = makeLabelSprite(`Z ${axes.z.label}`, "#42f36f");
  zLabel.position.set(0, 0, PLOT_SCALE + 0.52);

  lab.axesGroup.add(xLabel, yLabel, zLabel);
}

function buildPoints(lab, payload) {
  clearGroup(lab.pointsGroup);
  lab.pointMeshes = [];

  payload.points.forEach((point) => {
    const color = colorForTone(point.tone);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: point.selected ? 0.46 : 0.12,
      roughness: 0.48,
      metalness: 0.12,
      transparent: true,
      opacity: point.tone === "quiet" ? 0.56 : 0.88
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 26, 18), material);
    mesh.position.set(point.x * PLOT_SCALE, point.y * PLOT_SCALE, point.z * PLOT_SCALE);
    mesh.scale.setScalar(point.radius * PLOT_SCALE * (point.selected ? 1.22 : 1));
    mesh.userData.point = point;
    mesh.userData.selected = point.selected;
    lab.pointsGroup.add(mesh);
    lab.pointMeshes.push(mesh);

    if (point.selected) {
      const label = makeLabelSprite(point.label, "#f7fbff");
      label.position.copy(mesh.position).add(new THREE.Vector3(0, point.radius * PLOT_SCALE + 0.36, 0));
      lab.pointsGroup.add(label);
    }
  });
}

function updateHud(lab, payload) {
  const hud = lab.host.closest(".three-lab")?.querySelector(".three-hud");
  if (!hud) return;

  hud.innerHTML = `
    <span><b>X</b>${escapeHtml(payload.axes.x.label)} <em>${escapeHtml(payload.axes.x.min)} to ${escapeHtml(payload.axes.x.max)}</em></span>
    <span><b>Y</b>${escapeHtml(payload.axes.y.label)} <em>${escapeHtml(payload.axes.y.min)} to ${escapeHtml(payload.axes.y.max)}</em></span>
    <span><b>Z</b>${escapeHtml(payload.axes.z.label)} <em>${escapeHtml(payload.axes.z.min)} to ${escapeHtml(payload.axes.z.max)}</em></span>
    <span><b>Size</b>${escapeHtml(payload.axes.size.label)} <em>${escapeHtml(payload.axes.size.min)} to ${escapeHtml(payload.axes.size.max)}</em></span>
    <span><b>Color</b>${escapeHtml(payload.axes.color.label)} <em>${escapeHtml(payload.axes.color.min)} to ${escapeHtml(payload.axes.color.max)}</em></span>
  `;
}

function updateScene(lab, payload) {
  buildAxes(lab, payload.axes);
  buildPoints(lab, payload);
  updateHud(lab, payload);
}

function animate(lab) {
  if (!lab.dragging && !lab.hovered && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    lab.world.rotation.y += AUTO_ROTATE_SPEED;
  }

  lab.renderer.render(lab.scene, lab.camera);
  lab.frame = requestAnimationFrame(() => animate(lab));
}

function initLab(host) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
  camera.position.set(5.1, 3.9, 7.4);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  host.innerHTML = "";
  host.appendChild(renderer.domElement);

  const world = new THREE.Group();
  world.rotation.x = -0.28;
  world.rotation.y = 0.58;
  const axesGroup = new THREE.Group();
  const pointsGroup = new THREE.Group();
  world.add(axesGroup, pointsGroup);
  scene.add(world);

  scene.add(new THREE.AmbientLight(0xffffff, 0.62));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
  keyLight.position.set(3, 5, 5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x65a8ff, 0.58);
  fillLight.position.set(-4, 2, -3);
  scene.add(fillLight);

  const lab = {
    host,
    tooltip: host.closest(".three-lab").querySelector("[data-three-tooltip]"),
    scene,
    camera,
    renderer,
    world,
    axesGroup,
    pointsGroup,
    pointMeshes: [],
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    hovered: null,
    dragging: false,
    dragMoved: false,
    lastPointer: { x: 0, y: 0 },
    frame: 0,
    cleanups: []
  };

  const observer = new ResizeObserver(() => resizeLab(lab));
  observer.observe(host);
  lab.cleanups.push(() => observer.disconnect());
  addPointerHandlers(lab);
  resizeLab(lab);
  animate(lab);

  return lab;
}

function render3DLab(payload) {
  const host = document.querySelector("[data-three-scene]");
  if (!host || !payload?.points?.length) return;

  if (!activeLab || activeLab.host !== host) {
    disposeLab();
    try {
      activeLab = initLab(host);
    } catch (error) {
      host.innerHTML = `<p class="empty-state">3D renderer unavailable.</p>`;
      console.warn("ThumbsFlow 3D lab failed to start", error);
      return;
    }
  }

  updateScene(activeLab, payload);
}

window.addEventListener("thumbsflow:analytics3d", (event) => {
  render3DLab(event.detail);
});

if (window.THUMBSFLOW_3D_PAYLOAD) {
  render3DLab(window.THUMBSFLOW_3D_PAYLOAD);
}
