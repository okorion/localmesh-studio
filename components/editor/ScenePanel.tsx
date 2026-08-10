import { Box, Circle, Cylinder, Trash2 } from "lucide-react";
import type { PrimitiveKind, SceneObject } from "@/features/scene/schema";

type ScenePanelProps = {
  objects: SceneObject[];
  selectedId: string | null;
  announcement: { id: number; message: string } | null;
  deleteDisabled: boolean;
  onSelect: (objectId: string | null) => void;
  onAdd: (kind: PrimitiveKind) => void;
  onDelete: (objectId: string) => void;
};

const PRIMITIVES = [
  { kind: "box", label: "Cube", icon: Box },
  { kind: "sphere", label: "Sphere", icon: Circle },
  { kind: "cylinder", label: "Cylinder", icon: Cylinder },
] satisfies Array<{ kind: PrimitiveKind; label: string; icon: typeof Box }>;

export function ScenePanel({
  objects,
  selectedId,
  announcement,
  deleteDisabled,
  onSelect,
  onAdd,
  onDelete,
}: ScenePanelProps) {
  return (
    <aside className="side-panel scene-panel">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement ? <span key={announcement.id}>{announcement.message}</span> : null}
      </p>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SCENE</span>
          <h1>오브젝트</h1>
        </div>
        <span className="count-badge">{objects.length}</span>
      </div>
      <div className="primitive-grid" aria-label="프리미티브 추가">
        {PRIMITIVES.map(({ kind, label, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            data-add-primitive={kind}
            onClick={() => onAdd(kind)}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="scene-tree" role="tree" aria-label="장면 오브젝트 목록">
        {objects.length === 0 ? (
          <p className="empty-state">위 버튼으로 첫 오브젝트를 추가하세요.</p>
        ) : (
          objects.map((object) => (
            <div
              className={`tree-row ${selectedId === object.id ? "is-selected" : ""}`}
              key={object.id}
              role="treeitem"
              aria-selected={selectedId === object.id}
              data-scene-object-row={object.id}
            >
              <button
                className="tree-select"
                type="button"
                aria-pressed={selectedId === object.id}
                data-scene-object-select={object.id}
                onClick={() => onSelect(selectedId === object.id ? null : object.id)}
              >
                <span className="object-color" style={{ backgroundColor: object.color }} />
                <span>{object.name}</span>
                <small>{object.kind}</small>
              </button>
              <button
                className="tree-delete"
                type="button"
                onClick={() => onDelete(object.id)}
                aria-label={`${object.name} 삭제`}
                disabled={deleteDisabled}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))
        )}
      </div>
      <div className="panel-note">
        <span className="note-dot" />
        변경은 Yjs 문서에 바로 기록됩니다.
      </div>
    </aside>
  );
}
