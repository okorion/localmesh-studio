import { Combine, LoaderCircle, ScanSearch, Split } from "lucide-react";
import type { CsgOperation } from "@/features/scene/csg";
import type { SceneObject } from "@/features/scene/schema";

export type CsgStatus = {
  id: number;
  tone: "working" | "success" | "error";
  message: string;
};

type CsgPanelProps = {
  objects: SceneObject[];
  primaryId: string | null;
  secondaryId: string | null;
  isProcessing: boolean;
  isTransforming: boolean;
  status: CsgStatus | null;
  onSecondaryChange: (objectId: string | null) => void;
  onRun: (operation: CsgOperation) => void;
};

const OPERATIONS = [
  { operation: "union", label: "합집합", formula: "A ∪ B", icon: Combine },
  { operation: "subtract", label: "차집합", formula: "A − B", icon: Split },
  { operation: "intersect", label: "교집합", formula: "A ∩ B", icon: ScanSearch },
] satisfies Array<{
  operation: CsgOperation;
  label: string;
  formula: string;
  icon: typeof Combine;
}>;

function getDisabledReason(
  primary: SceneObject | null,
  secondary: SceneObject | null,
  isProcessing: boolean,
  isTransforming: boolean,
): string | null {
  if (isProcessing) return "CSG 결과를 계산하고 있습니다.";
  if (isTransforming) return "트랜스폼 조작을 마친 뒤 CSG를 실행하세요.";
  if (!primary) return "장면이나 뷰포트에서 A 오브젝트를 먼저 선택하세요.";
  if (!secondary) return "A와 다른 B 오브젝트를 선택하세요.";
  if (primary.id === secondary.id) return "A와 B는 서로 다른 오브젝트여야 합니다.";
  return null;
}

export function CsgPanel({
  objects,
  primaryId,
  secondaryId,
  isProcessing,
  isTransforming,
  status,
  onSecondaryChange,
  onRun,
}: CsgPanelProps) {
  const primary = objects.find((object) => object.id === primaryId) ?? null;
  const secondary =
    objects.find((object) => object.id === secondaryId) ?? null;
  const secondaryOptions = primary
    ? objects.filter((object) => object.id !== primary.id)
    : [];
  const disabledReason = getDisabledReason(
    primary,
    secondary,
    isProcessing,
    isTransforming,
  );
  const statusId = "csg-status";
  const guidanceId = "csg-guidance";

  return (
    <section
      className="csg-panel"
      aria-labelledby="csg-heading"
      aria-busy={isProcessing}
    >
      <div className="csg-heading">
        <div>
          <span className="eyebrow">BOOLEAN</span>
          <h2 id="csg-heading">CSG 연산</h2>
        </div>
        {isProcessing ? (
          <LoaderCircle className="csg-spinner" size={16} aria-hidden="true" />
        ) : null}
      </div>

      <div className="csg-operands" aria-label="CSG 피연산자 순서">
        <div className="csg-operand csg-operand-primary">
          <span className="csg-operand-letter">A</span>
          <div>
            <small>주 선택 · 변형 기준</small>
            <strong title={primary?.name}>
              {primary?.name ?? "선택되지 않음"}
            </strong>
          </div>
        </div>
        <label className="csg-operand csg-operand-secondary">
          <span className="csg-operand-letter">B</span>
          <span className="csg-operand-select">
            <small>보조 피연산자</small>
            <select
              data-csg-secondary-select
              value={secondary?.id ?? ""}
              disabled={!primary || secondaryOptions.length === 0 || isProcessing}
              aria-describedby={`${guidanceId} ${status ? statusId : ""}`.trim()}
              onChange={(event) =>
                onSecondaryChange(event.target.value || null)
              }
            >
              <option value="">B 오브젝트 선택</option>
              {secondaryOptions.map((object) => (
                <option key={object.id} value={object.id}>
                  {object.name} ({object.kind})
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      <div className="csg-actions" role="group" aria-label="CSG 불리언 연산">
        {OPERATIONS.map(({ operation, label, formula, icon: Icon }) => (
          <button
            key={operation}
            type="button"
            data-csg-operation={operation}
            disabled={disabledReason !== null}
            title={disabledReason ?? `${label} (${formula}) 실행`}
            aria-describedby={`${guidanceId} ${status ? statusId : ""}`.trim()}
            onClick={() => onRun(operation)}
          >
            <Icon size={14} aria-hidden="true" />
            <span>{label}</span>
            <small aria-hidden="true">{formula}</small>
          </button>
        ))}
      </div>

      <p id={guidanceId} className="csg-guidance">
        {disabledReason ?? "실행하면 A와 B가 결과 오브젝트 하나로 교체됩니다."}
      </p>
      <p
        id={statusId}
        data-csg-status={status?.tone ?? "idle"}
        className={`csg-status ${status ? `is-${status.tone}` : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {status ? <span key={status.id}>{status.message}</span> : null}
      </p>
    </section>
  );
}
