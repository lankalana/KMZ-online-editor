import JSZip from "jszip";
import L, { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "../style.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type LatLng = { lat: number; lng: number };
type ImagePoint = { x: number; y: number };
type PointPair = { id: number; image: ImagePoint; map: LatLng };
type ImportInfo = { name?: string; opacity?: number; roughPairs?: PointPair[] };
type WarpPreview = {
  blob: Blob;
  url: string;
  bounds: [[number, number], [number, number]];
  north: number;
  south: number;
  east: number;
  west: number;
};

type Projection = {
  forward: (ll: LatLng) => [number, number];
  inverse: (xy: [number, number]) => LatLng;
};

const EARTH_RADIUS_M = 6378137.0;
const MAX_OUTPUT_DIM = 4096;
const MAX_OUTPUT_PIXELS = 16_000_000;
const DEFAULT_REAL_CENTER: [number, number] = [64.5, 26.0];
const DEFAULT_REAL_ZOOM = 5;

/** Imperative adapter for Leaflet, canvas and browser file APIs.
 * React owns page composition; this controller owns mutable third-party objects.
 */
export class GeoreferenceController {
  private sourceInput = this.byId<HTMLInputElement>("sourceInput");
  private kmzInput = this.byId<HTMLInputElement>("kmzInput");
  private overlayNameInput = this.byId<HTMLInputElement>("overlayName");
  private opacityInput = this.byId<HTMLInputElement>("opacityInput");
  private previewOpacityInput = this.byId<HTMLInputElement>("previewOpacity");
  private previewOpacityValue = this.byId<HTMLElement>("previewOpacityValue");
  private resetAllBtn = this.byId<HTMLButtonElement>("resetAllBtn");

  private finishRoughBtn = this.byId<HTMLButtonElement>("finishRoughBtn");
  private undoRoughBtn = this.byId<HTMLButtonElement>("undoRoughBtn");
  private clearRoughBtn = this.byId<HTMLButtonElement>("clearRoughBtn");
  private backToRoughBtn = this.byId<HTMLButtonElement>("backToRoughBtn");
  private previewBtn = this.byId<HTMLButtonElement>("previewBtn");
  private undoPreciseBtn = this.byId<HTMLButtonElement>("undoPreciseBtn");
  private clearPreciseBtn = this.byId<HTMLButtonElement>("clearPreciseBtn");
  private backToPreciseBtn = this.byId<HTMLButtonElement>("backToPreciseBtn");
  private downloadKmzBtn = this.byId<HTMLButtonElement>("downloadKmzBtn");

  private editorSection = this.byId<HTMLElement>("editorSection");
  private previewSection = this.byId<HTMLElement>("previewSection");
  private roughPanel = this.byId<HTMLElement>("roughPanel");
  private precisePanel = this.byId<HTMLElement>("precisePanel");
  private roughTableBody = this.byId<HTMLTableSectionElement>("roughTableBody");
  private preciseTableBody = this.byId<HTMLTableSectionElement>("preciseTableBody");
  private statusText = this.byId<HTMLElement>("statusText");
  private statusDetail = this.byId<HTMLElement>("statusDetail");

  private stepChip1 = this.byId<HTMLElement>("stepChip1");
  private stepChip2 = this.byId<HTMLElement>("stepChip2");
  private stepChip3 = this.byId<HTMLElement>("stepChip3");

  private imageMap: any;
  private realMap: any;
  private previewMap: any;
  private imageLayer: any | null = null;
  private previewOverlay: any | null = null;

  private roughImageMarkers: any[] = [];
  private roughRealMarkers: any[] = [];
  private preciseImageMarkers: any[] = [];
  private preciseRealMarkers: any[] = [];
  private pendingImageMarker: any | null = null;
  private pendingRealMarker: any | null = null;

  private sourceCanvas: HTMLCanvasElement | null = null;
  private sourceImageUrl: string | null = null;
  private imageWidth = 0;
  private imageHeight = 0;

  private roughPairs: PointPair[] = [];
  private precisePairs: PointPair[] = [];
  private nextPointId = 1;
  private pendingRoughImage: ImagePoint | null = null;
  private pendingRoughMap: LatLng | null = null;
  private pendingPreciseImage: ImagePoint | null = null;
  private pendingPreciseMap: LatLng | null = null;
  private step: 1 | 2 | 3 = 1;

  private roughProjection: Projection | null = null;
  private roughHomography: number[][] | null = null;
  private roughHomographyInv: number[][] | null = null;
  private syncLock = false;

  private previewCache: WarpPreview | null = null;

  constructor() {
    this.initMaps();
    this.bindEvents();
    this.render();
  }

  private byId<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element: ${id}`);
    return el as T;
  }

  private initMaps(): void {
    this.imageMap = L.map("imageMap", {
      crs: L.CRS.Simple,
      zoomSnap: 0.25,
      zoomDelta: 0.25,
      minZoom: -5,
      maxZoom: 8,
      attributionControl: false,
    }).setView([0, 0], 0);

    this.realMap = L.map("realMap", {
      zoomSnap: 0.25,
      zoomDelta: 0.25,
    }).setView(DEFAULT_REAL_CENTER, DEFAULT_REAL_ZOOM);

    this.previewMap = L.map("previewMap", {
      zoomSnap: 0.25,
      zoomDelta: 0.25,
    }).setView(DEFAULT_REAL_CENTER, DEFAULT_REAL_ZOOM);

    const topo = () =>
      L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
        maxZoom: 17,
        attribution: "Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap",
      });
    const osm = () =>
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
      });

    const realTopo = topo().addTo(this.realMap);
    const realOsm = osm();
    L.control
      .layers({ "Terrain / OpenTopoMap": realTopo, OpenStreetMap: realOsm })
      .addTo(this.realMap);

    const previewTopo = topo().addTo(this.previewMap);
    const previewOsm = osm();
    L.control
      .layers({ "Terrain / OpenTopoMap": previewTopo, OpenStreetMap: previewOsm })
      .addTo(this.previewMap);

    this.previewSection.hidden = true;
    setTimeout(() => {
      this.imageMap.invalidateSize();
      this.realMap.invalidateSize();
      this.previewMap.invalidateSize();
    }, 50);
  }

  private bindEvents(): void {
    this.sourceInput.addEventListener("change", () => void this.onSourceFileSelected());
    this.kmzInput.addEventListener("change", () => void this.onKmzSelected());
    this.opacityInput.addEventListener("input", () => {
      const opacity = this.getOpacity();
      this.previewOpacityInput.value = String(opacity);
      this.previewOpacityValue.textContent = `${opacity}%`;
      if (this.previewOverlay) this.previewOverlay.setOpacity(opacity / 100);
    });
    this.previewOpacityInput.addEventListener("input", () => {
      this.opacityInput.value = this.previewOpacityInput.value;
      this.previewOpacityValue.textContent = `${this.previewOpacityInput.value}%`;
      if (this.previewOverlay) this.previewOverlay.setOpacity(this.getOpacity() / 100);
    });
    this.resetAllBtn.addEventListener("click", () => this.resetAll());

    this.finishRoughBtn.addEventListener("click", () => this.finishRoughAlignment());
    this.undoRoughBtn.addEventListener("click", () => {
      this.roughPairs.pop();
      this.invalidatePreview();
      this.render();
    });
    this.clearRoughBtn.addEventListener("click", () => {
      this.roughPairs = [];
      this.pendingRoughImage = null;
      this.pendingRoughMap = null;
      this.roughProjection = null;
      this.roughHomography = null;
      this.roughHomographyInv = null;
      this.invalidatePreview();
      this.render();
    });

    this.backToRoughBtn.addEventListener("click", () => {
      this.step = 1;
      this.previewSection.hidden = true;
      this.editorSection.hidden = false;
      this.invalidateSizes();
      this.render();
    });
    this.previewBtn.addEventListener("click", () => void this.generatePreview());
    this.undoPreciseBtn.addEventListener("click", () => {
      this.precisePairs.pop();
      this.invalidatePreview();
      this.render();
    });
    this.clearPreciseBtn.addEventListener("click", () => {
      this.precisePairs = [];
      this.pendingPreciseImage = null;
      this.pendingPreciseMap = null;
      this.invalidatePreview();
      this.render();
    });

    this.backToPreciseBtn.addEventListener("click", () => {
      this.step = 2;
      this.previewSection.hidden = true;
      this.editorSection.hidden = false;
      this.invalidateSizes();
      this.render();
    });
    this.downloadKmzBtn.addEventListener("click", () => void this.downloadKmz());

    this.imageMap.on("click", (ev: any) => this.handleImageMapClick(ev));
    this.realMap.on("click", (ev: any) => this.handleRealMapClick(ev));

    this.imageMap.on("moveend", () => this.syncFromImageMap());
    this.realMap.on("moveend", () => this.syncFromRealMap());
  }

  private invalidateSizes(): void {
    setTimeout(() => {
      this.imageMap.invalidateSize();
      this.realMap.invalidateSize();
      this.previewMap.invalidateSize();
    }, 30);
  }

  private setStatus(text: string, detail = "", error = false): void {
    this.statusText.textContent = text;
    this.statusText.classList.toggle("error", error);
    this.statusDetail.textContent = detail;
  }

  private resetAll(): void {
    this.revokeSourceUrl();
    this.revokePreviewUrl();
    this.sourceCanvas = null;
    this.imageWidth = 0;
    this.imageHeight = 0;
    this.roughPairs = [];
    this.precisePairs = [];
    this.nextPointId = 1;
    this.pendingRoughImage = null;
    this.pendingRoughMap = null;
    this.pendingPreciseImage = null;
    this.pendingPreciseMap = null;
    this.roughProjection = null;
    this.roughHomography = null;
    this.roughHomographyInv = null;
    this.previewCache = null;
    this.step = 1;
    if (this.imageLayer) {
      this.imageMap.removeLayer(this.imageLayer);
      this.imageLayer = null;
    }
    if (this.previewOverlay) {
      this.previewMap.removeLayer(this.previewOverlay);
      this.previewOverlay = null;
    }
    this.previewSection.hidden = true;
    this.editorSection.hidden = false;
    this.overlayNameInput.value = "Image overlay";
    this.opacityInput.value = "85";
    this.previewOpacityInput.value = "85";
    this.previewOpacityValue.textContent = "85%";
    this.sourceInput.value = "";
    this.kmzInput.value = "";
    this.realMap.setView(DEFAULT_REAL_CENTER, DEFAULT_REAL_ZOOM);
    this.previewMap.setView(DEFAULT_REAL_CENTER, DEFAULT_REAL_ZOOM);
    this.render();
    this.setStatus("Reset complete.", "Load a source image/PDF or import a KMZ.");
  }

  private revokeSourceUrl(): void {
    if (this.sourceImageUrl) {
      URL.revokeObjectURL(this.sourceImageUrl);
      this.sourceImageUrl = null;
    }
  }

  private revokePreviewUrl(): void {
    if (this.previewCache) {
      URL.revokeObjectURL(this.previewCache.url);
      this.previewCache = null;
    }
  }

  private invalidatePreview(): void {
    if (this.previewCache) {
      URL.revokeObjectURL(this.previewCache.url);
      this.previewCache = null;
    }
    if (this.previewOverlay) {
      this.previewMap.removeLayer(this.previewOverlay);
      this.previewOverlay = null;
    }
  }

  private async onSourceFileSelected(): Promise<void> {
    const file = this.sourceInput.files?.[0];
    if (!file) return;
    try {
      this.setStatus("Loading source...", file.name);
      const result = await this.loadSourceFile(file);
      this.loadSourceCanvas(result.canvas, { name: result.name });
      this.kmzInput.value = "";
      this.setStatus("Source loaded.", "Add 4 rough point pairs in step 1.");
    } catch (error) {
      this.setStatus("Could not load source.", String(error), true);
    }
  }

  private async onKmzSelected(): Promise<void> {
    const file = this.kmzInput.files?.[0];
    if (!file) return;
    try {
      this.setStatus("Importing KMZ...", file.name);
      const imported = await this.importKmz(file);
      this.loadSourceCanvas(imported.canvas, imported.info);
      if (imported.info.roughPairs && imported.info.roughPairs.length === 4) {
        this.roughPairs = imported.info.roughPairs.map((p) => ({
          ...p,
          image: { ...p.image },
          map: { ...p.map },
        }));
        this.finishRoughAlignment(true);
        this.setStatus(
          "KMZ imported.",
          "Rough alignment was seeded from the imported overlay corners. Refine points in step 2.",
        );
      } else {
        this.setStatus("KMZ imported.", "Add or adjust rough points in step 1.");
      }
      this.sourceInput.value = "";
    } catch (error) {
      this.setStatus("Could not import KMZ.", String(error), true);
    }
  }

  private async loadSourceFile(file: File): Promise<{ canvas: HTMLCanvasElement; name: string }> {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      const data = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not create a canvas context.");
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      return { canvas, name: file.name.replace(/\.pdf$/i, "") };
    }

    if (/\.(png|jpg|jpeg)$/i.test(lower)) {
      const canvas = await this.fileToCanvas(file);
      return { canvas, name: file.name.replace(/\.(png|jpg|jpeg)$/i, "") };
    }

    throw new Error("Supported source formats: PDF, PNG, JPG and JPEG.");
  }

  private async fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
    const url = URL.createObjectURL(file);
    try {
      return await this.urlToCanvas(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private urlToCanvas(url: string): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not create a canvas context."));
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error("Could not decode image."));
      img.src = url;
    });
  }

  private loadSourceCanvas(canvas: HTMLCanvasElement, info: ImportInfo = {}): void {
    this.resetAll();
    this.sourceCanvas = canvas;
    this.imageWidth = canvas.width;
    this.imageHeight = canvas.height;
    this.overlayNameInput.value = info.name ?? "Image overlay";
    const opacity = Math.max(0, Math.min(100, Math.round(info.opacity ?? 85)));
    this.opacityInput.value = String(opacity);
    this.previewOpacityInput.value = String(opacity);
    this.previewOpacityValue.textContent = `${opacity}%`;

    this.revokeSourceUrl();
    this.sourceImageUrl = canvas.toDataURL("image/png");
    const bounds = [
      [0, 0],
      [Math.max(0, this.imageHeight - 1), Math.max(0, this.imageWidth - 1)],
    ];
    this.imageLayer = L.imageOverlay(this.sourceImageUrl, bounds as LatLngBoundsExpression, {
      interactive: false,
    });
    this.imageLayer.addTo(this.imageMap);
    this.imageMap.fitBounds(bounds, { padding: [20, 20] });
    this.realMap.setView(DEFAULT_REAL_CENTER, DEFAULT_REAL_ZOOM);
    this.step = 1;
    if (info.roughPairs) {
      this.roughPairs = info.roughPairs.map((p) => ({
        ...p,
        image: { ...p.image },
        map: { ...p.map },
      }));
      const maxId = this.roughPairs.reduce((m, p) => Math.max(m, p.id), 0);
      this.nextPointId = maxId + 1;
    }
    this.render();
    this.invalidateSizes();
  }

  private makeMarkerIcon(label: string, kind: "rough" | "precise" | "pending"): any {
    return L.divIcon({
      className: "",
      html: `<div class="marker-pill ${kind}">${label}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  private clearMarkerArrays(arrays: any[][]): void {
    for (const arr of arrays) {
      for (const marker of arr) marker.remove();
      arr.length = 0;
    }
  }

  private render(): void {
    this.updateStepChips();
    this.roughPanel.style.display = this.step === 1 ? "block" : "none";
    this.precisePanel.style.display = this.step === 2 ? "block" : "none";
    this.editorSection.hidden = this.step === 3;
    this.previewSection.hidden = this.step !== 3;

    this.renderRough();
    this.renderPrecise();

    const hasSource = !!this.sourceCanvas;
    this.finishRoughBtn.disabled = !(hasSource && this.roughPairs.length === 4);
    this.undoRoughBtn.disabled = this.roughPairs.length === 0;
    this.clearRoughBtn.disabled =
      this.roughPairs.length === 0 && !this.pendingRoughImage && !this.pendingRoughMap;
    this.backToRoughBtn.disabled = !hasSource;
    this.previewBtn.disabled = !(
      hasSource &&
      this.roughHomography &&
      this.precisePairs.length >= 5
    );
    this.undoPreciseBtn.disabled = this.precisePairs.length === 0;
    this.clearPreciseBtn.disabled =
      this.precisePairs.length === 0 && !this.pendingPreciseImage && !this.pendingPreciseMap;
    this.downloadKmzBtn.disabled = !this.previewCache;
  }

  private updateStepChips(): void {
    const chips = [this.stepChip1, this.stepChip2, this.stepChip3];
    chips.forEach((chip, idx) => {
      chip.classList.remove("active", "done");
      const n = idx + 1;
      if (n === this.step) chip.classList.add("active");
      if (n < this.step) chip.classList.add("done");
    });
  }

  private renderRough(): void {
    this.clearMarkerArrays([this.roughImageMarkers, this.roughRealMarkers]);
    if (this.pendingImageMarker) {
      this.pendingImageMarker.remove();
      this.pendingImageMarker = null;
    }
    if (this.pendingRealMarker) {
      this.pendingRealMarker.remove();
      this.pendingRealMarker = null;
    }
    this.roughTableBody.innerHTML = "";

    // Rough pairs only establish the linked viewport transform used in step 2.
    // They do not contribute to the final thin-plate-spline overlay, so keep
    // their markers out of the precise control-point workspace.
    if (this.step !== 1) return;

    for (let i = 0; i < this.roughPairs.length; i++) {
      const pair = this.roughPairs[i];
      const label = String(i + 1);
      const imageMarker = L.marker(this.imagePointToLeaflet(pair.image), {
        draggable: true,
        icon: this.makeMarkerIcon(label, "rough"),
      }).addTo(this.imageMap);
      imageMarker.on("dragend", () => {
        const ll = imageMarker.getLatLng();
        pair.image = this.leafletToImagePoint(ll);
        this.invalidatePreview();
        this.render();
      });
      this.roughImageMarkers.push(imageMarker);

      const realMarker = L.marker([pair.map.lat, pair.map.lng], {
        draggable: true,
        icon: this.makeMarkerIcon(label, "rough"),
      }).addTo(this.realMap);
      realMarker.on("dragend", () => {
        const ll = realMarker.getLatLng();
        pair.map = { lat: ll.lat, lng: ll.lng };
        this.invalidatePreview();
        this.render();
      });
      this.roughRealMarkers.push(realMarker);

      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${i + 1}</td><td>${pair.image.x.toFixed(1)}</td><td>${pair.image.y.toFixed(1)}</td>` +
        `<td>${pair.map.lat.toFixed(6)}</td><td>${pair.map.lng.toFixed(6)}</td>`;
      const tdDelete = document.createElement("td");
      const btn = document.createElement("button");
      btn.className = "text-button";
      btn.textContent = "Delete";
      btn.addEventListener("click", () => {
        this.roughPairs = this.roughPairs.filter((p) => p.id !== pair.id);
        this.invalidatePreview();
        this.render();
      });
      tdDelete.appendChild(btn);
      tr.appendChild(tdDelete);
      this.roughTableBody.appendChild(tr);
    }

    if (this.step === 1 && this.pendingRoughImage) {
      this.pendingImageMarker = L.marker(this.imagePointToLeaflet(this.pendingRoughImage), {
        icon: this.makeMarkerIcon("•", "pending"),
      }).addTo(this.imageMap);
    }
    if (this.step === 1 && this.pendingRoughMap) {
      this.pendingRealMarker = L.marker([this.pendingRoughMap.lat, this.pendingRoughMap.lng], {
        icon: this.makeMarkerIcon("•", "pending"),
      }).addTo(this.realMap);
    }
  }

  private renderPrecise(): void {
    this.clearMarkerArrays([this.preciseImageMarkers, this.preciseRealMarkers]);
    this.preciseTableBody.innerHTML = "";

    for (let i = 0; i < this.precisePairs.length; i++) {
      const pair = this.precisePairs[i];
      const label = String(i + 1);
      const imageMarker = L.marker(this.imagePointToLeaflet(pair.image), {
        draggable: true,
        icon: this.makeMarkerIcon(label, "precise"),
      }).addTo(this.imageMap);
      imageMarker.on("dragend", () => {
        const ll = imageMarker.getLatLng();
        pair.image = this.leafletToImagePoint(ll);
        this.invalidatePreview();
        this.render();
      });
      this.preciseImageMarkers.push(imageMarker);

      const realMarker = L.marker([pair.map.lat, pair.map.lng], {
        draggable: true,
        icon: this.makeMarkerIcon(label, "precise"),
      }).addTo(this.realMap);
      realMarker.on("dragend", () => {
        const ll = realMarker.getLatLng();
        pair.map = { lat: ll.lat, lng: ll.lng };
        this.invalidatePreview();
        this.render();
      });
      this.preciseRealMarkers.push(realMarker);

      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${i + 1}</td><td>${pair.image.x.toFixed(1)}</td><td>${pair.image.y.toFixed(1)}</td>` +
        `<td>${pair.map.lat.toFixed(6)}</td><td>${pair.map.lng.toFixed(6)}</td>`;
      const tdDelete = document.createElement("td");
      const btn = document.createElement("button");
      btn.className = "text-button";
      btn.textContent = "Delete";
      btn.addEventListener("click", () => {
        this.precisePairs = this.precisePairs.filter((p) => p.id !== pair.id);
        this.invalidatePreview();
        this.render();
      });
      tdDelete.appendChild(btn);
      tr.appendChild(tdDelete);
      this.preciseTableBody.appendChild(tr);
    }
  }

  private handleImageMapClick(ev: any): void {
    if (!this.sourceCanvas) return;
    const point = this.leafletToImagePoint(ev.latlng);
    if (this.step === 1) {
      if (this.roughPairs.length >= 4) {
        this.setStatus(
          "Rough alignment already has 4 points.",
          "Move or delete a point, or finish rough alignment.",
        );
        return;
      }
      this.pendingRoughImage = point;
      if (this.pendingRoughMap) {
        this.roughPairs.push({
          id: this.nextPointId++,
          image: this.pendingRoughImage,
          map: this.pendingRoughMap,
        });
        this.pendingRoughImage = null;
        this.pendingRoughMap = null;
        this.setStatus("Added rough point pair.", `${this.roughPairs.length}/4 rough pairs.`);
      } else {
        this.setStatus(
          "Image rough point selected.",
          "Click the corresponding location on the terrain map.",
        );
      }
      this.render();
      return;
    }

    if (this.step === 2) {
      this.pendingPreciseImage = point;
      if (this.pendingPreciseMap) {
        this.precisePairs.push({
          id: this.nextPointId++,
          image: this.pendingPreciseImage,
          map: this.pendingPreciseMap,
        });
        this.pendingPreciseImage = null;
        this.pendingPreciseMap = null;
        this.invalidatePreview();
        this.setStatus(
          "Added precise point pair.",
          `${this.precisePairs.length} precise pairs. Minimum: 5.`,
        );
      } else {
        this.setStatus(
          "Image precise point selected.",
          "Click the corresponding location on the terrain map.",
        );
      }
      this.render();
    }
  }

  private handleRealMapClick(ev: any): void {
    if (!this.sourceCanvas) return;
    const point: LatLng = { lat: ev.latlng.lat, lng: ev.latlng.lng };
    if (this.step === 1) {
      if (this.roughPairs.length >= 4) {
        this.setStatus(
          "Rough alignment already has 4 points.",
          "Move or delete a point, or finish rough alignment.",
        );
        return;
      }
      this.pendingRoughMap = point;
      if (this.pendingRoughImage) {
        this.roughPairs.push({
          id: this.nextPointId++,
          image: this.pendingRoughImage,
          map: this.pendingRoughMap,
        });
        this.pendingRoughImage = null;
        this.pendingRoughMap = null;
        this.setStatus("Added rough point pair.", `${this.roughPairs.length}/4 rough pairs.`);
      } else {
        this.setStatus(
          "Map rough point selected.",
          "Click the corresponding location on the image.",
        );
      }
      this.render();
      return;
    }

    if (this.step === 2) {
      this.pendingPreciseMap = point;
      if (this.pendingPreciseImage) {
        this.precisePairs.push({
          id: this.nextPointId++,
          image: this.pendingPreciseImage,
          map: this.pendingPreciseMap,
        });
        this.pendingPreciseImage = null;
        this.pendingPreciseMap = null;
        this.invalidatePreview();
        this.setStatus(
          "Added precise point pair.",
          `${this.precisePairs.length} precise pairs. Minimum: 5.`,
        );
      } else {
        this.setStatus(
          "Map precise point selected.",
          "Click the corresponding location on the image.",
        );
      }
      this.render();
    }
  }

  private finishRoughAlignment(auto = false): void {
    if (this.roughPairs.length !== 4) {
      this.setStatus(
        "Rough alignment needs exactly 4 pairs.",
        "Add or adjust rough point pairs first.",
        true,
      );
      return;
    }
    try {
      const roughMapPoints = this.roughPairs.map((p) => p.map);
      this.roughProjection = this.makeLocalProjection(roughMapPoints);
      const src = this.roughPairs.map((p) => [p.image.x, p.image.y] as [number, number]);
      const dst = this.roughPairs.map((p) => this.roughProjection!.forward(p.map));
      this.roughHomography = this.computeHomography(src, dst);
      this.roughHomographyInv = this.invert3x3(this.roughHomography);
      this.zoomToRoughArea();
      this.step = 2;
      this.render();
      if (!auto) {
        this.setStatus(
          "Rough alignment finished.",
          "Image and terrain map are now linked. Add at least 5 precise point pairs.",
        );
      }
    } catch (error) {
      this.setStatus("Could not finish rough alignment.", String(error), true);
    }
  }

  private zoomToRoughArea(): void {
    const imgBounds = L.latLngBounds(this.roughPairs.map((p) => this.imagePointToLeaflet(p.image)));
    this.imageMap.fitBounds(imgBounds.pad(0.5));
    const realBounds = L.latLngBounds(this.roughPairs.map((p) => [p.map.lat, p.map.lng]));
    this.realMap.fitBounds(realBounds.pad(0.5));
  }

  private imagePointToLeaflet(point: ImagePoint): [number, number] {
    return [Math.max(0, this.imageHeight - 1) - point.y, point.x];
  }

  private leafletToImagePoint(latlng: { lat: number; lng: number }): ImagePoint {
    return {
      x: latlng.lng,
      y: Math.max(0, this.imageHeight - 1) - latlng.lat,
    };
  }

  private imageViewportCorners(): ImagePoint[] {
    const size = this.imageMap.getSize();
    return [
      this.leafletToImagePoint(this.imageMap.containerPointToLatLng([0, 0])),
      this.leafletToImagePoint(this.imageMap.containerPointToLatLng([size.x, 0])),
      this.leafletToImagePoint(this.imageMap.containerPointToLatLng([size.x, size.y])),
      this.leafletToImagePoint(this.imageMap.containerPointToLatLng([0, size.y])),
    ];
  }

  private realViewportCorners(): LatLng[] {
    const size = this.realMap.getSize();
    return [
      this.toLatLng(this.realMap.containerPointToLatLng([0, 0])),
      this.toLatLng(this.realMap.containerPointToLatLng([size.x, 0])),
      this.toLatLng(this.realMap.containerPointToLatLng([size.x, size.y])),
      this.toLatLng(this.realMap.containerPointToLatLng([0, size.y])),
    ];
  }

  private toLatLng(value: { lat: number; lng: number }): LatLng {
    return { lat: value.lat, lng: value.lng };
  }

  private syncFromImageMap(): void {
    if (this.step !== 2 || this.syncLock || !this.roughProjection || !this.roughHomography) return;

    const mappedCorners = this.imageViewportCorners().map((point) => {
      const projected = this.applyHomography(this.roughHomography!, [point.x, point.y]);
      return this.roughProjection!.inverse(projected);
    });
    const targetBounds = L.latLngBounds(mappedCorners.map((p) => [p.lat, p.lng]));

    this.syncLock = true;
    this.realMap.fitBounds(targetBounds, { animate: false, padding: [0, 0] });
    this.syncLock = false;
  }

  private syncFromRealMap(): void {
    if (this.step !== 2 || this.syncLock || !this.roughProjection || !this.roughHomographyInv)
      return;

    const mappedCorners = this.realViewportCorners().map((point) => {
      const projected = this.roughProjection!.forward(point);
      const imagePoint = this.applyHomography(this.roughHomographyInv!, projected);
      return this.imagePointToLeaflet({ x: imagePoint[0], y: imagePoint[1] });
    });
    const targetBounds = L.latLngBounds(mappedCorners);

    this.syncLock = true;
    this.imageMap.fitBounds(targetBounds, { animate: false, padding: [0, 0] });
    this.syncLock = false;
  }

  private async generatePreview(): Promise<void> {
    if (!this.sourceCanvas) return;
    if (this.precisePairs.length < 5) {
      this.setStatus(
        "At least 5 precise point pairs are required.",
        "Add more points first.",
        true,
      );
      return;
    }
    try {
      this.setStatus(
        "Generating preview...",
        "Warping the image in the browser. This can take a while for larger images.",
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.invalidatePreview();
      this.previewCache = await this.buildWarpPreview();
      this.showPreviewOverlay();
      this.step = 3;
      this.editorSection.hidden = true;
      this.previewSection.hidden = false;
      this.previewMap.fitBounds(this.previewCache.bounds, { padding: [20, 20] });
      this.invalidateSizes();
      this.render();
      this.setStatus("Preview ready.", "Adjust opacity if needed, then download the KMZ.");
    } catch (error) {
      this.setStatus("Could not generate preview.", String(error), true);
    }
  }

  private showPreviewOverlay(): void {
    if (!this.previewCache) return;
    if (this.previewOverlay) this.previewMap.removeLayer(this.previewOverlay);
    this.previewOverlay = L.imageOverlay(this.previewCache.url, this.previewCache.bounds, {
      opacity: this.getOpacity() / 100,
    }).addTo(this.previewMap);
  }

  private getOpacity(): number {
    return Math.max(0, Math.min(100, Math.round(Number(this.opacityInput.value) || 0)));
  }

  private async buildWarpPreview(): Promise<WarpPreview> {
    const projection = this.makeLocalProjection(this.precisePairs.map((p) => p.map));
    const srcPts = this.precisePairs.map((p) => [p.image.x, p.image.y] as [number, number]);
    const dstPts = this.precisePairs.map((p) => projection.forward(p.map));
    const forwardX = this.createThinPlateSpline(
      srcPts,
      dstPts.map((p) => p[0]),
    );
    const forwardY = this.createThinPlateSpline(
      srcPts,
      dstPts.map((p) => p[1]),
    );

    const boundary = this.imageBoundaryPoints(this.imageWidth, this.imageHeight, 80).map(
      ([x, y]) => [forwardX.eval([x, y]), forwardY.eval([x, y])] as [number, number],
    );
    const xs = boundary.map((p) => p[0]);
    const ys = boundary.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    if (!(spanX > 0 && spanY > 0)) throw new Error("Invalid warped extent.");

    const metersPerPixel = this.estimateMetersPerPixel(srcPts, dstPts);
    let outW = Math.max(2, Math.ceil(spanX / metersPerPixel));
    let outH = Math.max(2, Math.ceil(spanY / metersPerPixel));
    const scale = Math.max(
      outW / MAX_OUTPUT_DIM,
      outH / MAX_OUTPUT_DIM,
      Math.sqrt((outW * outH) / MAX_OUTPUT_PIXELS),
      1,
    );
    outW = Math.max(2, Math.floor(outW / scale));
    outH = Math.max(2, Math.floor(outH / scale));

    const xsGrid = new Float64Array(outW);
    const ysGrid = new Float64Array(outH);
    for (let i = 0; i < outW; i++) xsGrid[i] = minX + (i / Math.max(1, outW - 1)) * spanX;
    for (let j = 0; j < outH; j++) ysGrid[j] = maxY - (j / Math.max(1, outH - 1)) * spanY;

    const outXY = Array.from<[number, number]>({ length: outW * outH });
    let k = 0;
    for (let j = 0; j < outH; j++) {
      for (let i = 0; i < outW; i++) outXY[k++] = [xsGrid[i], ysGrid[j]];
    }

    const inverseX = this.createThinPlateSpline(
      dstPts,
      srcPts.map((p) => p[0]),
    );
    const inverseY = this.createThinPlateSpline(
      dstPts,
      srcPts.map((p) => p[1]),
    );

    const sourceCtx = this.sourceCanvas!.getContext("2d", { willReadFrequently: true });
    if (!sourceCtx) throw new Error("Could not read source image.");
    const sourceData = sourceCtx.getImageData(0, 0, this.imageWidth, this.imageHeight);

    const outCanvas = document.createElement("canvas");
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext("2d");
    if (!outCtx) throw new Error("Could not create output canvas.");
    const imageData = outCtx.createImageData(outW, outH);
    const outData = imageData.data;

    for (let idx = 0; idx < outXY.length; idx++) {
      const [tx, ty] = outXY[idx];
      const sx = inverseX.eval([tx, ty]);
      const sy = inverseY.eval([tx, ty]);
      const rgba = this.sampleBilinear(sourceData.data, this.imageWidth, this.imageHeight, sx, sy);
      const base = idx * 4;
      outData[base] = rgba[0];
      outData[base + 1] = rgba[1];
      outData[base + 2] = rgba[2];
      outData[base + 3] = rgba[3];
    }

    outCtx.putImageData(imageData, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      outCanvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("Could not encode preview PNG."));
      }, "image/png");
    });

    const sw = projection.inverse([minX, minY]);
    const ne = projection.inverse([maxX, maxY]);
    const north = ne.lat;
    const south = sw.lat;
    const west = sw.lng;
    const east = ne.lng;

    return {
      blob,
      url: URL.createObjectURL(blob),
      bounds: [
        [south, west],
        [north, east],
      ],
      north,
      south,
      east,
      west,
    };
  }

  private async downloadKmz(): Promise<void> {
    if (!this.previewCache) {
      this.setStatus(
        "Generate a preview first.",
        "The preview image is also used for export.",
        true,
      );
      return;
    }
    try {
      const zip = new JSZip();
      zip.file("overlay.png", this.previewCache.blob);
      zip.file("doc.kml", this.buildKml());
      const blob = await zip.generateAsync({ type: "blob" });
      const name = `${this.safeName(this.overlayNameInput.value || "overlay")}.kmz`;
      this.downloadBlob(blob, name);
      this.setStatus("KMZ downloaded.", name);
    } catch (error) {
      this.setStatus("Could not create KMZ.", String(error), true);
    }
  }

  private buildKml(): string {
    if (!this.previewCache) throw new Error("Missing preview.");
    const alpha = Math.round((this.getOpacity() / 100) * 255)
      .toString(16)
      .padStart(2, "0");
    const name = this.escapeXml(this.overlayNameInput.value || "Image overlay");
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <GroundOverlay>
    <name>${name}</name>
    <color>${alpha}ffffff</color>
    <Icon><href>overlay.png</href></Icon>
    <LatLonBox>
      <north>${this.previewCache.north.toFixed(10)}</north>
      <south>${this.previewCache.south.toFixed(10)}</south>
      <east>${this.previewCache.east.toFixed(10)}</east>
      <west>${this.previewCache.west.toFixed(10)}</west>
    </LatLonBox>
  </GroundOverlay>
</kml>`;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private downloadBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  private safeName(value: string): string {
    const clean = value.replace(/[^A-Za-z0-9._ -]+/g, "_").trim();
    return clean || "overlay";
  }

  private makeLocalProjection(points: LatLng[]): Projection {
    const lat0 = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
    const lng0 = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
    const cosLat0 = Math.max(1e-9, Math.cos((lat0 * Math.PI) / 180));
    return {
      forward: (ll: LatLng): [number, number] => {
        const x = EARTH_RADIUS_M * (((ll.lng - lng0) * Math.PI) / 180) * cosLat0;
        const y = EARTH_RADIUS_M * (((ll.lat - lat0) * Math.PI) / 180);
        return [x, y];
      },
      inverse: (xy: [number, number]): LatLng => {
        const lng = lng0 + ((xy[0] / (EARTH_RADIUS_M * cosLat0)) * 180) / Math.PI;
        const lat = lat0 + ((xy[1] / EARTH_RADIUS_M) * 180) / Math.PI;
        return { lat, lng };
      },
    };
  }

  private computeHomography(src: [number, number][], dst: [number, number][]): number[][] {
    if (src.length !== 4 || dst.length !== 4) throw new Error("Homography requires 4 pairs.");
    const a: number[][] = [];
    const b: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i];
      const [u, v] = dst[i];
      a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
      b.push(u);
      a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
      b.push(v);
    }
    const h = this.solveLinearSystem(a, b);
    return [
      [h[0], h[1], h[2]],
      [h[3], h[4], h[5]],
      [h[6], h[7], 1],
    ];
  }

  private invert3x3(m: number[][]): number[][] {
    const [a, b, c] = m[0];
    const [d, e, f] = m[1];
    const [g, h, i] = m[2];
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const D = -(b * i - c * h);
    const E = a * i - c * g;
    const F = -(a * h - b * g);
    const G = b * f - c * e;
    const H = -(a * f - c * d);
    const I = a * e - b * d;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) throw new Error("Homography is singular.");
    return [
      [A / det, D / det, G / det],
      [B / det, E / det, H / det],
      [C / det, F / det, I / det],
    ];
  }

  private applyHomography(h: number[][], p: [number, number]): [number, number] {
    const [x, y] = p;
    const denom = h[2][0] * x + h[2][1] * y + h[2][2];
    if (Math.abs(denom) < 1e-12) return [x, y];
    const u = (h[0][0] * x + h[0][1] * y + h[0][2]) / denom;
    const v = (h[1][0] * x + h[1][1] * y + h[1][2]) / denom;
    return [u, v];
  }

  private solveLinearSystem(a: number[][], b: number[]): number[] {
    const n = a.length;
    const m = a.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
      }
      if (Math.abs(m[pivot][col]) < 1e-12) throw new Error("Control points are degenerate.");
      [m[col], m[pivot]] = [m[pivot], m[col]];
      const pivotVal = m[col][col];
      for (let j = col; j <= n; j++) m[col][j] /= pivotVal;
      for (let row = 0; row < n; row++) {
        if (row === col) continue;
        const factor = m[row][col];
        for (let j = col; j <= n; j++) m[row][j] -= factor * m[col][j];
      }
    }
    return m.map((row) => row[n]);
  }

  private createThinPlateSpline(
    points: [number, number][],
    values: number[],
  ): { eval: (p: [number, number]) => number } {
    const n = points.length;
    if (n < 3) throw new Error("Thin-plate spline requires at least 3 points.");
    const size = n + 3;
    const a: number[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
    const b = Array.from({ length: size }, () => 0);

    for (let i = 0; i < n; i++) {
      const [xi, yi] = points[i];
      for (let j = 0; j < n; j++) {
        const [xj, yj] = points[j];
        a[i][j] = this.tpsKernel((xi - xj) ** 2 + (yi - yj) ** 2);
      }
      a[i][n] = 1;
      a[i][n + 1] = xi;
      a[i][n + 2] = yi;
      b[i] = values[i];
    }
    for (let j = 0; j < n; j++) {
      const [xj, yj] = points[j];
      a[n][j] = 1;
      a[n + 1][j] = xj;
      a[n + 2][j] = yj;
    }

    const coeffs = this.solveLinearSystem(a, b);
    const weights = coeffs.slice(0, n);
    const affine = coeffs.slice(n);

    return {
      eval: (p: [number, number]) => {
        let value = affine[0] + affine[1] * p[0] + affine[2] * p[1];
        for (let i = 0; i < n; i++) {
          const dx = p[0] - points[i][0];
          const dy = p[1] - points[i][1];
          value += weights[i] * this.tpsKernel(dx * dx + dy * dy);
        }
        return value;
      },
    };
  }

  private tpsKernel(r2: number): number {
    if (r2 <= 1e-20) return 0;
    return 0.5 * r2 * Math.log(r2);
  }

  private imageBoundaryPoints(width: number, height: number, n: number): [number, number][] {
    const points: [number, number][] = [];
    for (let i = 0; i < n; i++) points.push([((width - 1) * i) / Math.max(1, n - 1), 0]);
    for (let i = 0; i < n; i++) points.push([width - 1, ((height - 1) * i) / Math.max(1, n - 1)]);
    for (let i = 0; i < n; i++)
      points.push([((width - 1) * (n - 1 - i)) / Math.max(1, n - 1), height - 1]);
    for (let i = 0; i < n; i++) points.push([0, ((height - 1) * (n - 1 - i)) / Math.max(1, n - 1)]);
    return points;
  }

  private estimateMetersPerPixel(src: [number, number][], dst: [number, number][]): number {
    const ratios: number[] = [];
    for (let i = 0; i < src.length; i++) {
      for (let j = i + 1; j < src.length; j++) {
        const dp = Math.hypot(src[i][0] - src[j][0], src[i][1] - src[j][1]);
        const dm = Math.hypot(dst[i][0] - dst[j][0], dst[i][1] - dst[j][1]);
        if (dp > 3 && dm > 0.01) ratios.push(dm / dp);
      }
    }
    if (!ratios.length) return 1;
    ratios.sort((a, b) => a - b);
    return Math.max(1e-4, ratios[Math.floor(ratios.length / 2)]);
  }

  private sampleBilinear(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    x: number,
    y: number,
  ): [number, number, number, number] {
    if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return [0, 0, 0, 0];
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const dx = x - x0;
    const dy = y - y0;

    const c00 = this.pixelAt(data, width, x0, y0);
    const c10 = this.pixelAt(data, width, x1, y0);
    const c01 = this.pixelAt(data, width, x0, y1);
    const c11 = this.pixelAt(data, width, x1, y1);
    const out: [number, number, number, number] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const top = c00[i] * (1 - dx) + c10[i] * dx;
      const bottom = c01[i] * (1 - dx) + c11[i] * dx;
      out[i] = Math.max(0, Math.min(255, Math.round(top * (1 - dy) + bottom * dy)));
    }
    return out;
  }

  private pixelAt(
    data: Uint8ClampedArray,
    width: number,
    x: number,
    y: number,
  ): [number, number, number, number] {
    const idx = (y * width + x) * 4;
    return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
  }

  private async importKmz(file: File): Promise<{ canvas: HTMLCanvasElement; info: ImportInfo }> {
    const zip = await JSZip.loadAsync(file);
    const kmlNames = Object.keys(zip.files).filter((name: string) =>
      name.toLowerCase().endsWith(".kml"),
    );
    if (!kmlNames.length) throw new Error("KMZ does not contain a KML file.");
    const kmlText = await zip.file(kmlNames[0])!.async("string");
    const doc = new DOMParser().parseFromString(kmlText, "application/xml");
    const overlay = doc.querySelector("GroundOverlay");
    if (!overlay) throw new Error("No GroundOverlay found in KMZ.");

    const name =
      overlay.querySelector("name")?.textContent?.trim() || file.name.replace(/\.kmz$/i, "");
    const opacity = this.parseKmlOpacity(
      overlay.querySelector("color")?.textContent?.trim() || "ffffffff",
    );
    const href = overlay.querySelector("Icon > href")?.textContent?.trim();
    if (!href) throw new Error("GroundOverlay image href not found.");

    const imageFile = this.resolveZipFile(zip, href);
    if (!imageFile) throw new Error(`Overlay image not found in KMZ: ${href}`);
    const imageBlob = await imageFile.async("blob");
    const canvas = await this.fileToCanvas(imageBlob);

    const corners = this.parseOverlayCorners(overlay, canvas.width, canvas.height);
    const roughPairs = corners.map((pair, idx) => ({
      id: idx + 1,
      image: pair.image,
      map: pair.map,
    }));

    return { canvas, info: { name, opacity, roughPairs } };
  }

  private resolveZipFile(zip: any, href: string): any | null {
    if (zip.file(href)) return zip.file(href);
    const cleaned = href.replace(/^\.\//, "");
    if (zip.file(cleaned)) return zip.file(cleaned);
    const nameOnly = cleaned.split("/").pop();
    if (!nameOnly) return null;
    const match = Object.keys(zip.files).find((key) => key.split("/").pop() === nameOnly);
    return match ? zip.file(match) : null;
  }

  private parseKmlOpacity(color: string): number {
    const clean = color.trim().replace(/^#/, "");
    if (!/^[0-9a-fA-F]{8}$/.test(clean)) return 85;
    const alpha = parseInt(clean.slice(0, 2), 16);
    return Math.round((alpha / 255) * 100);
  }

  private parseOverlayCorners(
    overlay: Element,
    width: number,
    height: number,
  ): { image: ImagePoint; map: LatLng }[] {
    const quad = overlay.querySelector("gx\\:LatLonQuad, LatLonQuad");
    if (quad) {
      const text = quad.querySelector("coordinates")?.textContent?.trim() || "";
      const coords = text
        .split(/\s+/)
        .map((part) => part.split(","))
        .filter((parts) => parts.length >= 2)
        .map((parts) => ({ lng: Number(parts[0]), lat: Number(parts[1]) }));
      if (coords.length >= 4) {
        return [
          { image: { x: 0, y: height - 1 }, map: { lat: coords[0].lat, lng: coords[0].lng } },
          {
            image: { x: width - 1, y: height - 1 },
            map: { lat: coords[1].lat, lng: coords[1].lng },
          },
          { image: { x: width - 1, y: 0 }, map: { lat: coords[2].lat, lng: coords[2].lng } },
          { image: { x: 0, y: 0 }, map: { lat: coords[3].lat, lng: coords[3].lng } },
        ];
      }
    }

    const box = overlay.querySelector("LatLonBox");
    if (!box) throw new Error("Supported imported overlay types: LatLonBox and gx:LatLonQuad.");
    const north = Number(box.querySelector("north")?.textContent);
    const south = Number(box.querySelector("south")?.textContent);
    const east = Number(box.querySelector("east")?.textContent);
    const west = Number(box.querySelector("west")?.textContent);
    const rotation = Number(box.querySelector("rotation")?.textContent || "0");
    if (![north, south, east, west].every(Number.isFinite))
      throw new Error("Invalid LatLonBox coordinates.");

    const baseCorners = [
      { lat: south, lng: west },
      { lat: south, lng: east },
      { lat: north, lng: east },
      { lat: north, lng: west },
    ];
    const rotated =
      Math.abs(rotation) > 1e-12 ? this.rotateLatLonBox(baseCorners, rotation) : baseCorners;
    return [
      { image: { x: 0, y: height - 1 }, map: rotated[0] },
      { image: { x: width - 1, y: height - 1 }, map: rotated[1] },
      { image: { x: width - 1, y: 0 }, map: rotated[2] },
      { image: { x: 0, y: 0 }, map: rotated[3] },
    ];
  }

  private rotateLatLonBox(corners: LatLng[], rotationDeg: number): LatLng[] {
    const center = {
      lat: corners.reduce((sum, p) => sum + p.lat, 0) / corners.length,
      lng: corners.reduce((sum, p) => sum + p.lng, 0) / corners.length,
    };
    const projection = this.makeLocalProjection([center, center, center, center]);
    const centerXY = projection.forward(center);
    const angle = (rotationDeg * Math.PI) / 180;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return corners.map((corner) => {
      const xy = projection.forward(corner);
      const dx = xy[0] - centerXY[0];
      const dy = xy[1] - centerXY[1];
      const rx = centerXY[0] + dx * cosA - dy * sinA;
      const ry = centerXY[1] + dx * sinA + dy * cosA;
      return projection.inverse([rx, ry]);
    });
  }
}
