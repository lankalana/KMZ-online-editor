type Props = {
  title: string;
  mapId: "imageMap" | "realMap" | "previewMap";
  preview?: boolean;
};

export function MapPane({ title, mapId, preview = false }: Props) {
  return (
    <section className="card pane">
      <h2>{title}</h2>
      <div id={mapId} className={`map${preview ? " preview-map" : ""}`} aria-label={title} />
    </section>
  );
}
