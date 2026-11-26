# KT 텔나라네트웍 괴산점 개통장부

괴산점 개통장부 웹앱(PWA) + 안드로이드 앱입니다. **앱 본체는 `index.html` 한 파일**이고
서버·빌드·패키지 설치가 없습니다. GitHub Pages 주소로 열면 홈 화면에 설치(PWA)되고,
같은 화면을 안드로이드 앱(APK)으로도 감쌌습니다.

- 웹 주소: https://tkfqjf0314-stack.github.io/goesan-store-manager/
- 웹 버전: **v87-g1** (v86-g1 → 유선 요금제 변경 · 요금제변경일자에 `1년`·`2년` 자동계산)
- 안드로이드: `KT-괴산점-개통장부.apk` · 패키지 `com.ktgoesan.ledger` · 1.0.0 — 빌드 안내 `android/README.md`

## 매장 설정 (index.html 안)

| 항목 | 값 | 위치 |
| --- | --- | --- |
| 매장명 | `KT 텔나라네트웍 괴산점` | 제목·머리글 |
| 매장 PIN | `0315` | `defaultStorePin()` (`String.fromCharCode(48, 51, 49, 53)`) |
| 관리자(사장님) PIN | `201402` (6자리) | `ADMIN_PIN_HASH` = sha256('201402') |
| 직원 명부 | `방지유` · `우광걸` | `STAFF_LIST` |
| 사장님(추방 불가) | `방지유` | `OWNER_NAMES` |
| 공용 장부 주소 | `https://script.google.com/macros/s/AKfycbxXSL5aBcm_SlwxMARQhuU5AIlfLtpAYsXuYiOpcT7sryRjYEdWbdoC5mKBVesN4BtNgg/exec` (2026-11-26 배포) → 앱 `더보기 → 공용 장부 연동` 에 자동으로 채워짐, [저장]만 누르면 연결 | `DEFAULT_SYNC.url` |
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

## 앱 전용 항목 (시트 20컴럼 유지)

시트(`Code.gs`) 열 구조를 바꾸지 않고, 앱에서만 쓰는 값은 `메모` 칸 앞머리 표기로 주고받습니다.

| 앱 항목 | 시트 메모 표기 |
| --- | --- |
| 단말보험 · 제휴카드 · 할인유형 · 특수조건 · 추가지원금/페이백 · 법대 등 | `[보험:파손]` `[카드:우리]` `[단말할인]` `[추지:150000]` `[법대:…]` … |
| **단말할부 (v86)** | `[할부:24개월]` · `[할부:30개월]` · `[할부:36개월]` · `[할부:48개월]` · `[할부:일시불]` (미선택이면 표기 없음) |
| **유선 요금제 변경 (v87)** | 칸을 새로 만들지 않고 기존 `변경요금제`·`요금제변경일자` 컴럼을 그대로 쓴다 — 유선 단독 건도 여기에 유선 상품명과 `1년`·`2년`(개통일 +1년/+2년) 날짜가 들어가고, 같은 D-DAY 알림을 탄다 |

## 안드로이드 앱

- 패키지 `com.ktgoesan.ledger` (칠금점 앱과 완전히 별개 앱 — 같은 폰에 둘 다 설치해도 데이터는 섞이지 않습니다)
- 기본은 화면 캡처·녹화를 막고, 관리자 모드에서만 허용
- 관리자 PIN 을 넣은 기기는 앱을 닫아 둬도 새 개통·수정을 15분마다 확인해 알립니다
- 자세한 내용과 빌드 방법: `android/README.md`

## 웹 → 앱 규칙

- `window.KTGoesanApp` (예전 이름 `window.KTChilgeumApp` 도 같은 다리) · `window.KtSecure` · `window.KTStoreBridge`
- PWA 로만 써도 등록·집계·엑셀·공용 장부 연동은 모두 됩니다. APK 는 캡처 차단과 백그라운드 알림을 더합니다.
