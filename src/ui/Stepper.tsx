const STEPS = ["Rough alignment", "Precise control points", "Preview & export"];

export function Stepper() {
  return (
    <section className="stepper card" aria-label="Workflow progress">
      {STEPS.map((label, index) => (
        <div className="step" id={`stepChip${index + 1}`} key={label}>
          {index + 1}. {label}
        </div>
      ))}
    </section>
  );
}
