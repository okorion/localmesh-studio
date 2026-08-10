# Architecture

## 한 문장 구조

사용자와 AI가 `SceneCommand`를 만들고, `SceneDocument`가 Yjs 문서에 적용하면, Three.js 화면과 로컬 Hocuspocus 서버의 같은 룸에 연결된 클라이언트가 같은 변경을 구독합니다.

```text
User UI ─┐
         ├─> SceneCommand ─> SceneDocument(Y.Doc) ─┬─> Three.js renderer
Local AI ┘                                         ├─> IndexedDB
                                                   └─> Hocuspocus WebSocket
```

> 이 문서는 현재 구현된 로컬 협업 경로를 설명합니다. 공개 데모에는 협업 소켓이 연결되지 않으며, 인증·룸 접근 제어·서버 영속 저장을 포함한 운영용 협업 아키텍처는 아직 범위 밖입니다.

## 데이터 소유권

- Yjs `SceneDocument`: 저장하고 공유해야 하는 오브젝트 데이터의 유일한 원본
- React 상태: 선택, 패널 열림처럼 저장할 필요가 없는 화면 상태
- Three.js `Scene`: Yjs 데이터를 그리기 위해 파생된 런타임 표현
- Hocuspocus 서버: 로컬 개발 환경에서 Yjs 업데이트를 전달하는 소켓 경계

Three.js Mesh를 직접 저장하거나 React 상태와 Yjs 상태를 양방향 복제하지 않습니다. 이 규칙이 데이터 불일치와 수정 위치의 모호함을 막습니다.

### Transform 동시 편집

외부 `SceneObject` 스키마와 JSON 내보내기는 `position`, `rotation`, `scale`을 3개 값의 tuple로 유지합니다. Yjs 내부에서는 기존 tuple을 기준값으로 두고 실제로 변경된 X/Y/Z 성분만 `position.x`와 같은 독립 키에 기록합니다. 따라서 두 클라이언트가 서로 다른 축을 동시에 바꿔도 한쪽 변경이 다른 축을 덮지 않으며, 한 사용자의 Undo가 다른 사용자의 축 변경이나 오브젝트 필수 필드를 제거하지 않습니다.

기즈모 드래그 중 수신한 최신 문서 값은 로컬에서 바꾼 축과 mouseup 시점에 병합합니다. 같은 축을 동시에 편집한 경우에는 마지막으로 기록된 값이 적용되고, 한 번의 드래그는 여전히 한 개의 `SceneCommand`와 Undo 단계입니다.

## 기능 경계

`features/`는 기술 계층이 아니라 변경 이유별로 나뉩니다. 예를 들어 오브젝트 필드를 추가할 때는 `features/scene`부터 보고, AI 공급자를 추가할 때는 `features/ai`만 보면 됩니다. 공통화는 실제 두 번째 사용처가 생긴 뒤에만 수행합니다.

## 로컬 우선 동작

1. `y-indexeddb`가 브라우저의 장면을 복구합니다.
2. 소켓 URL이 있으면 HocuspocusProvider가 같은 Y.Doc을 서버와 동기화합니다.
3. 연결이 끊겨도 로컬 편집은 계속되고 재연결 시 Yjs가 병합합니다.
4. WebLLM은 Web Worker에서 실행되며 모델과 프롬프트가 브라우저 밖으로 나가지 않습니다.

## 확장 규칙

- 새 오브젝트 속성: `features/scene/schema.ts`와 렌더/Inspector만 수정
- 새 명령: `features/scene/commands.ts`와 `SceneDocument.apply` 수정
- 새 AI 공급자: `SceneAiProvider`를 구현하고 공급자 선택 UI에 등록
- 새 협업 저장소: Hocuspocus 서버 extension으로 추가하고 클라이언트는 수정하지 않음
- 새 프리미티브: schema, geometry factory, 생성 UI 세 곳을 수정
