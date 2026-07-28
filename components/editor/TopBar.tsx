import { Download, Redo2, Undo2 } from "lucide-react";
import type { Collaborator, CollaborationStatus } from "@/features/collaboration/connect-scene-session";

type TopBarProps = {
  collaborators: Collaborator[];
  collaborationStatus: CollaborationStatus;
  rendererName: string;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
};

const STATUS_LABEL: Record<CollaborationStatus, string> = {
  local: "로컬 전용",
  connecting: "연결 중",
  connected: "실시간 연결됨",
  disconnected: "연결 끊김",
};

export function TopBar({
  collaborators,
  collaborationStatus,
  rendererName,
  onUndo,
  onRedo,
  onExport,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          L
        </span>
        <div>
          <strong>LocalMesh</strong>
          <span>Untitled scene</span>
        </div>
      </div>
      <div className="toolbar" aria-label="편집 도구">
        <button className="icon-button" type="button" onClick={onUndo} aria-label="실행 취소">
          <Undo2 size={17} />
        </button>
        <button className="icon-button" type="button" onClick={onRedo} aria-label="다시 실행">
          <Redo2 size={17} />
        </button>
      </div>
      <div className="topbar-status">
        <span className="renderer-badge">{rendererName}</span>
        <div className="presence" aria-label={`${collaborators.length}명 접속 중`}>
          <div className="avatar-stack">
            {collaborators.slice(0, 3).map((collaborator) => (
              <span
                className="avatar"
                key={collaborator.clientId}
                style={{ backgroundColor: collaborator.color }}
                title={collaborator.name}
              >
                {collaborator.name.at(-2)}
              </span>
            ))}
          </div>
          <span className={`connection-dot is-${collaborationStatus}`} />
          <span>{STATUS_LABEL[collaborationStatus]}</span>
        </div>
        <button className="primary-button" type="button" onClick={onExport}>
          <Download size={16} />
          JSON 내보내기
        </button>
      </div>
    </header>
  );
}
