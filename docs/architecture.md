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

### CSG 결과 데이터

CSG 입력 A는 일반 오브젝트 선택으로 정하고 B는 CSG UI에서 별도로 명시합니다. 합집합(A ∪ B), 차집합(A − B), 교집합(A ∩ B) 계산이 성공하면 결과 `BufferGeometry`를 `kind: "mesh"`인 custom `SceneObject`의 로컬 좌표로 bake합니다. Yjs와 LocalMesh JSON v2에는 렌더링과 후속 CSG에 필요한 `geometry.positions`, `geometry.normals`, `geometry.operation`, `geometry.topology`를 저장하며, Three.js `BufferGeometry` 인스턴스 자체는 저장하지 않습니다. 현재 topology 표식은 앱이 생성한 CSG 엔진 결과임을 나타내는 `csg-engine-output-v1`입니다.

두 입력 삭제와 결과 생성은 하나의 Yjs transaction으로 적용합니다. 따라서 관찰자는 중간 상태를 보지 않고, 사용자는 한 번의 Undo/Redo로 두 원본과 결과를 전환합니다. 계산 직후 macrotask를 한 번 양보해 이미 대기 중인 Yjs 업데이트를 반영하고 operand signature를 다시 검사합니다. 빈 geometry, 비유한 좌표·법선, topology·삼각형 예산 초과, 라이브러리 예외, 계산 중 입력 변경 또는 다른 실시간 협업자 연결은 transaction 전에 실패시키므로 원본 A와 B를 보존합니다. 성공한 custom mesh는 프리미티브와 같은 Transform 경로를 쓰며 다음 CSG의 입력으로 다시 bake할 수 있습니다.

연산·서로 다른 두 오브젝트·0.01 이상 100 이하의 양의 유한 scale·position/normal attribute·index·전체 draw range·유한한 attribute 값·입력별 20,000개 삼각형 예산을 먼저 검증합니다. 프리미티브 입력은 position을 tolerance 기반으로 weld한 뒤 퇴화 삼각형이 없고 모든 방향 없는 edge가 반대 방향으로 정확히 두 번 쓰이며 비영 signed volume을 갖는지 엄격히 검사합니다. `csg-engine-output-v1` 표식이 있는 baked mesh 입력과 엔진 출력은 최소 네 면·유효 면적·bbox 중심 compensated signed volume을 확인하고, triangle-safe seam welding과 공간 grid 기반 T-junction 분할 뒤 가장 긴 불균형 edge 또는 연결된 불균형-edge 성분의 3D bbox span이 전체 bounding-box 최대 extent의 75%를 넘으면 거부합니다. 75% 기준은 ordered primitive·회전·비균일 scale·연쇄 CSG matrix의 측정 최댓값 70.1%와 coarse/subdivided missing-face cube의 100%를 분리합니다. 후보 탐색은 grid visit 100만 회와 vertex candidate 500만 회에서 중단합니다. 검증을 통과한 뒤에만 `three-bvh-csg`를 dynamic import해 초기 편집기 번들 비용을 분리합니다. 활성 draw range의 index만 순회해 non-indexed 배열로 bake하고, 출력은 20,000개 삼각형, 즉 positions와 normals 각각 180,000개 scalar를 넘지 않아야 합니다.

프리미티브 입력은 닫힌 two-manifold라는 라이브러리 전제를 엄격히 확인합니다. 앱이 생성한 baked mesh와 출력의 edge·부피 sanity check는 큰 열린 면과 명백한 zero-volume 결과를 차단하지만, 75% 기준 이하의 열린 경계나 수치 seam을 완전한 manifold로 증명하거나 자기 교차를 판정하는 CAD validator는 아닙니다. 라이브러리도 실험 단계이므로 부동소수점 수치 오차와 코너 케이스까지 보장하지 않습니다.

UI는 awareness에 다른 실시간 협업자가 있으면 파괴형 CSG를 비활성화합니다. 하지만 아직 도착하지 않은 오프라인 업데이트나 awareness가 보이지 않는 동시 실행에는 분산 lock이 없습니다. 이런 transaction이 나중에 병합되면 서로 다른 ID의 baked 결과가 모두 남을 수 있고, 한쪽 Undo 뒤 A/B 원본과 상대 결과가 함께 존재할 수 있습니다. 또한 v2 custom mesh를 공유하는 모든 클라이언트가 동일한 v2 스키마를 사용해야 하며 구 v1 클라이언트는 해당 객체를 snapshot에서 제외합니다. 운영 협업에는 schema handshake와 shared operation record/lock이 후속으로 필요합니다.

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
- 새 CSG 연산: `features/scene/csg.ts`의 검증·실행 경계와 원자 적용 경로를 함께 수정하고, AI 명령 경로에는 자동으로 노출하지 않음
