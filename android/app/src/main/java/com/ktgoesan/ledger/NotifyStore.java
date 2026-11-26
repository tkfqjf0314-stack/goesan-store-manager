package com.ktgoesan.ledger;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONObject;

/**
 * v2.1 — 관리자 새 개통 알림 보관함.
 *
 * <p>웹 장부(v82)가 관리자 PIN(0525)을 통과한 기기에서만 {@code setAdminNotify(true, …)} 로 켜고,
 * 이 클래스의 SharedPreferences 에 <b>켜짐 여부 · 주소 · 매장 PIN · 기기 · 기준선(seen)</b> 을 담아 둔다.
 * 앱을 닫아 둔 동안에는 {@link NotifyJobService} 가 이 값으로 조용히 확인해 알림을 띄운다.
 * (0525 를 한 번도 넣지 않은 직원 폰은 {@code enabled=false} 라 아무 알림도 울리지 않는다.)</p>
 */
final class NotifyStore {

    static final String PREF = "kt_notify_v1";
    static final String CHANNEL_ID = "store_alerts";
    static final String CHANNEL_NAME = "새 개통 알림";
    static final int JOB_ID = 8201;

    private static int notifySeq = 1000;

    private NotifyStore() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    static boolean enabled(Context c) {
        return prefs(c).getBoolean("enabled", false);
    }

    static String url(Context c) {
        return prefs(c).getString("url", "");
    }

    static String pin(Context c) {
        return prefs(c).getString("pin", "");
    }

    static String deviceId(Context c) {
        return prefs(c).getString("deviceId", "");
    }

    static String deviceName(Context c) {
        return prefs(c).getString("device", "");
    }

    /** 웹이 기준선({seeded, seen})을 JSON 문자열로 넘겨 준다 — 웹과 앱이 같은 기준을 쓴다. */
    static String seenJson(Context c) {
        return prefs(c).getString("seen", "");
    }

    static String monthsJson(Context c) {
        return prefs(c).getString("months", "");
    }

    /** setAdminNotify — 웹의 관리자 알림 설정을 그대로 받아 둔다. */
    static void setConfig(Context c, boolean on, String url, String pin, String deviceId, String name) {
        prefs(c).edit()
                .putBoolean("enabled", on)
                .putString("url", url == null ? "" : url)
                .putString("pin", pin == null ? "" : pin)
                .putString("deviceId", deviceId == null ? "" : deviceId)
                .putString("device", name == null ? "" : name)
                .apply();
        if (on) {
            createChannel(c);
            schedule(c);
        } else {
            cancel(c);
            clearNotifications(c);
        }
    }

    static void setSeenJson(Context c, String json) {
        if (json == null || json.isEmpty()) {
            return;
        }
        prefs(c).edit().putString("seen", json).apply();
    }

    /** 웹이 알림을 띄운 건 — 앱 기준선도 같이 맞춰 두 번 울리지 않게 한다. */
    static synchronized void markNotified(Context c, String id, String stamp) {
        if (id == null || id.isEmpty()) {
            return;
        }
        try {
            JSONObject root = parseRoot(seenJson(c));
            JSONObject map = root.optJSONObject("seen");
            if (map == null) {
                map = new JSONObject();
                root.put("seen", map);
            }
            map.put(id, stamp == null ? "" : stamp);
            root.put("seeded", true);
            prefs(c).edit().putString("seen", root.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static JSONObject parseRoot(String raw) {
        JSONObject root = new JSONObject();
        if (raw == null || raw.isEmpty()) {
            return root;
        }
        try {
            JSONObject d = new JSONObject(raw);
            if (d.optJSONObject("seen") == null) {
                d.put("seen", new JSONObject());
            }
            return d;
        } catch (Exception e) {
            return root;
        }
    }

    static void createChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return;
        }
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("새 개통 등록 · 개통 수정 알림 (관리자 인증 기기에서만)");
            ch.enableVibration(true);
            ch.setShowBadge(true);
            nm.createNotificationChannel(ch);
        }
    }

    /** 상단 알림 한 건 — 누르면 개통장부 앱이 열린다. */
    static void notifyNow(final Context c, final String title, final String body) {
        final String t = (title == null || title.trim().isEmpty()) ? "새 개통 알림" : title.trim();
        final String b = body == null ? "" : body.trim();
        createChannel(c);
        try {
            Intent intent = new Intent(c, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pending = PendingIntent.getActivity(c, 0, intent, flags);

            Notification.Builder nb;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nb = new Notification.Builder(c, CHANNEL_ID);
            } else {
                nb = new Notification.Builder(c);
                nb.setPriority(Notification.PRIORITY_HIGH);
                nb.setDefaults(Notification.DEFAULT_ALL);
            }
            nb.setSmallIcon(R.drawable.ic_stat_ledger)
                    .setContentTitle(t)
                    .setContentText(b)
                    .setStyle(new Notification.BigTextStyle().bigText(b))
                    .setWhen(System.currentTimeMillis())
                    .setShowWhen(true)
                    .setAutoCancel(true)
                    .setContentIntent(pending)
                    .setColor(0xFF0F4C81)
                    .setCategory(Notification.CATEGORY_MESSAGE);

            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                int id;
                synchronized (NotifyStore.class) {
                    id = ++notifySeq;
                }
                nm.notify(id, nb.build());
            }
        } catch (Exception ignored) {
        }
    }

    static void clearNotifications(Context c) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancelAll();
            }
        } catch (Exception ignored) {
        }
    }

    /**
     * 앱을 닫아 둔 동안의 확인 — JobScheduler 최소 주기(15분)로 건다.
     * 안드로이드가 절전(Doze)으로 묶으면 몇 분 더 늦을 수 있다.
     */
    static void schedule(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) {
                return;
            }
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(c, NotifyJobService.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(15 * 60 * 1000L)
                    .setPersisted(true)
                    .build();
            js.schedule(job);
        } catch (Exception ignored) {
        }
    }

    static void cancel(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js != null) {
                js.cancel(JOB_ID);
            }
        } catch (Exception ignored) {
        }
    }
}
