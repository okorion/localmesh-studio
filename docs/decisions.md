# 중요 결정 사항

아래는 현재 추천안을 구현 기본값으로 사용한 항목입니다. 제품 방향에 따라 바꿀 수 있습니다.

## 1. 협업 서버 배포

**추천/현재안: 웹 앱과 별도 프로세스인 Hocuspocus 서버, 저장소는 하나**

- 장점: WebSocket 장애와 웹 렌더링 장애가 분리되고 소켓 코드 위치가 명확함
- 대안: Cloudflare Worker에 직접 결합. 배포 단위는 줄지만 WebSocket 업그레이드·영속화 코드가 웹 앱과 섞임

## 2. 협업 서버 영속 저장소

**현재 MVP: 서버 메모리 + 각 브라우저 IndexedDB**

- 추천 운영안: PostgreSQL에 Yjs 업데이트/스냅샷 저장
- 소규모 대안: SQLite extension
- 결정 필요: 운영 인프라가 정해지면 선택. 현재 서버를 재시작해도 접속했던 브라우저가 다시 장면을 제공하지만, 서버 단독 복구는 보장하지 않음

## 3. 로컬 AI 기본 모델

**추천/현재안: WebLLM `Qwen3-0.6B-q4f16_1-MLC`를 필요할 때만 로드**

- 장점: 다운로드와 GPU 메모리 부담이 낮고 프롬프트가 외부로 나가지 않음
- 품질 우선 대안: Qwen3 1.7B 이상. 더 정확하지만 다운로드와 VRAM 사용량 증가
- 데스크톱 대안: Ollama/llama.cpp. 브라우저 GPU 부담이 줄지만 별도 로컬 프로그램과 CORS 설정 필요

## 4. AI 변경 적용 방식

**추천/현재안: 명령 미리보기 후 사용자 승인**

- 장점: 삭제나 잘못된 대량 편집을 확인 가능
- 대안: 생성/색상 변경만 자동 적용하고 삭제는 승인

## 5. GPU 자원 공유

**추천/현재안: 작은 LLM을 지연 로드하고 Three 렌더러와 함께 사용**

- 향후 필요: 큰 모델 선택 시 생성 중 뷰포트 FPS를 낮추는 GPU 자원 정책
- 이유: WebGPU 3D와 WebLLM이 같은 GPU 메모리를 사용하므로 저사양 기기에서 동시에 최대 성능을 요구하면 불안정할 수 있음

## 6. 지원 파일 형식

**현재: LocalMesh JSON v2 내보내기**

- v2 이유: 프리미티브 외에 CSG로 bake한 custom mesh를 재현하도록 `geometry.positions`, `geometry.normals`, `geometry.operation`, `geometry.topology`를 저장
- 추천 다음 단계: glTF/GLB 가져오기·내보내기
- 이후 선택: OBJ/STL은 변환 입구로만 지원하고 내부 표준은 glTF로 통일

## 7. CSG 실행과 저장

**추천/현재안: 명시적인 A/B 선택 후 브라우저에서 계산하고 baked custom mesh로 교체**

- 지원 연산: 합집합(A ∪ B), 차집합(A − B), 교집합(A ∩ B)
- 적용 단위: 성공한 경우 두 입력 삭제와 결과 생성이 하나의 Yjs transaction·Undo 단계
- 실패 정책: 빈 결과, 잘못된 입력·큰 열린 출력·zero-volume geometry, 계산 중 입력 변경, 다른 실시간 협업자 연결, topology 계산 예산·삼각형 예산 초과, 연산 예외는 문서를 변경하지 않고 두 원본 보존
- 후속 편집: 결과는 Transform과 재차 CSG 입력을 지원하는 custom mesh로 저장
- 복잡도 상한: 각 입력과 출력은 20,000개 삼각형. 저장하는 positions/normals는 각각 최대 180,000개 scalar
- 초기 로드: 입력 검증을 통과한 첫 연산에서만 `three-bvh-csg`를 지연 로드
- 협업 경계: 다른 awareness 사용자가 연결되어 있으면 CSG를 비활성화하고, 계산 뒤 대기 중인 업데이트를 처리한 다음 A/B signature를 다시 검사. v2 mesh를 공유하는 클라이언트는 동일 버전 필요
- 제외 범위: AI 프롬프트가 CSG를 생성·실행하는 기능

`three-bvh-csg`는 실험 단계이며 닫힌 two-manifold 입력을 전제로 합니다. 프리미티브는 strict edge·부피 검증을 적용하고, `csg-engine-output-v1` 표식이 있는 baked mesh와 출력은 엔진의 수치 seam을 허용하되 bbox 최대 extent의 75%보다 긴 단일·연결 열린 경계와 zero-volume을 거부하는 practical sanity check를 적용합니다. 따라서 자기 교차와 모든 코너 케이스를 CAD 수준으로 보장하지는 않습니다. 다른 실시간 협업자가 있을 때는 실행을 막지만 아직 수신되지 않은 오프라인 변경이나 awareness 밖 동시 CSG는 잠글 수 없어, 병합 후 여러 결과 또는 한쪽 Undo 뒤 원본과 상대 결과가 함께 남을 수 있습니다. 운영 수준의 정확성이나 동시 연산 직렬화가 필요하면 별도 엔진·schema handshake·shared operation protocol을 평가합니다.
