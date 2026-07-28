# LocalMesh Studio

로컬 우선 실시간 협업 3D 편집기입니다. Three.js WebGPU 렌더러, Yjs 문서, Hocuspocus WebSocket, 브라우저 WebLLM을 한 개의 명확한 명령 흐름으로 연결합니다.

## 빠른 시작

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

`npm run dev`는 웹 앱과 협업 소켓 서버를 함께 실행합니다.

- 웹 편집기: `http://localhost:3000`
- 협업 WebSocket: `ws://localhost:1234`

## 코드 위치

| 변경하려는 것 | 고칠 위치 |
| --- | --- |
| 페이지 조립과 메타데이터 | `app/` |
| 편집기 화면과 사용자 입력 | `components/editor/` |
| 장면 데이터 구조와 명령 | `features/scene/` |
| Yjs 로컬 저장·WebSocket 연결 | `features/collaboration/` |
| 로컬 LLM 모델과 AI 명령 변환 | `features/ai/` |
| Hocuspocus 소켓 서버 | `services/collaboration-server/` |
| 배포 어댑터 | `worker/`, `.openai/` |

장면을 바꾸는 모든 경로는 `SceneCommand`를 거칩니다. UI, 로컬 AI, 원격 협업마다 별도 편집 로직을 만들지 않습니다.

## 검증

```bash
npm run typecheck
npm run lint
npm run build
```

자세한 구조와 아직 선택할 결정은 [`docs/architecture.md`](docs/architecture.md), [`docs/decisions.md`](docs/decisions.md)를 참고하세요.
