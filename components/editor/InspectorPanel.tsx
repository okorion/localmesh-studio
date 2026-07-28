import type { SceneCommand } from "@/features/scene/commands";
import type { SceneObject, Vector3Tuple } from "@/features/scene/schema";

type InspectorPanelProps = {
  object: SceneObject | null;
  onCommand: (command: SceneCommand) => void;
};

type VectorFieldProps = {
  label: string;
  value: Vector3Tuple;
  step: number;
  onChange: (value: Vector3Tuple) => void;
};

const AXES = ["X", "Y", "Z"] as const;

function VectorField({ label, value, step, onChange }: VectorFieldProps) {
  return (
    <fieldset className="vector-field">
      <legend>{label}</legend>
      <div className="axis-inputs">
        {AXES.map((axis, index) => (
          <label key={axis}>
            <span className={`axis axis-${axis.toLowerCase()}`}>{axis}</span>
            <input
              type="number"
              step={step}
              value={Number(value[index].toFixed(2))}
              onChange={(event) => {
                const next = [...value] as Vector3Tuple;
                next[index] = Number(event.target.value);
                if (Number.isFinite(next[index])) onChange(next);
              }}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function InspectorPanel({ object, onCommand }: InspectorPanelProps) {
  if (!object) {
    return (
      <aside className="side-panel inspector-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">INSPECTOR</span>
            <h2>속성</h2>
          </div>
        </div>
        <p className="empty-state">오브젝트를 선택하면 속성을 편집할 수 있습니다.</p>
      </aside>
    );
  }

  const update = (updates: Extract<SceneCommand, { type: "object.update" }>['updates']) => {
    onCommand({ type: "object.update", objectId: object.id, updates });
  };

  const rotationDegrees = object.rotation.map(
    (radians) => (radians * 180) / Math.PI,
  ) as Vector3Tuple;

  return (
    <aside className="side-panel inspector-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">INSPECTOR</span>
          <h2>속성</h2>
        </div>
        <span className="kind-badge">{object.kind}</span>
      </div>
      <section className="property-section">
        <h3>일반</h3>
        <label className="property-row">
          <span>이름</span>
          <input
            key={`${object.id}:${object.name}`}
            defaultValue={object.name}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name && name !== object.name) update({ name });
              else event.target.value = object.name;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
        <label className="property-row">
          <span>색상</span>
          <div className="color-control">
            <input
              className="color-picker"
              type="color"
              value={object.color}
              onChange={(event) => update({ color: event.target.value })}
              aria-label="오브젝트 색상"
            />
            <code>{object.color.toUpperCase()}</code>
          </div>
        </label>
      </section>
      <section className="property-section">
        <h3>Transform</h3>
        <VectorField
          label="Position"
          value={object.position}
          step={0.1}
          onChange={(position) => update({ position })}
        />
        <VectorField
          label="Rotation"
          value={rotationDegrees}
          step={1}
          onChange={(degrees) =>
            update({
              rotation: degrees.map((value) => (value * Math.PI) / 180) as Vector3Tuple,
            })
          }
        />
        <VectorField
          label="Scale"
          value={object.scale}
          step={0.1}
          onChange={(scale) => update({ scale })}
        />
      </section>
      <section className="property-section metadata-section">
        <h3>문서 정보</h3>
        <dl>
          <div><dt>Object ID</dt><dd>{object.id}</dd></div>
          <div><dt>Source</dt><dd>Y.Map</dd></div>
        </dl>
      </section>
    </aside>
  );
}
