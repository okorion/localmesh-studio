import { Download, Redo2, Undo2 } from "lucide-react";
import type { Collaborator, CollaborationStatus } from "@/features/collaboration/connect-scene-session";

type TopBarProps = {
  collaborators: Collaborator[];
  collaborationStatus: CollaborationStatus;
  rendererName: string;
  historyDisabled: boolean;
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

function getCollaboratorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
  }
  const first = Array.from(parts[0])[0] ?? "";
  const last = Array.from(parts.at(-1) ?? "")[0] ?? "";
  return `${first}${last}`.toUpperCase();
}

export function TopBar({
  collaborators,
  collaborationStatus,
  rendererName,
  historyDisabled,
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
        <button
          className="icon-button"
          type="button"
          onClick={onUndo}
          aria-label="실행 취소"
          aria-keyshortcuts={historyDisabled ? undefined : "Control+Z Meta+Z"}
          disabled={historyDisabled}
          title="실행 취소 (Ctrl/⌘+Z)"
        >
          <Undo2 size={17} />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={onRedo}
          aria-label="다시 실행"
          aria-keyshortcuts={
            historyDisabled
              ? undefined
              : "Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y"
          }
          disabled={historyDisabled}
          title="다시 실행 (Ctrl/⌘+Shift+Z 또는 Ctrl/⌘+Y)"
        >
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
                {getCollaboratorInitials(collaborator.name)}
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
