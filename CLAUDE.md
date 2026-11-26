# KT 텔나라네트웍 괴산점 개통장부

괴산점 개통장부 웹앱(PWA) + 안드로이드 앱입니다. **앱 본체는 `index.html` 한 파일**이고
서버·빌드·패키지 설치가 없습니다. GitHub Pages 주소로 열면 홈 화면에 설치(PWA)되고,
같은 화면을 안드로이드 앱(APK)으로도 감쌌습니다.

- 웹 주소: https://tkfqjf0314-stack.github.io/goesan-store-manager/
- 웹 버전: **v85-g1** (칠금점 v85 기반 괴산점판)
- 안드로이드: `KT-괴산점-개통장부.apk` · 패키지 `com.ktgoesan.ledger` · 1.0.0 — 빌드 안내 `android/README.md`

## 매장 설정 (index.html 안)

| 항목 | 값 | 위치 |
| --- | --- | --- |
| 매장명 | `KT 텔나라네트웍 괴산점` | 제목·머리글 |
| 매장 PIN | `0315` | `defaultStorePin()` (`String.fromCharCode(48, 51, 49, 53)`) |
| 관리자(사장님) PIN | `201402` (6자리) | `ADMIN_PIN_HASH` = sha256('201402') |
| 직원 명부 | `방지유` · `우광걸` | `STAFF_LIST` |
| 사장님(추방 불가) | `방지유` | `OWNER_NAMES` |
| 공용 장부 주소 | 비어 있음 → 앱 `더보기 → 공용 장부 연동` 에서 `/exec` 주소 입력 | `DEFAULT_SYNC.url` |
| localStorage 키 | `kt_goesan_*` | — |

## 파일

| 파일 | 내용 |
| --- | --- |
| `index.html` | 앱 본체 (화면·로직·데이터 전부) |
| `sw.js` · `manifest.webmanifest` | 오프라인 캐시 · 홈 화면 설치 |
| `apps-script/Code.gs` · `README.md` | 구글 시트 공용 장부 (Apps Script, 시트에 붙여넣는 안내 포함) |
| `icons/` | PWA 아이콘 (매장명 없는 그림이라 그대로 사용) |
| `tools/make_icons.py` | PWA 아이콘 생성기 |
| `android/` | 안드로이드 앱 (WebView 래퍼 · 캡처 차단 · 새 개통 알림) |
| `KT-괴산점-개통장부.apk` | 안드로이드 앱 설치 파일 |

## 안드로이드 앱

- 패키지 `com.ktgoesan.ledger` (칠금점 앱과 완전히 별개 앱 — 같은 폰에 둘 다 설치해도 데이터는 섞이지 않습니다)
- 기본은 화면 캡처·녹화를 막고, 관리자 모드에서만 허용
- 관리자 PIN 을 넣은 기기는 앱을 닫아 둬도 새 개통·수정을 15분마다 확인해 알립니다
- 자세한 내용과 빌드 방법: `android/README.md`

## 웹 → 앱 규칙

- `window.KTGoesanApp` (예전 이름 `window.KTChilgeumApp` 도 같은 다리) · `window.KtSecure` · `window.KTStoreBridge`
- PWA 로만 써도 등록·집계·엑셀·공용 장부 연동은 모두 됩니다. APK 는 캡처 차단과 백그라운드 알림을 더합니다.
