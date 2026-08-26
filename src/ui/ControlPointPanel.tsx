type PointKind = "rough" | "precise";
type Props = { kind: PointKind; title: string; description: string };

const config = {
  rough: {
    panelId: "roughPanel",
    tableId: "roughTableBody",
    undoId: "undoRoughBtn",
    clearId: "clearRoughBtn",
    undoLabel: "Undo rough pair",
    clearLabel: "Clear rough points",
  },
  precise: {
    panelId: "precisePanel",
    tableId: "preciseTableBody",
    undoId: "undoPreciseBtn",
    clearId: "clearPreciseBtn",
    undoLabel: "Undo precise pair",
    clearLabel: "Clear precise points",
  },
} as const;

export function ControlPointPanel({ kind, title, description }: Props) {
  const ids = config[kind];
  return (
    <section className="card panel" id={ids.panelId}>
      <div className="panel-header">
        <h3>{title}</h3>
        <div className="actions compact">
          {kind === "rough" ? (
            <button id="finishRoughBtn" type="button" disabled>
              Finish rough alignment
            </button>
          ) : (
            <>
              <button id="backToRoughBtn" type="button">
                Edit rough alignment
              </button>
              <button id="previewBtn" type="button" disabled>
                Generate preview
              </button>
            </>
          )}
        </div>
      </div>
      <p className="muted">{description}</p>
      <div className="point-actions">
        <button id={ids.undoId} type="button" disabled>
          {ids.undoLabel}
        </button>
        <button id={ids.clearId} type="button" disabled>
          {ids.clearLabel}
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>x</th>
              <th>y</th>
              <th>lat</th>
              <th>lon</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody id={ids.tableId} />
        </table>
      </div>
    </section>
  );
}
