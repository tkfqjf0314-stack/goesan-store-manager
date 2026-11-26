/*************************************************************
 * KT 텔나라네트웍 괴산점 · 개통장부 공용 저장소
 * Google Apps Script 웹앱 (doGet / doPost)  — Code.gs v9.0
 *
 *  · 메인 시트(SHEET_NAME = '전체_통합') 한 곳에 모든 직원 기록이 쌓입니다.
 *  · '담당자' 열로 직원을 구분하고, 직원별 보기 탭은 FILTER 로 자동 생성됩니다.
 *  · 앱(kt-store-manager)에서 매장 PIN 을 함께 보내야 읽기/쓰기가 됩니다.
 *  · 앱을 연 기기는 숨김 탭 '_접속기기' 에, 추방(차단)한 기기·직원은 '_차단' 에 기록됩니다.
 *    차단된 기기/직원은 list·upsert 요청에 {ok:false, blocked:true} 만 받고 데이터는 받지 못합니다.
 *  · v32 부터 기기 승인제: '_접속기기' 의 상태 칸이 approved / pending / blocked 이고
 *    처음 보는 기기는 pending 으로 적혀 사장님이 [승인]하기 전에는 장부를 받지 못합니다
 *    ({ok:false, error:'device_pending'}). 사장님 PIN(201402)을 보낸 기기는 자동 승인 + owner 보호.
 *    owner 기기(이름 방지유)는 block·kick 요청에도 {ok:false, error:'cannot_kick_owner'} 만 돌려줍니다.
 *
 *  설치 : 스프레드시트 → 확장 프로그램 → Apps Script 에 이 파일 전체를 붙여넣고
 *         배포 → 새 배포 → 웹앱 (실행: 나 / 액세스: 모든 사용자) → 배포
 *         나온 주소(https://script.google.com/macros/s/…/exec)를 앱의
 *         '더보기 → 공용 장부 연동'에 넣으면 끝.
 *************************************************************/

/* =========================================================
   ★★★ 괴산점 설정 — 이 다섯 줄만 확인하면 됩니다 ★★★
   ========================================================= */
var SHEET_NAME   = '전체_통합';          // 메인(통합) 시트 이름 — 앱의 데이터가 쌓이는 곳
/* 매장 PIN (조회·등록·수정) — 직원 폰이 처음 연결할 때 넣는 4자리 숫자.
   괴산점은 0315 로 정했습니다. 개통장부 앱의 '더보기 → 공용 장부 연동 → 매장 PIN' 칸과
   밴드 앱의 LEDGER_PIN 에도 같은 값이 들어 있습니다.
   비운 채로 배포하면 앱에 "매장 PIN 이 아직 정해지지 않았습니다" 라고 안내가 뜹니다. */
var STORE_PIN    = '0315';               // 괴산점 전용 매장 PIN
var ADMIN_PIN    = '201402';             // 사장님(관리자) PIN — 삭제·엑셀·백업·기기 승인은 이 PIN 이 있어야
/* 시트에 붙여 만든 스크립트(스프레드시트 → 확장 프로그램 → Apps Script)라면 이 값을 비워 두세요.
   따로 만든 스크립트 프로젝트라면 새 시트 주소의 /d/…/edit 사이 값을 넣습니다. */
var SPREADSHEET_ID = '';
var STAFF_NAMES  = ['방지유', '우광걸']; // 직원별 보기 탭을 미리 만들 이름들 (사장님 포함)
var CREATE_STAFF_TABS = true;            // 담당자 이름이 처음 등장할 때 직원별 보기 탭 자동 생성

/* ===== 접속 기기 · 승인제 · 차단(추방) ===== */
var DEVICE_SHEET = '_접속기기';          // 앱을 연 기기 기록 (숨김 탭 — 직접 고치지 말 것)
var DEVICE_HEAD  = ['deviceId', '기기명', '담당자명', '최근접속', '최초접속', 'UA', '상태', 'owner'];
var DEVICE_BASE_COLS = 6;                // 승인제 이전 기기 탭의 여섯 칸 (기기명·담당자명·접속시각만 갱신)
var ST_APPROVED  = 'approved';           // 승인됨 — 장부를 주고받는다
var ST_PENDING   = 'pending';            // 승인 대기 — 사장님이 [승인]을 눌러야 들어온다
var ST_BLOCKED   = 'blocked';            // 차단(추방)
var OWNER_NAMES  = ['방지유'];            // 사장님 이름 — 이 이름의 기기는 절대 추방할 수 없다
var OWNER_MARK   = 'Y';                  // owner 칸 표시
var BLOCK_SHEET  = '_차단';              // 추방(차단) 목록 (숨김 탭 — 앱의 기기 관리 창에서만 바꾼다)
var BLOCK_HEAD   = ['종류', '값', '표시이름', '차단시각', '차단한사람'];

/* ===== v8.9 밴드앱(괴산점 가망고객) 전 직원 실시간 공유 =====
   · 숨김 탭 '_밴드공유' 에 밴드앱의 고객 상태·메모·예약·댓글·글을 한 줄(항목)씩 저장한다.
   · band_push : 직원 폰이 바꾼 칸만 올린다 → 항목(고객·글) 안에서 칸 단위로 합치고,
                 댓글은 id 로 합집합(같은 댓글은 더 새것) → 서로 덮어쓰지 않는다.
   · band_get  : since(마지막으로 받은 서버 ms) 이후 바뀐 항목만 돌려준다. 기기 승인제와 무관(deviceId 없이 조회). */
var BAND_SHEET   = '_밴드공유';
var BAND_HEAD    = ['key', '종류', 'id', 'updatedAt', '변경자', 'data'];
var BAND_MAX     = 38000;        // 구글 시트 한 칸 50,000자 제한 — 여유 있게
var BAND_CM_MAX  = 60;           // 항목 하나에 보관하는 최근 댓글 수
var BAND_RV_MAX  = 100;          // 사전예약 예약자 수
var BAND_TEXT_MAX = 2000;        // 댓글 한 건 길이
var BAND_BODY_MAX = 12000;       // 글 본문 길이

/* ===== 컬럼 (순서 고정) ===== */
var COLS = ['id', '개통일', '고객명', '연락처', '생년월일', '개통유형', '기종', '요금제',
            '변경요금제', '요금제변경일자',
            '부가서비스', '부가서비스유지', '부가서비스해지일자',
            '중고폰', '중고폰금액', '무선리베이트', '유선리베이트', '메모', '담당자', '수정일시'];

/* ===== v9.0 달 단위 조회 (list_months · list_month) =====
   · 전체_통합 10,000여 건을 한 번에(약 5.3MB · 4~5초) 내려받지 않도록
       list_months : 시트에 있는 달(YYYY-MM)별 건수 · 체크섬 · 마지막 수정시각
       list_month  : 그 달(·여러 달)의 행만 (수백 건 · 100~300KB)
     을 새로 더한다. 기존 action=list(전체) · band_get · band_push 는 손대지 않는다.
   · 체크섬은 앱(kt-store-manager v79)이 이 기기 기록으로 똑같이 계산해
     '이 달은 이미 최신'인지 가리는 데 쓴다 — 알고리즘을 바꾸면 앱도 같이 바꿔야 한다.
       FNV-1a 32bit over  sort( ['id|수정일시', …] ).join('\n')   (빈 달 = fnv(''))
   · 행 → 기록 변환은 전체 조회(readAll_)와 같은 규칙(recordFromRow_)을 쓴다. */
var MONTH_RUN_MAX = 60;   // 달별 행이 흩어져 있을 때 낱개 읽기 상한 (넘으면 통째로 읽는다)
var MONTH_MAX_REQ = 12;   // 한 번에 달 최대 12개

/* 금액(숫자)으로 저장하는 열 */
var MONEY_COLS = ['중고폰금액', '무선리베이트', '유선리베이트'];

/* 앞자리 0(010105)이나 날짜 문자열이 숫자로 바뀌지 않도록 텍스트로 고정하는 열 */
var TEXT_COLS = ['id', '개통일', '연락처', '생년월일', '요금제변경일자', '부가서비스해지일자', '수정일시'];

/* 예전 장부의 단일 리베이트 열 — 시트를 처음 열 때 무선/유선으로 나눠 옮긴다 */
var LEGACY_REBATE_COL = '리베이트';
var WIRED_TYPES = ['인터넷+TV 신규가입', '인터넷+TV 약정갱신', '인터넷 약정갱신'];

/* =========================================================
   웹앱 진입점
   ========================================================= */

/** 조회 : {URL}?pin=(매장 PIN)&action=list&deviceId=…  (JSONP 는 &callback=함수명) */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var cb = String(p.callback || '');
  var out;
  try {
    checkPin_(p.pin);
    var action = String(p.action || 'list');
    var dev = parseDevice_(p);
    if (action === 'devices') {
      // 기기 관리 창(관리자 전용) — 기기·차단 목록은 관리자 PIN 이 있어야 보인다
      checkAdminPin_(p.adminPin, '기기 관리');
      out = { ok: true, action: 'devices', devices: readDevices_(), blocks: readBlocks_(),
              staff: STAFF_NAMES.slice(), serverTime: nowIso_() };
    } else {
      var blk = checkBlocked_(dev);
      if (blk) {
        out = blockedOut_(blk);
      } else {
        // v32 — 기기 승인제: 처음 보는 기기·승인 대기 기기는 장부를 주지 않는다
        var pend = checkApproval_(dev, p);
        if (pend) {
          out = pend;
        } else if (action === 'list') {
          touchDevice_(dev);
          out = { ok: true, action: 'list', sheet: SHEET_NAME, records: readAll_(), serverTime: nowIso_() };
        } else if (action === 'list_months') {
          // v9.0 — 달별 건수·체크섬만 (수 KB). 앱이 '바뀐 달'만 골라 받는 데 쓴다
          touchDevice_(dev);
          out = listMonthsOut_();
        } else if (action === 'list_month') {
          // v9.0 — 그 달(month=YYYY-MM 또는 months=2026-11,2026-10)의 행만
          touchDevice_(dev);
          out = listMonthOut_(p);
        } else if (action === 'ping') {
          touchDevice_(dev);
          var sh = getDataSheet_();
          out = { ok: true, action: 'ping', sheet: SHEET_NAME,
                  count: Math.max(0, sh.getLastRow() - 1), serverTime: nowIso_() };
        } else if (action === 'band_get') {
          // v8.9 밴드앱 실시간 공유 — since 이후 바뀐 항목만 (JSONP callback= 도 jsonOut_ 이 처리)
          out = bandGet_(p);
        } else {
          throw new Error('지원하지 않는 요청입니다: ' + action);
        }
      }
    }
  } catch (err) {
    out = { ok: false, error: errMessage_(err) };
  }
  return jsonOut_(out, cb);
}

/**
 * 저장/삭제/기기관리 : 본문
 *   {"pin":"(매장 PIN)","action":"upsert"|"delete"|"list","record":{…},"id":"…","deviceId":"…"}
 *   {"pin":"(매장 PIN)","action":"devices"|"block"|"unblock","adminPin":"201402","type":"device"|"staff","value":"…"}
 */
function doPost(e) {
  var req = {};
  try {
    if (e && e.postData && e.postData.contents) req = JSON.parse(e.postData.contents);
    else req = (e && e.parameter) || {};
  } catch (err) {
    req = {};
  }
  var out;
  try {
    checkPin_(req.pin);
    var action = String(req.action || 'upsert');
    var dev = parseDevice_(req);
    if (action === 'block' || action === 'kick' || action === 'block_device' ||
        action === 'unblock' || action === 'devices' ||
        action === 'approve_device' || action === 'reject_device') {
      checkAdminPin_(req.adminPin, '기기 관리');
      if (action === 'block' || action === 'kick' || action === 'block_device') {
        if (action !== 'block' && req.type == null) req.type = 'device';   // kick·block_device 는 기기 추방
        out = blockTarget_(req, dev);
      } else if (action === 'unblock') {
        out = unblockTarget_(req);
      } else if (action === 'approve_device') {
        out = approveDevice_(req, dev);
      } else if (action === 'reject_device') {
        out = rejectDevice_(req, dev);
      } else {
        out = devicesOut_();
      }
    } else {
      var blk = checkBlocked_(dev, req);
      if (blk) {
        out = blockedOut_(blk);
      } else {
        // v32 — 기기 승인제: 사장님이 [승인]하기 전에는 list·upsert 모두 막힌다
        var pend = checkApproval_(dev, req);
        if (pend) {
          out = pend;
        } else if (action === 'upsert') {
          touchDevice_(dev);
          out = upsert_(req.record || {});
        } else if (action === 'delete') {
          checkAdminPin_(req.adminPin);
          out = remove_(req.id || (req.record && req.record.id));
        } else if (action === 'list') {
          touchDevice_(dev);
          out = { ok: true, action: 'list', sheet: SHEET_NAME, records: readAll_(), serverTime: nowIso_() };
        } else if (action === 'list_months') {
          touchDevice_(dev);
          out = listMonthsOut_();
        } else if (action === 'list_month') {
          touchDevice_(dev);
          out = listMonthOut_(req);
        } else if (action === 'band_push') {
          // v8.9 밴드앱 실시간 공유 — 바뀐 칸만 받아 항목·칸 단위로 합친다
          out = bandPush_(req);
        } else {
          throw new Error('지원하지 않는 요청입니다: ' + action);
        }
      }
    }
  } catch (err) {
    out = { ok: false, error: errMessage_(err) };
  }
  return jsonOut_(out, '');
}

/* =========================================================
   인증 · 공통
   ========================================================= */

function checkAdminPin_(pin, what) {
  var got = String(pin == null ? '' : pin).trim();
  if (got !== String(ADMIN_PIN)) {
    throw new Error((what || '삭제') + '은(는) 관리자 PIN이 있어야 됩니다.');
  }
}

function checkPin_(pin) {
  if (!String(STORE_PIN)) {
    throw new Error('매장 PIN 이 아직 정해지지 않았습니다. Code.gs 맨 위 STORE_PIN 에 4자리 숫자를 넣고 저장한 뒤, 앱의 매장 PIN 칸에도 같은 값을 넣어 주세요.');
  }
  var got = String(pin == null ? '' : pin).trim();
  if (got !== String(STORE_PIN)) throw new Error('매장 PIN이 맞지 않습니다.');
}

function jsonOut_(obj, cb) {
  var body = JSON.stringify(obj);
  if (cb && /^[A-Za-z_$][\w$.]*$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + body + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function errMessage_(err) {
  return String((err && err.message) || err || '알 수 없는 오류');
}

function nowIso_() {
  return Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/* v9.0 — 실행 한 번 안에서 스프레드시트를 여러 번 열지 않는다
   · tz_() · getDataSheet_() · nowIso_() 마다 openById 를 부르면
     0.2~0.5초짜리 호출이 요청당 서너 번씩 붙어 응답이 2~3초 느려졌다. */
var SS_CACHE = null;
var TZ_CACHE = '';

function tz_() {
  if (TZ_CACHE) return TZ_CACHE;
  try {
    var tz = getSpreadsheet_().getSpreadsheetTimeZone();
    if (tz) { TZ_CACHE = tz; return tz; }
  } catch (err) {}
  TZ_CACHE = Session.getScriptTimeZone() || 'Asia/Seoul';
  return TZ_CACHE;
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** '1,500,000원' 같은 표기도 숫자로 */
function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = String(v == null ? '' : v).replace(/[^0-9.\-]/g, '');
  if (!s || s === '-' || s === '.') return 0;
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

/** 유선(인터넷·TV) 개통인가? (예전 '인터넷+TV' 포함) */
function isWiredType_(t) {
  var s = String(t == null ? '' : t).replace(/\s/g, '');
  if (!s) return false;
  for (var i = 0; i < WIRED_TYPES.length; i++) {
    if (WIRED_TYPES[i].replace(/\s/g, '') === s) return true;
  }
  return /인터넷|TV|티비|iptv/i.test(s);
}

/** 엑셀 일련번호(46000 등)는 날짜로, 나머지는 문자열 그대로 */
function dateToText_(v, tz) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    var ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86400000;
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
  }
  return String(v == null ? '' : v);
}

/* =========================================================
   시트 접근
   ========================================================= */

function getSpreadsheet_() {
  if (SS_CACHE) return SS_CACHE;
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (err) { ss = null; }
  if (!ss && SPREADSHEET_ID) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  if (!ss) throw new Error('스프레드시트를 열 수 없습니다. SPREADSHEET_ID 를 확인해 주세요.');
  SS_CACHE = ss;
  return ss;
}

/** 메인(통합) 시트. 없으면 새로 만들고 헤더를 깐다. */
function getDataSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    writeHeader_(sh, 1, COLS.length);
  }
  return sh;
}

function writeHeader_(sh, row, width) {
  sh.getRange(row, 1, 1, COLS.length).setValues([COLS.slice()]);
  sh.getRange(row, 1, 1, width || COLS.length)
    .setFontWeight('bold')
    .setBackground('#0B57D0')
    .setFontColor('#FFFFFF');
  if (row === 1) sh.setFrozenRows(1);
}

/** 1행 헤더를 읽어 '컬럼명 → 열 번호(0부터)' 지도를 만든다. */
function headerMap_(sh) {
  var width = Math.max(sh.getLastColumn(), COLS.length);
  var cur = sh.getRange(1, 1, 1, width).getValues()[0];
  var map = {}, found = 0;
  for (var i = 0; i < cur.length; i++) {
    var name = String(cur[i] || '').trim();
    if (!name) continue;
    for (var c = 0; c < COLS.length; c++) {
      if (COLS[c] === name && map[name] === undefined) { map[name] = i; found++; break; }
    }
  }
  // 헤더가 비었거나 일부만 있어도 동작하도록 기본 순서로 보정
  for (var k = 0; k < COLS.length; k++) {
    if (map[COLS[k]] === undefined) map[COLS[k]] = k;
  }
  return { map: map, width: width, found: found };
}

function ensureHeader_(sh) {
  // 예전 형식(단일 리베이트) 시트면 새 형식으로 옮긴다
  try { migrateSheet_(sh); } catch (err) { /* 옮기기 실패해도 읽기·쓰기는 계속 */ }
  var idx = headerMap_(sh);
  if (idx.found < 3 && sh.getLastRow() <= 1) {
    writeHeader_(sh, 1, COLS.length);
    idx = headerMap_(sh);
  }
  return idx;
}

/** 1행 헤더를 문자열 배열로 */
function readHeader_(sh) {
  var width = Math.max(sh.getLastColumn(), COLS.length);
  return sh.getRange(1, 1, 1, width).getValues()[0].map(function (v) {
    return String(v == null ? '' : v).trim();
  });
}

/**
 * 헤더가 새 형식(무선리베이트·유선리베이트)이 아니면,
 * 예전 열 이름을 지켜 값을 새 열 순서로 옮기고 헤더를 다시 그린다.
 * 예전 단일 '리베이트' 값은 개통유형을 보고 유선/무선으로 나네 넣는다.
 * 이미 새 형식이면 아무 것도 하지 않고 false 를 돌려준다.
 */
function migrateSheet_(sh) {
  var head = readHeader_(sh);
  var allNew = head.indexOf('무선리베이트') >= 0 && head.indexOf('유선리베이트') >= 0;
  if (allNew && head.indexOf(LEGACY_REBATE_COL) < 0) {
    for (var n = 0; n < COLS.length; n++) {
      if (head.indexOf(COLS[n]) < 0) { allNew = false; break; }
    }
  } else {
    allNew = false;
  }
  if (allNew) return false;

  var last = sh.getLastRow();
  if (last < 2) {
    writeHeader_(sh, 1, COLS.length);
    return true;
  }

  var tz = tz_();
  var width = Math.max(head.length, COLS.length);
  var values = sh.getRange(2, 1, last - 1, width).getValues();
  var rows = [];
  for (var r = 0; r < values.length; r++) {
    var src = values[r];
    var byName = {};
    for (var i = 0; i < head.length; i++) {
      if (head[i]) byName[head[i]] = src[i];
    }
    if (byName['무선리베이트'] == null && byName['유선리베이트'] == null) {
      var legacy = num_(byName[LEGACY_REBATE_COL]);
      if (legacy) {
        if (isWiredType_(byName['개통유형'])) byName['유선리베이트'] = legacy;
        else byName['무선리베이트'] = legacy;
      }
    }
    var line = [], any = false;
    for (var k = 0; k < COLS.length; k++) {
      var name = COLS[k];
      var v = byName[name];
      var cell;
      if (name === 'id') cell = String(v == null ? '' : v).trim();
      else if (MONEY_COLS.indexOf(name) >= 0) cell = num_(v);
      else cell = dateToText_(v, tz);
      line.push(cell);
      if (String(cell == null ? '' : cell).trim() !== '') any = true;
    }
    if (!any) continue;
    if (!line[0]) line[0] = 'row' + (r + 2);
    rows.push(line);
  }

  // 헤더 + 데이터를 한 번에 새 순서로 덮어쓴다 (clear 후 쓰기보다 중간에 끼어들 틈이 적다)
  var block = [COLS.slice()].concat(rows);
  sh.getRange(1, 1, block.length, COLS.length).setValues(block);
  sh.getRange(1, 1, 1, COLS.length)
    .setFontWeight('bold')
    .setBackground('#0B57D0')
    .setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  var idx = headerMap_(sh);
  for (var t = 0; t < TEXT_COLS.length; t++) {
    sh.getRange(2, idx.map[TEXT_COLS[t]] + 1, Math.max(rows.length, 1)).setNumberFormat('@');
  }
  return true;
}

function colLetter_(n) { // 1부터 시작
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 시트 한 줄 → 기록 객체 (전체 조회·달 조회가 같은 규칙을 쓴다). 빈 줄이면 null */
function recordFromRow_(row, idx, tz, rowNum) {
  var rec = {}, any = false;
  for (var c = 0; c < COLS.length; c++) {
    var name = COLS[c];
    var v = row[idx.map[name]];
    var s = dateToText_(v, tz).trim();
    if (MONEY_COLS.indexOf(name) >= 0) rec[name] = num_(v);
    else rec[name] = s;
    if (s) any = true;
  }
  if (!any) return null;
  if (!rec.id) rec.id = 'row' + rowNum;
  return rec;
}

/** 전체 기록 읽기 */
function readAll_() {
  var sh = getDataSheet_();
  var idx = ensureHeader_(sh);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var tz = tz_();
  var values = sh.getRange(2, 1, last - 1, idx.width).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var rec = recordFromRow_(values[r], idx, tz, r + 2);
    if (rec) out.push(rec);
  }
  return out;
}

/* =========================================================
   v9.0 — 달 단위 조회
   ---------------------------------------------------------
   list_months : { ok, months:[{month, count, checksum, max}], meta:{count, checksum}, total }
   list_month  : { ok, months:[…], count, records:[…], checksums:{달:체크섬}, counts:{달:건수} }
                 · 개통일이 비었거나 달을 못 읽는 줄(직원명부 설정 줄 등)은
                   어느 달 요청에도 늘 함께 들어간다('meta' 줄).
   ========================================================= */

/** '2026-11-25…' → '2026-11' (달을 못 읽으면 '') */
function monthOfText_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}/.test(s)) return '';
  return s.slice(0, 7);
}

/** FNV-1a 32bit → 8자리 16진수 (앱 monthSigOfRecords 와 같은 알고리즘) */
function fnv1a_(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

/** 행 목록([{id, mod}]) → 달 체크섬 (id 사전순으로 이어 붙여 해시) */
function sigOfRows_(rows) {
  var a = [];
  for (var i = 0; i < rows.length; i++) a.push(String(rows[i].id || '') + '|' + String(rows[i].mod || ''));
  a.sort();
  return fnv1a_(a.join('\n'));
}

/**
 * 개통일 · id · 수정일시 세 열만 읽어 줄마다 {row, month, id, mod, empty} 를 만든다.
 *  · 10,000행에서도 0.2~0.4초 — 20열을 다 읽지 않는다.
 *  · id 가 빈 줄은 readAll_ 과 같이 'row{행번호}' 로 본다(앱이 받는 값과 같아야 체크섬이 맞는다).
 *  · id · 수정일시 · 개통일이 모두 빈 줄은 장부 빈 줄이라 어느 체크섬에도 넣지 않는다.
 */
function scanRows_(sh, idx) {
  var last = sh.getLastRow();
  var out = [];
  if (last < 2) return out;
  var tz = tz_();
  var n = last - 1;
  var dates = sh.getRange(2, idx.map['개통일'] + 1, n, 1).getValues();
  var ids = sh.getRange(2, idx.map['id'] + 1, n, 1).getValues();
  var mods = sh.getRange(2, idx.map['수정일시'] + 1, n, 1).getValues();
  for (var r = 0; r < n; r++) {
    var dateTxt = dateToText_(dates[r][0], tz).trim();
    var rawId = String(ids[r][0] == null ? '' : ids[r][0]).trim();
    var mod = dateToText_(mods[r][0], tz).trim();
    var rowNum = r + 2;
    out.push({
      row: rowNum,
      month: monthOfText_(dateTxt),
      id: rawId || ('row' + rowNum),
      mod: mod,
      empty: !rawId && !mod && !dateTxt
    });
  }
  return out;
}

/** 달별 행 모으기 — list_months 응답 본문 (달 목록·건수·체크섬·마지막 수정시각) */
function listMonthsOut_() {
  var sh = getDataSheet_();
  var idx = ensureHeader_(sh);
  var rows = scanRows_(sh, idx);
  var byMonth = {}, order = [], meta = [], total = 0;
  var i, it;
  for (i = 0; i < rows.length; i++) {
    it = rows[i];
    if (it.empty) continue;
    if (!it.month) { meta.push(it); continue; }
    if (!byMonth[it.month]) { byMonth[it.month] = { month: it.month, count: 0, rows: [] }; order.push(it.month); }
    byMonth[it.month].count++;
    byMonth[it.month].rows.push(it);
    total++;
  }
  order.sort();
  var months = [];
  for (i = 0; i < order.length; i++) {
    var b = byMonth[order[i]];
    var max = '';
    for (var j = 0; j < b.rows.length; j++) if (String(b.rows[j].mod) > max) max = String(b.rows[j].mod);
    months.push({ month: b.month, count: b.count, checksum: sigOfRows_(b.rows), max: max });
  }
  return { ok: true, action: 'list_months', sheet: SHEET_NAME, total: total,
           months: months,
           meta: { count: meta.length, checksum: sigOfRows_(meta) },
           serverTime: nowIso_() };
}

/** months=2026-11,2026-10 → ['2026-11','2026-10'] (형식이 틀린 값은 버린다) */
function parseMonths_(spec) {
  var raw = String(spec == null ? '' : spec).split(',');
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var m = String(raw[i]).trim();
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    if (out.indexOf(m) < 0) out.push(m);
    if (out.length >= MONTH_MAX_REQ) break;
  }
  return out;
}

/** 행 번호 목록(오름차순) → 연속 구간 [{start, end}] (읽기 호출을 줄인다) */
function runRanges_(rows) {
  var out = [], cur = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (cur && r === cur.end + 1) { cur.end = r; continue; }
    cur = { start: r, end: r };
    out.push(cur);
  }
  return out;
}

/** 달(·여러 달) 행만 내려주기 — 앱 첫 화면(이번 달 + 지난 달)이 0.5~1초에 뜬다 */
function listMonthOut_(p) {
  var want = parseMonths_(p.months || p.month);
  if (!want.length) throw new Error('기간(month=YYYY-MM · months=YYYY-MM,YYYY-MM)을 지정해 주세요.');
  var sh = getDataSheet_();
  var idx = ensureHeader_(sh);
  var tz = tz_();
  /* 개통일 열 **하나만** 읽어 그 달 줄을 가린다 (list_month 는 10,000행에서도 0.2~0.4초) */
  var last = sh.getLastRow();
  var allow = {}, counts = {}, i, r;
  for (i = 0; i < want.length; i++) counts[want[i]] = 0;
  if (last >= 2) {
    var dates = sh.getRange(2, idx.map['개통일'] + 1, last - 1, 1).getValues();
    for (r = 0; r < dates.length; r++) {
      var m = monthOfText_(dateToText_(dates[r][0], tz));
      if (!m) { allow[r + 2] = true; continue; }      // 달 없는 줄(명부 설정 줄)은 어느 요청에나
      if (want.indexOf(m) >= 0) allow[r + 2] = true;
    }
  }
  var rowsToRead = [];
  for (var k in allow) if (allow.hasOwnProperty(k)) rowsToRead.push(Number(k));
  rowsToRead.sort(function (a, b) { return a - b; });

  var runs = runRanges_(rowsToRead);
  if (runs.length > MONTH_RUN_MAX) {
    // 행이 지천으로 흩어졌으면 통째로 한 번 읽고 거른다(낱개 읽기 폭발 방지)
    runs = [{ start: 2, end: last }];
  }
  var recs = [];
  for (i = 0; i < runs.length; i++) {
    var a = runs[i].start, b = runs[i].end;
    if (b < 2) continue;
    if (a < 2) a = 2;
    var values = sh.getRange(a, 1, b - a + 1, idx.width).getValues();
    for (r = 0; r < values.length; r++) {
      var rowNum = a + r;
      if (!allow[rowNum]) continue;
      var rec = recordFromRow_(values[r], idx, tz, rowNum);
      if (rec) recs.push(rec);
    }
  }
  /* 달별 건수·체크섬 — 방금 담은 줄 그대로 (앱이 이 기기 기록으로 계산하는 값과 같아야 한다) */
  var byMonth = {}, metaRows = [], out = [];
  for (i = 0; i < recs.length; i++) {
    var rc = recs[i];
    var mm = monthOfText_(rc.개통일);
    if (!mm) { metaRows.push({ id: rc.id, mod: String(rc.수정일시 || '') }); out.push(rc); continue; }
    (byMonth[mm] = byMonth[mm] || []).push({ id: rc.id, mod: String(rc.수정일시 || '') });
    counts[mm] = (counts[mm] || 0) + 1;
    out.push(rc);
  }
  var checksums = {};
  for (i = 0; i < want.length; i++) checksums[want[i]] = sigOfRows_(byMonth[want[i]] || []);
  return { ok: true, action: 'list_month', sheet: SHEET_NAME, months: want.slice(),
           count: out.length, records: out, counts: counts, checksums: checksums,
           metaChecksum: sigOfRows_(metaRows),
           serverTime: nowIso_() };
}

/** id 가 있는 행 번호(1부터). 없으면 0 */
function findRow_(sh, idx, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var col = idx.map['id'] + 1;
  var values = sh.getRange(2, col, last - 1, 1).getValues();
  var key = String(id || '').trim();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === key) return i + 2;
  }
  return 0;
}

/** 한 행 쓰기 (헤더 순서가 달라도 맞춰서) */
function writeRow_(sh, idx, rowIdx, rec) {
  var values = [];
  for (var i = 0; i < idx.width; i++) values.push('');
  for (var c = 0; c < COLS.length; c++) {
    var name = COLS[c];
    var v = rec[name] == null ? '' : rec[name];
    values[idx.map[name]] = (MONEY_COLS.indexOf(name) >= 0) ? num_(v) : String(v);
  }
  for (var t = 0; t < TEXT_COLS.length; t++) {
    sh.getRange(rowIdx, idx.map[TEXT_COLS[t]] + 1).setNumberFormat('@');
  }
  sh.getRange(rowIdx, 1, 1, idx.width).setValues([values]);
}

/* =========================================================
   접속 기기 · 추방(차단)
   ---------------------------------------------------------
   · 앱을 연 기기는 숨김 탭 '_접속기기' 에 한 줄로 남는다.
   · 관리자(PIN)가 앱에서 추방한 기기/직원은 '_차단' 에 쌓인다.
   · 차단된 기기·직원에게는 데이터를 전혀 내려주지 않고
     { ok:false, blocked:true } 만 돌려준다.
   ========================================================= */

/** 앱이 보낸 기기 정보 (없으면 null) */
function parseDevice_(src) {
  var o = src || {};
  var id = String(o.deviceId || '').trim();
  if (!id) return null;
  return {
    deviceId: id.slice(0, 80),
    label: String(o.device || o.deviceLabel || '').trim().slice(0, 60),
    name: String(o.name || o.담당자 || '').trim().slice(0, 30),
    ua: String(o.ua || '').trim().slice(0, 200)
  };
}

/** 날짜/시간 셀을 문자열로 (Date 로 바뀌었어도 시:분까지) */
function stampText_(v, tz) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return String(v == null ? '' : v).trim();
}

/** 숨김 보조 탭 (없으면 만들고 숨긴다) */
function sheetByName_(name, head) {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head.slice()])
      .setFontWeight('bold').setBackground('#0B57D0').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    try { sh.hideSheet(); } catch (err) {}
  }
  return sh;
}

function getDeviceSheet_() { return sheetByName_(DEVICE_SHEET, DEVICE_HEAD); }
function getBlockSheet_() { return sheetByName_(BLOCK_SHEET, BLOCK_HEAD); }

/* ---------------------------------------------------------
   v32 — 기기 승인제
   ---------------------------------------------------------
   · 기기 탭 '_접속기기' 에 상태(approved / pending / blocked)와 owner 칸을 더했다.
   · 처음 보는 기기는 pending 으로 적히고, 장부 레코드 없이 {ok:false, error:'device_pending'} 만 받는다.
   · 사장님 PIN(201402)을 함께 보낸 기기는 자동 approved + owner 로 등록된다.
   · 승인제 이전부터 쓰던 기기(상태 칸이 비어 있던 줄)는 모두 approved 로 옮겨져 그대로 쓴다.
   · owner 기기(또는 이름이 방지유)는 추방·반려할 수 없다 — cannot_kick_owner.
   --------------------------------------------------------- */

/** 기기 탭 헤더를 8칸(상태·owner 포함)으로 맞춘다. 예전 6칸 탭은 기존 기기를 모두 승인으로 옮긴다. */
function ensureDeviceHead_(sh) {
  var need = DEVICE_HEAD.length;
  var width = Math.max(sh.getLastColumn(), need);
  var head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (v) {
    return String(v == null ? '' : v).trim();
  });
  if (head[6] === DEVICE_HEAD[6] && head[7] === DEVICE_HEAD[7]) return false;
  var last = sh.getLastRow();
  var block = [DEVICE_HEAD.slice()];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, width).getValues();
    for (var i = 0; i < vals.length; i++) {
      var line = vals[i].slice(0, need);
      while (line.length < need) line.push('');
      var id = String(line[0] == null ? '' : line[0]).trim();
      if (!id) continue;
      if (!String(line[6] || '').trim()) line[6] = ST_APPROVED;   // 승인제 이전 기기는 그대로 통과
      if (!String(line[7] || '').trim() && OWNER_NAMES.indexOf(String(line[2] || '').trim()) >= 0) line[7] = OWNER_MARK;
      block.push(line);
    }
  }
  sh.getRange(1, 1, block.length, need).setNumberFormat('@').setValues(block);
  sh.getRange(1, 1, 1, need).setFontWeight('bold').setBackground('#0B57D0').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  return true;
}

/** 기기 탭 (헤더를 8칸으로 보장) */
function deviceSheet_() {
  var sh = getDeviceSheet_();
  try { ensureDeviceHead_(sh); } catch (err) { /* 헤더 정리 실패해도 읽기는 계속 */ }
  return sh;
}

function normStatus_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === ST_PENDING || s === '대기' || s === '승인대기' || s === '승인 대기') return ST_PENDING;
  if (s === ST_BLOCKED || s === '차단' || s === '차단됨' || s === 'block') return ST_BLOCKED;
  return ST_APPROVED;   // 빈칸(승인제 이전 기기)·approved
}

function isOwnerMark_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'y' || s === 'yes' || s === 'o' || s === 'true' || s === '1' || s === 'owner' || s === '사장님';
}

/** owner 칸이 켜졌거나 이름이 사장님(방지유)인 기기 */
function isOwnerDevice_(row) {
  if (!row) return false;
  if (isOwnerMark_(row.owner)) return true;
  return OWNER_NAMES.indexOf(String(row.name || '').trim()) >= 0;
}

/** 기기 한 대의 지금 상태 (없으면 null) */
function deviceRowOf_(deviceId) {
  var id = String(deviceId || '').trim();
  if (!id) return null;
  var sh = null;
  try { sh = deviceSheet_(); } catch (err) { return null; }
  var last = sh.getLastRow();
  if (last < 2) return null;
  var tz = tz_();
  var v = sh.getRange(2, 1, last - 1, DEVICE_HEAD.length).getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0] == null ? '' : v[i][0]).trim() === id) {
      return {
        row: i + 2,
        deviceId: id,
        label: String(v[i][1] || '').trim(),
        name: String(v[i][2] || '').trim(),
        lastSeen: stampText_(v[i][3], tz),
        firstSeen: stampText_(v[i][4], tz),
        ua: String(v[i][5] || '').trim(),
        status: normStatus_(v[i][6]),
        owner: isOwnerMark_(v[i][7]) ? OWNER_MARK : ''
      };
    }
  }
  return null;
}

/** 기기 한 줄을 상태·owner 까지 통째로 쓴다 */
function writeDeviceRow_(sh, rowIdx, d) {
  sh.getRange(rowIdx, 1, 1, DEVICE_HEAD.length).setNumberFormat('@').setValues([[
    d.deviceId, d.label || '', d.name || '', d.lastSeen || '', d.firstSeen || d.lastSeen || '', d.ua || '',
    d.status || ST_APPROVED, d.owner || ''
  ]]);
}

/** 처음 보는 기기를 적는다 (있으면 그대로 둔다) */
function registerDevice_(dev, status, owner) {
  if (!dev || !dev.deviceId) return null;
  var found = deviceRowOf_(dev.deviceId);
  if (found) return found;
  var sh = deviceSheet_();
  var now = nowIso_();
  var row = Math.max(sh.getLastRow() + 1, 2);
  writeDeviceRow_(sh, row, {
    deviceId: dev.deviceId, label: dev.label, name: dev.name, ua: dev.ua,
    lastSeen: now, firstSeen: now, status: status || ST_PENDING, owner: owner || ''
  });
  return deviceRowOf_(dev.deviceId);
}

/** 기기의 상태·owner 만 바꾼다 (나머지 칸은 그대로) */
function setDeviceRow_(deviceId, status, owner) {
  var row = deviceRowOf_(deviceId);
  if (!row) return false;
  var sh = deviceSheet_();
  row.status = status || row.status;
  row.owner = (owner == null) ? row.owner : owner;
  writeDeviceRow_(sh, row.row, row);
  return true;
}

/** 사장님 PIN 을 함께 보낸 요청인가 */
function adminReq_(src) {
  var o = src || {};
  return String(o.adminPin == null ? '' : o.adminPin).trim() === String(ADMIN_PIN);
}

function pendingOut_(deviceId) {
  return {
    ok: false, error: 'device_pending', pending: true, deviceId: String(deviceId || ''),
    message: '사장님 승인을 기다리는 기기입니다.', serverTime: nowIso_()
  };
}

function cannotKickOut_(row) {
  return {
    ok: false, error: 'cannot_kick_owner',
    message: '사장님(방지유) 기기는 추방할 수 없습니다.',
    deviceId: (row && row.deviceId) || '', serverTime: nowIso_()
  };
}

/**
 * 기기 승인 검사 — 통과면 null, 막아야 하면 그 응답.
 * deviceId 가 없는 단순 curl 조회(?pin=(매장 PIN)&action=list)는 예전처럼 통과시킨다.
 */
function checkApproval_(dev, src) {
  if (!dev || !dev.deviceId) return null;
  var isAdmin = adminReq_(src);
  var row = deviceRowOf_(dev.deviceId);
  if (!row) {
    if (isAdmin) { registerDevice_(dev, ST_APPROVED, OWNER_MARK); return null; }   // 사장님 PIN 을 아는 기기 = 사장님 폰
    registerDevice_(dev, ST_PENDING, '');
    return pendingOut_(dev.deviceId);
  }
  if (row.status === ST_BLOCKED) return blockedOut_({ type: 'device', value: dev.deviceId, label: row.label });
  if (row.status === ST_PENDING) {
    if (isAdmin) { setDeviceRow_(dev.deviceId, ST_APPROVED, row.owner || OWNER_MARK); return null; }
    try { touchDevice_(dev); } catch (err) {}
    return pendingOut_(dev.deviceId);
  }
  return null;
}

function devicesOut_() {
  return { ok: true, action: 'devices', devices: readDevices_(), blocks: readBlocks_(),
           staff: STAFF_NAMES.slice(), ownerNames: OWNER_NAMES.slice(), serverTime: nowIso_() };
}

/** 승인 대기 기기를 승인한다 — 사장님 PIN 필요 */
function approveDevice_(req, dev) {
  var target = String(req.value || req.deviceId || '').trim();
  if (!target) throw new Error('승인할 기기를 지정해 주세요.');
  var row = deviceRowOf_(target);
  if (!row) throw new Error('그 기기를 찾을 수 없습니다. 그 기기에서 앱을 한 번 열어 주세요.');
  var owner = row.owner;
  // 사장님 PIN 을 누른 기기 자체를 승인하는 경우(= 새 사장님 폰) · 이름이 사장님이면 owner 로 보호
  if (!isOwnerMark_(owner) && (target === String((dev && dev.deviceId) || '') || OWNER_NAMES.indexOf(row.name) >= 0)) {
    owner = OWNER_MARK;
  }
  setDeviceRow_(target, ST_APPROVED, owner);
  removeBlock_('device', target);
  var out = devicesOut_();
  out.action = 'approve_device';
  out.deviceId = target;
  out.owner = isOwnerMark_(owner) ? OWNER_MARK : '';
  out.name = row.name;
  out.label = row.label;
  return out;
}

/** 승인 대기 기기를 반려(차단)한다 — 사장님 PIN 필요 · 사장님 기기는 반려 불가 */
function rejectDevice_(req, dev) {
  var copy = {};
  for (var k in req) if (req.hasOwnProperty(k)) copy[k] = req[k];
  copy.type = 'device';
  copy.value = String(req.value || req.deviceId || '').trim();
  if (!copy.value) throw new Error('반려할 기기를 지정해 주세요.');
  var out = blockTarget_(copy, dev);
  if (out && out.ok) out.action = 'reject_device';
  return out;
}

/** 기기 한 대의 최근 접속만 갱신한다 (없으면 '대기'로 적는다 · 실패해도 본 요청은 계속) */
function touchDevice_(dev) {
  if (!dev || !dev.deviceId) return;
  var lock = LockService.getScriptLock();
  var got = false;
  try { got = lock.tryLock(15000); } catch (err) { got = false; }
  if (!got) return;
  try {
    var row = deviceRowOf_(dev.deviceId);
    var sh = deviceSheet_();
    var now = nowIso_();
    if (row) {
      // 기기명·담당자명·최근접속만 — 상태·owner 는 건드리지 않는다
      sh.getRange(row.row, 1, 1, DEVICE_BASE_COLS).setNumberFormat('@').setValues([[
        row.deviceId, dev.label || row.label, dev.name || row.name, now, row.firstSeen || now, dev.ua || row.ua
      ]]);
    } else {
      var r = Math.max(sh.getLastRow() + 1, 2);
      writeDeviceRow_(sh, r, {
        deviceId: dev.deviceId, label: dev.label, name: dev.name, ua: dev.ua,
        lastSeen: now, firstSeen: now, status: ST_PENDING, owner: ''
      });
    }
  } catch (err) {
    /* 기기 기록 실패는 본 요청에 영향 없음 */
  } finally {
    try { lock.releaseLock(); } catch (err2) {}
  }
}

/** 기기 목록 (최근 접속 순 · 상태·owner 포함) */
function readDevices_() {
  var sh = null;
  try { sh = getSpreadsheet_().getSheetByName(DEVICE_SHEET); } catch (err) { return []; }
  if (!sh) return [];
  try { ensureDeviceHead_(sh); } catch (err) {}
  var last = sh.getLastRow();
  if (last < 2) return [];
  var tz = tz_();
  var v = sh.getRange(2, 1, last - 1, DEVICE_HEAD.length).getValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var id = String(v[i][0] == null ? '' : v[i][0]).trim();
    if (!id) continue;
    out.push({
      deviceId: id,
      label: String(v[i][1] || '').trim(),
      name: String(v[i][2] || '').trim(),
      lastSeen: stampText_(v[i][3], tz),
      firstSeen: stampText_(v[i][4], tz),
      ua: String(v[i][5] || '').trim(),
      status: normStatus_(v[i][6]),
      owner: isOwnerMark_(v[i][7]) ? OWNER_MARK : '',
      ownerName: OWNER_NAMES.indexOf(String(v[i][2] || '').trim()) >= 0
    });
  }
  out.sort(function (a, b) { return String(b.lastSeen).localeCompare(String(a.lastSeen)); });
  return out;
}

/** 차단 탭의 줄들 */
function readBlockRows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var tz = tz_();
  var v = sh.getRange(2, 1, last - 1, Math.max(sh.getLastColumn(), BLOCK_HEAD.length)).getValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var kind = String(v[i][0] || '').trim();
    var val = String(v[i][1] == null ? '' : v[i][1]).trim();
    if (!kind || !val) continue;
    out.push({
      row: i + 2, kind: kind, value: val,
      label: String(v[i][2] || '').trim(),
      at: stampText_(v[i][3], tz),
      by: String(v[i][4] || '').trim()
    });
  }
  return out;
}

function normBlockType_(t) {
  var s = String(t == null ? '' : t).trim();
  if (s === 'staff' || s === '직원' || s === '이름') return 'staff';
  return 'device';
}

/** 차단 목록 { device:[…], staff:[…] } — 차단 탭이 없으면 빈 목록 */
function readBlocks_() {
  var res = { device: [], staff: [] };
  var sh = null;
  try { sh = getSpreadsheet_().getSheetByName(BLOCK_SHEET); } catch (err) { return res; }
  if (!sh) return res;
  var rows = readBlockRows_(sh);
  for (var i = 0; i < rows.length; i++) {
    if (normBlockType_(rows[i].kind) === 'staff') res.staff.push(rows[i]);
    else res.device.push(rows[i]);
  }
  return res;
}

/** 이 기기에서 접속한 마지막 담당자명 (직원 이름 차단에 함께 쓴다) */
function deviceName_(deviceId) {
  if (!deviceId) return '';
  var sh = null;
  try { sh = getSpreadsheet_().getSheetByName(DEVICE_SHEET); } catch (err) { return ''; }
  if (!sh) return '';
  var last = sh.getLastRow();
  if (last < 2) return '';
  var v = sh.getRange(2, 1, last - 1, 3).getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0] == null ? '' : v[i][0]).trim() === deviceId) {
      return String(v[i][2] || '').trim();
    }
  }
  return '';
}

/** 이 요청이 차단된 기기/직원인가? → {type, value, label} 또는 null */
function checkBlocked_(dev, req) {
  var deviceId = dev && dev.deviceId ? dev.deviceId : '';
  var names = [], i;
  if (dev && dev.name) names.push(dev.name);
  if (req) {
    if (req.name) names.push(String(req.name).trim());
    var rec = req.record || null;
    if (rec && rec.담당자) names.push(String(rec.담당자).trim());
  }
  if (!deviceId && !names.length) return null;

  // v32 — 기기 탭의 상태가 blocked 인 경우도 차단으로 본다
  if (deviceId) {
    var drow = deviceRowOf_(deviceId);
    if (drow && drow.status === ST_BLOCKED) return { type: 'device', value: deviceId, label: drow.label };
  }

  var b = readBlocks_();
  for (i = 0; i < b.device.length; i++) {
    if (deviceId && b.device[i].value === deviceId) {
      return { type: 'device', value: deviceId, label: b.device[i].label };
    }
  }
  if (b.staff.length) {
    if (deviceId) {
      var recorded = deviceName_(deviceId);
      if (recorded) names.push(recorded);
    }
    for (i = 0; i < b.staff.length; i++) {
      for (var n = 0; n < names.length; n++) {
        if (names[n] && names[n] === b.staff[i].value) {
          return { type: 'staff', value: names[n], label: b.staff[i].label };
        }
      }
    }
  }
  return null;
}

/** 차단된 요청에 돌려주는 응답 — 기록(records)은 절대 싣지 않는다 */
function blockedOut_(info) {
  return {
    ok: false, blocked: true,
    error: '관리자에 의해 접근이 제한되었습니다.',
    blockType: (info && info.type) || '',
    blockValue: (info && info.value) || '',
    serverTime: nowIso_()
  };
}

/** 기기/직원을 추방(차단)한다 — 관리자 PIN 필요 · 사장님 기기·이름은 절대 불가 */
function blockTarget_(req, dev) {
  var type = normBlockType_(req.type);
  var value = String(req.value == null ? '' : req.value).trim();
  if (!value) throw new Error('차단할 기기/직원을 지정해 주세요.');
  // v32 — 사장님 기기(owner) · 사장님 이름은 추방 불가
  if (type === 'device') {
    var drow = deviceRowOf_(value);
    if (isOwnerDevice_(drow)) return cannotKickOut_(drow);
  } else if (OWNER_NAMES.indexOf(value) >= 0) {
    return cannotKickOut_({ deviceId: '', name: value });
  }
  var label = String(req.label || '').trim().slice(0, 60);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('다른 작업이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.');
  try {
    var sh = getBlockSheet_();
    var rows = readBlockRows_(sh);
    for (var i = 0; i < rows.length; i++) {
      if (normBlockType_(rows[i].kind) === type && rows[i].value === value) {
        if (type !== 'staff') setDeviceRow_(value, ST_BLOCKED);
        return { ok: true, action: 'block', already: true, type: type, value: value,
                 blocks: readBlocks_(), devices: readDevices_(), serverTime: nowIso_() };
      }
    }
    sh.appendRow([type === 'staff' ? '직원' : '기기', value, label,
                  nowIso_(), String((dev && dev.name) || req.by || '')]);
    if (type !== 'staff') setDeviceRow_(value, ST_BLOCKED);
    return { ok: true, action: 'block', type: type, value: value, label: label,
             blocks: readBlocks_(), devices: readDevices_(), serverTime: nowIso_() };
  } finally {
    lock.releaseLock();
  }
}

/** 차단 탭에서 한 건을 지운다 (여러 줄이면 모두) */
function removeBlock_(type, value) {
  var sh = null;
  try { sh = getSpreadsheet_().getSheetByName(BLOCK_SHEET); } catch (err) { sh = null; }
  if (!sh) return 0;
  var rows = readBlockRows_(sh);
  var removed = 0;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (normBlockType_(rows[i].kind) === type && rows[i].value === value) {
      sh.deleteRow(rows[i].row);
      removed++;
    }
  }
  return removed;
}

/** 추방(차단) 해제 — 관리자 PIN 필요 */
function unblockTarget_(req) {
  var type = normBlockType_(req.type);
  var value = String(req.value == null ? '' : req.value).trim();
  if (!value) throw new Error('차단을 풀 기기/직원을 지정해 주세요.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('다른 작업이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.');
  try {
    var removed = removeBlock_(type, value);
    // v32 — 기기 상태도 다시 승인으로 (사장님 기기면 owner 는 그대로)
    if (type !== 'staff') {
      var drow = deviceRowOf_(value);
      if (drow && drow.status === ST_BLOCKED) setDeviceRow_(value, ST_APPROVED);
    }
    return { ok: true, action: 'unblock', type: type, value: value, removed: removed,
             blocks: readBlocks_(), devices: readDevices_(), serverTime: nowIso_() };
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================
   저장 · 삭제
   ========================================================= */

function upsert_(rec) {
  if (!rec || !rec.id) throw new Error('기록 id가 없습니다.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('다른 저장이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.');
  try {
    var sh = getDataSheet_();
    var idx = ensureHeader_(sh);
    var serverNow = nowIso_();
    var clean = {};
    for (var c = 0; c < COLS.length; c++) {
      var name = COLS[c];
      clean[name] = rec[name] == null ? '' : String(rec[name]).trim();
    }
    clean.id = String(rec.id).trim();
    clean.수정일시 = clean.수정일시 || serverNow;

    var rowIdx = findRow_(sh, idx, clean.id);
    var mode = rowIdx > 0 ? 'updated' : 'appended';
    if (rowIdx <= 0) rowIdx = Math.max(sh.getLastRow() + 1, 2);
    writeRow_(sh, idx, rowIdx, clean);

    if (CREATE_STAFF_TABS && clean.담당자) {
      try { ensureStaffTab_(clean.담당자); } catch (err) { /* 탭 생성 실패는 저장에 영향 없음 */ }
    }
    return { ok: true, action: 'upsert', id: clean.id, mode: mode,
             수정일시: clean.수정일시, serverTime: serverNow };
  } finally {
    lock.releaseLock();
  }
}

function remove_(id) {
  var key = String(id || '').trim();
  if (!key) throw new Error('삭제할 기록 id가 없습니다.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('다른 저장이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.');
  try {
    var sh = getDataSheet_();
    var idx = ensureHeader_(sh);
    var row = findRow_(sh, idx, key);
    if (row > 0) sh.deleteRow(row);
    return { ok: true, action: 'delete', id: key, removed: row > 0, serverTime: nowIso_() };
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================
   직원별 보기 탭 (담당자 이름으로 자동 분류)
   ========================================================= */

function staffTabName_(name) {
  var n = String(name || '').trim();
  if (!n) return '';
  n = n.replace(/[\\\/\?\*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (n.length > 24) n = n.slice(0, 24);
  return '담당_' + n;
}

/** 담당자 이름 하나에 대한 보기 탭을 (없으면) 만든다. */
function ensureStaffTab_(name) {
  var tabName = staffTabName_(name);
  if (!tabName) return null;
  var ss = getSpreadsheet_();
  var exist = ss.getSheetByName(tabName);
  if (exist) return exist;
  if (ss.getSheets().length >= 180) return null;

  var data = getDataSheet_();
  var idx = headerMap_(data);
  var lastCol = colLetter_(idx.width);
  var staffCol = colLetter_(idx.map['담당자'] + 1);
  var crit = String(name).replace(/"/g, '""');

  var sh = ss.insertSheet(tabName);
  writeHeader_(sh, 1, idx.width);
  sh.getRange(2, 1).setFormula(
    '=IFERROR(SORT(FILTER(\'' + SHEET_NAME + '\'!A2:' + lastCol +
    ', \'' + SHEET_NAME + '\'!' + staffCol + '2:' + staffCol + '="' + crit + '"), 2, FALSE), "아직 기록이 없습니다.")'
  );
  sh.getRange(1, 1).setNote(
    '자동 보기 탭입니다. 직접 고치지 말고 "' + SHEET_NAME + '" 탭에서 등록·수정하세요. ' +
    '앱에서 담당자를 "' + name + '"(으)로 저장한 기록이 자동으로 모입니다.'
  );
  return sh;
}

/** 직원별 보기 탭을 한 번에 만들거나 갱신 (에디터에서 직접 실행해도 됨) */
function createStaffTabs() {
  var names = STAFF_NAMES.slice();
  // 시트에 이미 기록된 담당자도 함께
  var rows = readAll_();
  for (var i = 0; i < rows.length; i++) {
    var n = String(rows[i].담당자 || '').trim();
    if (n && names.indexOf(n) < 0) names.push(n);
  }
  for (var j = 0; j < names.length; j++) ensureStaffTab_(names[j]);
  return names.join(', ');
}

/** 메뉴에서 바로 실행할 수 있는 초기 설정 (1회) */
function setup() {
  var sh = getDataSheet_();
  ensureHeader_(sh);
  createStaffTabs();
  return '설정 완료 · 메인 시트: ' + SHEET_NAME;
}

/** 배포 주소를 다시 만들었을 때 확인용 */
function whoami() {
  return { sheet: SHEET_NAME, pinLength: String(STORE_PIN).length, adminPinLength: String(ADMIN_PIN).length,
           staff: STAFF_NAMES, deviceSheet: DEVICE_SHEET, blockSheet: BLOCK_SHEET,
           deviceHead: DEVICE_HEAD.slice(), ownerNames: OWNER_NAMES.slice(), approval: true };
}

/* =========================================================
   v8.9 — 밴드앱(괴산점 가망고객) 전 직원 실시간 공유
   ---------------------------------------------------------
   숨김 탭 '_밴드공유' 한 줄 = 항목 하나(고객 1명 또는 글 1건).
     A: key        'c:<고객id>' | 'p:<글id>'
     B: 종류        cust | post
     C: id
     D: updatedAt  이 항목을 마지막으로 바꾼 서버 시각(ms) — 이 값 이후만 받아간다
     E: 변경자      마지막으로 바꾼 직원 이름
     F: data       {"t","id","u","st","f":{칸:값},"cm":[댓글],"rv":[예약자]}

   · 직원 폰은 '바꾼 칸'만 보낸다. 서버는 항목 안에서 칸 단위로 덮어쓰고,
     댓글·답글은 id 로 합집합(같은 id 는 더 새로운 u) — 서로 다른 고객·다른 칸은 절대 덮이지 않는다.
   · 한 칸 50,000자 제한을 넘지 않도록 본문·댓글 길이를 자르고 오래된 댓글부터 버린다(BAND_MAX).
   ========================================================= */

/** 숨김 탭 '_밴드공유' (없으면 만들고 숨긴다) */
function bandSheet_() {
  var sh = sheetByName_(BAND_SHEET, BAND_HEAD);
  try { sh.getRange('D:D').setNumberFormat('0'); } catch (err) {}
  try { sh.setColumnWidth(1, 150); sh.setColumnWidth(6, 420); } catch (err) {}
  return sh;
}

/** 조회 : {URL}?pin=(매장 PIN)&action=band_get&since=1690000000000 */
function bandGet_(p) {
  var sh = bandSheet_();
  var since = Math.max(0, parseInt((p && p.since) || 0, 10) || 0);
  var now = Date.now();
  var last = sh.getLastRow();
  var items = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, BAND_HEAD.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var key = String(vals[i][0] || '').trim();
      if (!key) continue;
      var u = 0;
      var raw4 = vals[i][3];
      if (raw4 instanceof Date) u = raw4.getTime();
      else u = Number(raw4) || 0;
      if (since && u <= since) continue;
      var raw = String(vals[i][5] || '');
      if (!raw) continue;
      var d = null;
      try { d = JSON.parse(raw); } catch (err) { d = null; }
      if (!d) continue;
      if (!d.u) d.u = u;
      d.st = String(vals[i][4] || '') || d.st || '';
      items.push(d);
    }
  }
  return { ok: true, action: 'band_get', now: now, since: since, count: items.length, items: items };
}

/** 저장 : POST {pin, action:'band_push', staff, items:[{t,id,f,cm,rv,u}]} */
function bandPush_(req) {
  var items = (req && req.items) || [];
  var staff = String((req && (req.staff || req['담당자'])) || '').slice(0, 20);
  var now0 = Date.now();
  if (!items.length) return { ok: true, action: 'band_push', count: 0, now: now0 };
  if (items.length > 60) throw new Error('한 번에 60건까지만 보낼 수 있습니다.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('다른 저장이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.');
  try {
    var sh = bandSheet_();
    var now = Date.now();
    var last = sh.getLastRow();
    var rows = {};
    if (last >= 2) {
      var keys = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < keys.length; i++) {
        var k = String(keys[i][0] || '').trim();
        if (k) rows[k] = i + 2;
      }
    }
    var n = 0;
    for (var j = 0; j < items.length; j++) {
      var it = items[j] || {};
      var tt = String(it.t || '');
      var t = (tt === 'cust' || tt === 'c') ? 'cust' : 'post';   // 앱은 c/p 로 보낸다
      var id = String(it.id || '').trim();
      if (!id) continue;
      var key = (t === 'cust' ? 'c:' : 'p:') + id;
      var row = rows[key] || 0;
      var old = null;
      if (row) {
        try { old = bandParse_(sh.getRange(row, 1, 1, BAND_HEAD.length).getValues()[0]); } catch (err) { old = null; }
      }
      var rec = bandMerge_(old, it, t, id, now, staff);
      var json = JSON.stringify(rec);
      if (json.length > BAND_MAX) {
        rec = bandShrink_(rec);
        json = JSON.stringify(rec);
      }
      if (json.length > BAND_MAX) continue;   // 그래도 넘치면 이 건은 건너뛴다(다음 저장 때 다시)
      var out = [key, rec.t, rec.id, now, rec.st, json];
      if (!row) {
        row = Math.max(sh.getLastRow() + 1, 2);
        rows[key] = row;
      }
      sh.getRange(row, 1, 1, BAND_HEAD.length).setValues([out]);
      n++;
    }
    SpreadsheetApp.flush();
    return { ok: true, action: 'band_push', count: n, now: now };
  } finally {
    try { lock.releaseLock(); } catch (err2) {}
  }
}

/** 저장된 한 줄 → 객체 (깨진 줄은 null) */
function bandParse_(row) {
  var raw = String((row && row[5]) || '');
  if (!raw) return null;
  try {
    var d = JSON.parse(raw);
    if (!d || !d.id) return null;
    if (!d.f) d.f = {};
    if (!d.cm) d.cm = [];
    return d;
  } catch (err) { return null; }
}

/** 칸 값 다듬기 — 문자열 길이 제한(셀 50,000자 보호) */
function bandVal_(k, v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  var s = (typeof v === 'string') ? v : JSON.stringify(v);
  if (k === 'body') return s.slice(0, BAND_BODY_MAX);
  if (k === 'title') return s.slice(0, 1000);
  if (k === 'memo') return s.slice(0, 1000);
  return String(s).slice(0, 500);
}

/** 댓글 한 건 다듬기 (사진은 주소(http)만 — 폰에만 있는 큰 이미지는 보내지 않는다) */
function bandCmt_(c, now) {
  if (!c || !c.id) return null;
  var o = {};
  o.id = String(c.id).slice(0, 60);
  o.author = String(c.author || '').slice(0, 20);
  o.at = String(c.at || '').slice(0, 20);
  o.text = String(c.text || '').slice(0, BAND_TEXT_MAX);
  o.st = String(c.st || '').slice(0, 10);
  o.stBy = String(c.stBy || '').slice(0, 20);
  o.stAt = String(c.stAt || '').slice(0, 20);
  o.resDate = String(c.resDate || '').slice(0, 10);
  o.resTime = String(c.resTime || '').slice(0, 5);
  o.memo = String(c.memo || '').slice(0, 200);
  o.sys = !!c.sys;
  var cu = +c.u || 0;
  o.u = (cu && Math.abs(now - cu) < 86400000) ? cu : now;   // 기기 시계가 크게 틀어지면 서버 시각
  if (c.photos && c.photos.length) {
    o.photos = [];
    for (var i = 0; i < c.photos.length && i < 6; i++) {
      var ph = c.photos[i] || {};
      var src = String(ph.src || '');
      if (/^https?:\/\//.test(src) && src.length < 600) o.photos.push({ src: src, name: String(ph.name || '').slice(0, 40) });
    }
  }
  if (c.replies && c.replies.length) {
    o.replies = [];
    for (var j = 0; j < c.replies.length && j < 20; j++) {
      var r = c.replies[j] || {};
      o.replies.push({
        id: String(r.id || '').slice(0, 60), author: String(r.author || '').slice(0, 20),
        at: String(r.at || '').slice(0, 20), text: String(r.text || '').slice(0, 1000),
        st: String(r.st || '').slice(0, 10), photos: []
      });
    }
  }
  return o;
}

/** 예약자 한 줄 다듬기 */
function bandResv_(r) {
  if (!r) return null;
  return {
    id: String(r.id || '').slice(0, 60), name: String(r.name || '').slice(0, 30),
    phone: String(r.phone || '').slice(0, 20), model: String(r.model || '').slice(0, 60),
    owner: String(r.owner || '').slice(0, 20), memo: String(r.memo || '').slice(0, 300),
    at: String(r.at || '').slice(0, 20), done: !!r.done
  };
}

/** 예전 기록 + 이번에 올라온 변경 → 합친 기록 (칸 단위 + 댓글 합집합) */
function bandMerge_(old, it, t, id, now, staff) {
  var o = old || { t: t, id: id, u: 0, st: '', f: {}, cm: [], rv: [] };
  var f = o.f || {};
  var nf = it.f || {};
  for (var k in nf) {
    if (!nf.hasOwnProperty(k)) continue;
    var v = bandVal_(k, nf[k]);
    if (v === undefined) continue;
    f[k] = v;
  }
  var byId = {}, list = [], c, prev;
  for (var i = 0; i < (o.cm || []).length; i++) {
    c = o.cm[i];
    if (c && c.id) byId[c.id] = c;
  }
  var inc = it.cm || [];
  for (var j = 0; j < inc.length; j++) {
    c = bandCmt_(inc[j], now);
    if (!c) continue;
    prev = byId[c.id];
    if (prev && (+prev.u || 0) > (+c.u || 0)) continue;   // 이미 더 새 댓글이 있다
    byId[c.id] = c;
  }
  for (var kk in byId) { if (byId.hasOwnProperty(kk)) list.push(byId[kk]); }
  list.sort(function (a, b) { return (+a.u || 0) - (+b.u || 0); });
  if (list.length > BAND_CM_MAX) list = list.slice(list.length - BAND_CM_MAX);

  var rv = it.rv;
  if (rv === undefined || rv === null) rv = o.rv || [];
  var rvOut = [];
  for (var q = 0; q < rv.length && q < BAND_RV_MAX; q++) {
    var rr = bandResv_(rv[q]);
    if (rr) rvOut.push(rr);
  }
  return {
    t: t, id: id, u: now, st: String(it.st || staff || ''),
    f: f, cm: list, rv: rvOut
  };
}

/** 한 칸(BAND_MAX)을 넘으면 본문을 줄이고 오래된 댓글부터 버린다 */
function bandShrink_(rec) {
  var out = { t: rec.t, id: rec.id, u: rec.u, st: rec.st, f: {}, cm: [], rv: rec.rv || [] };
  for (var k in (rec.f || {})) {
    if (!rec.f.hasOwnProperty(k)) continue;
    out.f[k] = rec.f[k];
  }
  if (String(out.f.body || '').length > 4000) out.f.body = String(out.f.body).slice(0, 4000);
  if (String(out.f.memo || '').length > 600) out.f.memo = String(out.f.memo).slice(0, 600);
  var cm = (rec.cm || []).slice();
  while (cm.length) {
    out.cm = cm;
    if (JSON.stringify(out).length <= BAND_MAX) return out;
    cm.shift();
  }
  out.cm = [];
  return out;
}

/** (관리자용) 밴드 공유 기록 몇 건인지 — 에디터에서 확인 */
function bandShareInfo() {
  var sh = bandSheet_();
  return { sheet: BAND_SHEET, rows: Math.max(0, sh.getLastRow() - 1), hidden: sh.isSheetHidden() };
}
