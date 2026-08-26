import { useEffect } from "react";
import { GeoreferenceController } from "../app";
import { ControlPointPanel } from "./ControlPointPanel";
import { MapPane } from "./MapPane";
import { Stepper } from "./Stepper";
import { Toolbar } from "./Toolbar";

export function Application() {
  useEffect(() => {
    // Leaflet stays behind an imperative adapter so React does not recreate
    // map instances when ordinary form or point state changes.
    new GeoreferenceController();
  }, []);

  return (
    <>
      <header>
        <h1>KMZ Control Point Tool</h1>
        <p>Browser-only georeferencing and KMZ export.</p>
      </header>
      <main>
        <Toolbar />
        <Stepper />
        <Editor />
        <Preview />
        <Status />
      </main>
    </>
  );
}

function Editor() {
  return (
    <section id="editorSection">
      <div className="grid-two">
        <MapPane title="Image view" mapId="imageMap" />
        <MapPane title="Terrain map" mapId="realMap" />
      </div>
      <div className="grid-two lower-panels">
        <ControlPointPanel
          kind="rough"
          title="Step 1: Rough alignment"
          description="Add exactly 4 rough point pairs. After that the image and map pan/zoom together. Imported KMZs prefill these points from overlay corners."
        />
        <ControlPointPanel
          kind="precise"
          title="Step 2: Precise control points"
          description="Add at least 5 precise point pairs. Existing points can be dragged on either map or deleted from the table."
        />
      </div>
    </section>
  );
}

function Preview() {
  return (
    <section id="previewSection" hidden>
      <section className="card preview-controls">
        <div className="panel-header">
          <h3>Step 3: Preview overlay</h3>
          <div className="actions compact">
            <button id="backToPreciseBtn" type="button">
              Back to precise points
            </button>
            <button id="regeneratePreviewBtn" type="button">
              Regenerate preview
            </button>
            <button id="downloadKmzBtn" type="button">
              Download KMZ
            </button>
          </div>
        </div>
        <div className="preview-toolbar">
          <label>
            Opacity %
            <input id="previewOpacity" type="range" min="0" max="100" step="1" defaultValue="85" />
          </label>
          <span id="previewOpacityValue">85%</span>
        </div>
      </section>
      <MapPane title="Preview map" mapId="previewMap" preview />
    </section>
  );
}

function Status() {
  return (
    <section className="card status-card" aria-live="polite">
      <strong>Status</strong>
      <div id="statusText">Load a source image/PDF or import a KMZ.</div>
      <div id="statusDetail" className="muted" />
    </section>
  );
}
