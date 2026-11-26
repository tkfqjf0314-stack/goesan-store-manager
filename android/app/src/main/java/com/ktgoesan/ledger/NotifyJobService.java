package com.ktgoesan.ledger;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * v2.1 — 앱을 닫아 둔 동안의 새 개통 확인.
 *
 * <p>15분마다(JobScheduler 최소 주기) 공용 장부(Apps Script `/exec`)에
 * {@code list_months}(달별 건수·체크섬, 수십 KB)를 물어 <b>바뀐 달만</b> {@code list_month} 로 받는다.
 * 새 건·수정 건이 있으면 웹 장부와 같은 문구로 상단 알림을 띄운다.</p>
 *
 * <p><b>동작 조건</b> — {@link NotifyStore} 의 {@code enabled} 는 웹 장부에서 관리자 PIN(0525)을
 * 통과했을 때만 true 가 된다. 직원 폰은 이 값이 false 라 job 이 아무 것도 하지 않는다.
 * 기준선(어디까지 알았는지)도 웹과 똑같은 JSON 을 쓴다({@code setNotifySeen}).</p>
 */
public class NotifyJobService extends JobService {

    private static final long FRESH_MS = 30 * 60 * 1000L;   // 이 기기에 없던 달이라도 30분 안에 만든 건은 알린다
    private static final int MAX_MONTHS = 3;                // 한 번에 받아 보는 달 수
    private static final int MAX_NOTIFY = 3;                // 한 번에 울리는 알림 수(나머지는 요약 1건)

    @Override
    public boolean onStartJob(final JobParameters params) {
        if (!NotifyStore.enabled(this)) {
            return false;
        }
        final Context ctx = getApplicationContext();
        Thread worker = new Thread(() -> {
            boolean retry = false;
            try {
                runCheck(ctx);
            } catch (Exception e) {
                retry = true;      // 다음 주기에 다시 (네트워크·서버 일시 오류)
            }
            jobFinished(params, retry);
        }, "kt-notify-check");
        worker.setDaemon(true);
        worker.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    // ────────────────────────────────────────────────────────── 확인 한 번

    static void runCheck(Context c) throws Exception {
        String url = NotifyStore.url(c);
        String pin = NotifyStore.pin(c);
        if (url.isEmpty() || pin.isEmpty()) {
            return;
        }
        String deviceId = NotifyStore.deviceId(c);
        String device = NotifyStore.deviceName(c);

        JSONObject idx = get(url, pin, "action", "list_months",
                "deviceId", deviceId, "device", device, "name", device);
        if (idx == null || !idx.optBoolean("ok") || idx.optBoolean("blocked")
                || idx.optBoolean("pending")) {
            return;
        }
        JSONArray monthRows = idx.optJSONArray("months");
        LinkedHashMap<String, String> server = new LinkedHashMap<>();
        if (monthRows != null) {
            for (int i = 0; i < monthRows.length(); i++) {
                JSONObject m = monthRows.optJSONObject(i);
                if (m == null) {
                    continue;
                }
                String key = m.optString("month", "");
                if (!key.isEmpty()) {
                    server.put(key, m.optString("checksum", ""));
                }
            }
        }
        if (server.isEmpty()) {
            return;
        }

        SharedPreferences prefs = NotifyStore.prefs(c);
        JSONObject stored = parse(NotifyStore.monthsJson(c));
        JSONObject root = NotifyStore.parseRoot(NotifyStore.seenJson(c));
        JSONObject seen = root.optJSONObject("seen");
        if (seen == null) {
            seen = new JSONObject();
            root.put("seen", seen);
        }
        boolean seeded = root.optBoolean("seeded", false);

        /* ① 처음 켠 기기 — 알리지 않고 기준선만 만든다 (이번 달 · 지난 달) */
        if (stored.length() == 0 || !seeded) {
            String cur = nowMonth();
            String prev = prevMonth(cur);
            String[] seeds = new String[]{cur, prev};
            for (String m : seeds) {
                if (!server.containsKey(m)) {
                    continue;
                }
                JSONObject d = get(url, pin, "action", "list_month", "months", m,
                        "deviceId", deviceId, "device", device, "name", device);
                if (d == null || !d.optBoolean("ok")) {
                    continue;
                }
                JSONArray rows = d.optJSONArray("records");
                if (rows != null) {
                    for (int i = 0; i < rows.length(); i++) {
                        JSONObject r = rows.optJSONObject(i);
                        if (r == null) {
                            continue;
                        }
                        String rid = r.optString("id", "");
                        if (!rid.isEmpty()) {
                            seen.put(rid, r.optString("수정일시", ""));
                        }
                    }
                }
                stored.put(m, server.get(m));
            }
            save(c, prefs, root, stored);
            return;
        }

        /* ② 바뀐 달 찾기 */
        List<String> changed = new ArrayList<>();
        for (Map.Entry<String, String> e : server.entrySet()) {
            String old = stored.has(e.getKey()) ? stored.optString(e.getKey(), "") : "";
            if (!e.getValue().equals(old)) {
                changed.add(e.getKey());
            }
        }
        Iterator<String> keys = stored.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            if (!server.containsKey(k)) {
                keys.remove();
            }
        }
        if (changed.isEmpty()) {
            return;
        }
        /* 화면에 먼저 보이는 달부터 — 이번 달 → 지난 달 → 최근 달 */
        final String cur = nowMonth();
        changed.sort((a, b) -> {
            int ra = a.equals(cur) ? 0 : (a.equals(prevMonth(cur)) ? 1 : 2);
            int rb = b.equals(cur) ? 0 : (b.equals(prevMonth(cur)) ? 1 : 2);
            return ra != rb ? Integer.compare(ra, rb) : b.compareTo(a);
        });

        /* ③ 바뀐 달만 받아 새 건 · 수정 건 가려내기 */
        List<String[]> found = new ArrayList<>();
        int fetched = 0;
        for (String m : changed) {
            if (fetched >= MAX_MONTHS) {
                break;                       // 나머지는 다음 주기에 (체크섬을 그대로 두어 다시 잡힌다)
            }
            JSONObject d = get(url, pin, "action", "list_month", "months", m,
                    "deviceId", deviceId, "device", device, "name", device);
            if (d == null || !d.optBoolean("ok") || d.optBoolean("blocked") || d.optBoolean("pending")) {
                continue;
            }
            fetched++;
            boolean covered = stored.has(m);      // 이 기기가 이미 알고 있던 달인가
            JSONArray rows = d.optJSONArray("records");
            if (rows != null) {
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject r = rows.optJSONObject(i);
                    if (r == null) {
                        continue;
                    }
                    String rid = r.optString("id", "");
                    if (rid.isEmpty()) {
                        continue;
                    }
                    String stamp = r.optString("수정일시", "");
                    String prevStamp = seen.has(rid) ? seen.optString(rid, "") : null;
                    if (prevStamp != null && prevStamp.equals(stamp)) {
                        continue;                  // 그대로
                    }
                    if (prevStamp != null && (stamp.isEmpty() || stamp.compareTo(prevStamp) <= 0)) {
                        seen.put(rid, stamp);      // 서버가 더 오래된 값(되돌림)
                        continue;
                    }
                    boolean isNew = (prevStamp == null);
                    if (isNew && !covered && !fresh(stamp)) {
                        seen.put(rid, stamp);      // 처음 보는 옛 달의 옛 건
                        continue;
                    }
                    found.add(new String[]{
                            isNew ? "new" : "edit",
                            r.optString("담당자", ""),
                            bodyOf(r),
                            rid,
                            stamp
                    });
                    seen.put(rid, stamp);
                }
            }
            stored.put(m, server.get(m));
        }

        /* ④ 알림 — 최근 것부터 3건 + 나머지 요약 */
        if (!found.isEmpty()) {
            found.sort((a, b) -> String.valueOf(b[4]).compareTo(String.valueOf(a[4])));
            int n = Math.min(MAX_NOTIFY, found.size());
            for (int i = 0; i < n; i++) {
                String[] f = found.get(i);
                String who = f[1] == null || f[1].trim().isEmpty() ? "담당자 미지정" : f[1].trim();
                String title = ("new".equals(f[0]) ? "📋 새 개통 등록 · " : "✏️ 개통 수정 · ") + who;
                NotifyStore.notifyNow(c, title, f[2]);
            }
            if (found.size() > n) {
                NotifyStore.notifyNow(c, "📋 개통 알림 " + found.size() + "건",
                        "새 개통·수정 " + found.size() + "건이 있습니다. 앱에서 확인해 주세요.");
            }
        }
        save(c, prefs, root, stored);
    }

    /** {고객명} · {기종 또는 유선 요금제} · {개통유형} */
    private static String bodyOf(JSONObject r) {
        String cust = r.optString("고객명", "").trim();
        if (cust.isEmpty()) {
            cust = "(고객명 없음)";
        }
        String model = r.optString("기종", "").trim();
        if (model.isEmpty()) {
            model = r.optString("요금제", "").trim();
        }
        String type = r.optString("개통유형", "").trim();
        StringBuilder sb = new StringBuilder(cust);
        if (!model.isEmpty()) {
            sb.append(" · ").append(model);
        }
        if (!type.isEmpty()) {
            sb.append(" · ").append(type);
        }
        return sb.toString();
    }

    private static void save(Context c, SharedPreferences prefs, JSONObject root, JSONObject months) {
        try {
            root.put("seeded", true);
            prefs.edit()
                    .putString("seen", root.toString())
                    .putString("months", months.toString())
                    .apply();
        } catch (Exception ignored) {
        }
    }

    // ────────────────────────────────────────────────────────── 도우미

    private static JSONObject parse(String raw) {
        if (raw == null || raw.isEmpty()) {
            return new JSONObject();
        }
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static JSONObject get(String base, String pin, String... kv) throws Exception {
        StringBuilder u = new StringBuilder(base);
        u.append(base.contains("?") ? "&" : "?");
        u.append("pin=").append(enc(pin));
        for (int i = 0; i + 1 < kv.length; i += 2) {
            u.append("&").append(enc(kv[i])).append("=").append(enc(kv[i + 1]));
        }
        u.append("&t=").append(System.currentTimeMillis());

        HttpURLConnection con = (HttpURLConnection) new URL(u.toString()).openConnection();
        con.setConnectTimeout(20000);
        con.setReadTimeout(30000);
        con.setInstanceFollowRedirects(true);
        con.setRequestProperty("Cache-Control", "no-store");
        try {
            int code = con.getResponseCode();
            InputStream in = code >= 400 ? con.getErrorStream() : con.getInputStream();
            if (in == null) {
                return null;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            in.close();
            return new JSONObject(new String(out.toByteArray(), "UTF-8"));
        } finally {
            con.disconnect();
        }
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s == null ? "" : s, "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    private static String nowMonth() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Seoul"));
        return f.format(new Date());
    }

    private static String prevMonth(String ym) {
        try {
            int y = Integer.parseInt(ym.substring(0, 4));
            int m = Integer.parseInt(ym.substring(5, 7)) - 1;
            if (m < 1) {
                m = 12;
                y -= 1;
            }
            return String.format(Locale.US, "%04d-%02d", y, m);
        } catch (Exception e) {
            return ym;
        }
    }

    /** 수정일시(ISO 8601 UTC)가 30분 안인가 — 이 기기에 없던 달의 새 건 판정 */
    private static boolean fresh(String stamp) {
        if (stamp == null || stamp.length() < 19) {
            return false;
        }
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date d = f.parse(stamp.substring(0, 19));
            return d != null && (System.currentTimeMillis() - d.getTime()) < FRESH_MS;
        } catch (Exception e) {
            return false;
        }
    }
}
