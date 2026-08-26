export function Toolbar() {
  return (
    <section className="toolbar card" aria-label="Source and overlay settings">
      <div className="field-group">
        <label>
          Source PDF / JPG / PNG
          <input
            id="sourceInput"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          />
        </label>
        <label>
          Import existing KMZ
          <input id="kmzInput" type="file" accept=".kmz,application/vnd.google-earth.kmz" />
        </label>
      </div>
      <div className="field-group">
        <label>
          Overlay name
          <input id="overlayName" type="text" defaultValue="Image overlay" />
        </label>
        <label>
          Preview / export opacity %
          <input id="opacityInput" type="number" min="0" max="100" step="1" defaultValue="85" />
        </label>
        <label>
          Max output dimension (px)
          <input
            id="outputDimensionInput"
            type="number"
            min="2"
            step="1"
            placeholder="Auto (source resolution)"
            aria-describedby="outputResolutionHint"
          />
          <span id="outputResolutionHint" className="field-hint">
            Auto uses the source resolution.
          </span>
        </label>
      </div>
      <div className="actions">
        <button id="resetAllBtn" type="button">
          Reset
        </button>
      </div>
    </section>
  );
}
