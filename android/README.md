# KT 괴산점 개통장부 (Android APK)

KT 텔나라네트웍 괴산점 개통장부 웹앱(`https://tkfqjf0314-stack.github.io/goesan-store-manager/`)을
안드로이드 앱으로 감싼 앱입니다. **기본은 화면 캡처(스크린샷)·화면 녹화·최근 앱 미리보기를 막고,
관리자 모드에서만 캡처를 허용**합니다(v2).

| 항목 | 값 |
| --- | --- |
| 앱 이름 | `KT 괴산점 개통장부` |
| 패키지 | `com.ktgoesan.ledger` |
| 버전 | 1.0.0 (versionCode 1) |
| 최소 안드로이드 | 7.0 (API 24) |
| 로드 주소 | `https://tkfqjf0314-stack.github.io/goesan-store-manager/` |
| User-Agent 식별자 | `... KTGoesanLedgerApp/1.0` |

## 캡처 차단 (v2 — 관리자 모드에서만 허용)

1. `MainActivity.onCreate()` 에서 **무조건** 켭니다.

   ```java
   getWindow().setFlags(
           WindowManager.LayoutParams.FLAG_SECURE,
           WindowManager.LayoutParams.FLAG_SECURE);
   ```

2. 웹 장부가 `window.KtSecure.setCaptureAllowed(true|false)` 로 상태를 알려 줍니다.
   (`applyRole()` 이 역할이 바뀔 때마다 호출 — 직원 모드·수동 잠금·10분 자동 잠금 = `false`, 관리자 PIN 통과 = `true`)

   ```java
   @JavascriptInterface
   public void setCaptureAllowed(final boolean allowed) { … }   // clearFlags / addFlags(FLAG_SECURE)
   ```

3. 앱이 **뒤로 가면(`onPause`) 다시 가리고**, 돌아오면(`onResume`) 마지막 상태를 되살립니다.
   그래서 관리자 모드로 보던 중에 홈으로 나가도 최근 앱 미리보기에는 장부가 남지 않습니다.
4. 인쇄 → PDF 저장은 막지 않습니다(장부 출력 용도). 캡처 차단은 화면 캡처·녹화·미리보기에 한정됩니다.

## 웹 ↔ 앱 연결

- `window.print()` → 안드로이드 인쇄(PrintManager). PDF 저장·프린터 출력 가능.
- Blob / `data:` 링크 다운로드 → `다운로드/KT괴산점개통장부/` 폴더에 저장(JS 가로채기 + `KTGoesanApp.saveFile`).
  (같은 다리를 예전 이름 `window.KTChilgeumApp` 으로도 하나 더 걸어 둡니다 — 웹 장부가 그 이름도 확인하기 때문)
- `http(s)` 다운로드 링크 → 안드로이드 다운로드 관리자.
- 파일 선택(`<input type="file">`) → 안드로이드 파일 선택기(백업 JSON·엑셀 가져오기).
- `tel:` → 전화 다이얼, `mailto:` → 메일 앱, 그 밖의 외부 링크(`docs.google.com` 등) → 외부 브라우저.
- 뒤로가기 → WebView 히스토리 우선, 히스토리가 없으면 "한 번 더 누르면 종료".
- 캡처 허용/차단 → `window.KtSecure`(위 항목).

## 아이콘

흰 바탕 + KT 공식 `kt` 마크(블랙 k · 레드 플래그) + 빨간 알약 `괴산점` + 큰 검정 `개통장부`.

- 원본(마스터): `android/tools/icon-master-512.png`(레거시 카드) · `android/tools/icon-foreground-512.png`(adaptive 전경, 투명)
- 배지 글자: `python3 android/tools/rebadge.py "괴산점"` — 알약 테두리는 그대로 두고 안쪽 글자만 다시 그립니다(Noto Sans CJK KR 필요)
- 생성: `python3 android/tools/make_icons.py android/app/src/main/res` (Pillow 필요)
  → `mipmap-*dpi/ic_launcher.png` · `ic_launcher_round.png`(48~192px) · `ic_launcher_foreground.png`(108~432px)
- `mipmap-anydpi-v26/ic_launcher.xml` 은 배경 `#FFFFFF` + `@mipmap/ic_launcher_foreground` (adaptive)
- PWA 아이콘(`icons/icon-192.png`·`icon-512.png`·`apple-touch-icon.png`)도 같은 그림입니다.

## 빌드

이 저장소에는 GitHub Actions 워크플로가 없습니다. **PC(JDK 17 + Android SDK)에서 직접 빌드**해
`KT-괴산점-개통장부.apk` 로 저장소 루트에 올리는 방식입니다(칠금점과 같은 방식).

```bash
export JAVA_HOME=<JDK 17> ANDROID_HOME=<Android SDK>
cd android
gradle assembleRelease      # gradle wrapper(gradlew)는 없습니다
# 결과: android/app/build/outputs/apk/release/app-release.apk
```

**서명 키**: 릴리스도 debug keystore 로 서명합니다. 이미 배포된 앱 위에 덮어 설치하려면
`KT_DEBUG_KEYSTORE=<keystore 경로>` 로 **같은 키**를 지정해야 합니다(다르면 기존 앱을 지우고 설치해야 하고
WebView 로컬 데이터가 초기화됩니다). 기본 경로는 `android/.keystore/kt-debug.keystore` 입니다.

## 참고

- 웹 쪽 파일(`index.html`, `sw.js`)은 이 앱 작업에서 건드리지 않습니다.
  단 v61 에서는 웹이 `KtSecure` 를 부르도록 `index.html` 에 한 줄(`syncCaptureAllowed()`)이 들어갔습니다.
- APK 는 실시간 사이트를 불러오므로 웹만 고칠 때는 재빌드가 필요 없습니다.

## 관리자 새 개통 알림 (v2.1)

웹 장부(v82)가 관리자 PIN(201402)을 통과한 기기에서만 켠다. 201402 를 한 번도 넣지 않은 직원 폰은
`enabled=false` 라 앱이 아무 알림도 띄우지 않는다.

| 웹 → 앱 (`window.KTStoreBridge` · `window.KTGoesanApp` · 기존 이름 `window.KTChilgeumApp` 도 같은 함수) | 하는 일 |
| --- | --- |
| `notify(title, body)` | 네이티브 상단 알림(채널 `store_alerts` · `IMPORTANCE_HIGH`) |
| `setAdminNotify(on, url, pin, deviceId, name)` | 켜짐 여부 + 공용 장부 접속 정보를 SharedPreferences 에 저장하고 15분 주기 확인(JobScheduler)을 걸거나 취소 |
| `setNotifySeen(json)` / `getNotifySeen()` | 웹과 앱이 같은 기준선(`{seeded, seen:{id:수정일시}}`)을 쓴다 — 같은 건이 두 번 울리지 않게 |
| `markNotified(id, stamp)` | 웹이 이미 띄운 건을 앱 기준선에도 반영 |

- **앱을 닫아 둔 동안**: `NotifyJobService` 가 15분마다(JobScheduler 최소 주기) `list_months` → 바뀐 달만
  `list_month` 로 받아 새 건·수정 건을 가려 알린다. 절전(Doze) 상태에서는 몇 분 늦을 수 있다.
- **알림 문구**(웹과 동일): 제목 `📋 새 개통 등록 · {담당자}` / `✏️ 개통 수정 · {담당자}`,
  본문 `{고객명} · {기종 또는 유선 요금제} · {개통유형}`. 한 번에 3건 + 나머지는 `📋 개통 알림 N건` 요약.
- **권한**: `POST_NOTIFICATIONS`(안드로이드 13+ 런타임 요청) · `RECEIVE_BOOT_COMPLETED`(재부팅 뒤 주기 확인 유지).
- 앱이 뒤로 가면 최근 앱 미리보기는 v2 와 같이 다시 가린다(캡처 차단은 알림과 별개).
