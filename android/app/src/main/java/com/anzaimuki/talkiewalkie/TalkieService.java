package com.anzaimuki.talkiewalkie;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.view.KeyEvent;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import java.lang.ref.WeakReference;

/**
 * Service de premier plan actif UNIQUEMENT pendant une session (canal ou liaison directe) :
 * garde l'audio WebRTC vivant écran éteint, affiche l'état du micro et reçoit les boutons du casque.
 * Remplace l'« astuce du son silencieux » et le Wake Lock d'écran de la version web.
 */
public class TalkieService extends Service {
    static final String ACTION_MAJ = "maj", ACTION_MICRO_OFF = "micOff", ACTION_QUITTER = "quitter", ACTION_ARRET = "arret";
    static final String CANAL_SESSION = "session", CANAL_ALERTES = "alertes";
    private static final int ID_NOTIF = 1;

    /** Reçoit les commandes à transmettre à la page (l'activité s'enregistre). */
    interface Ecouteur { void evenement(String evt, String donnee); }
    private static WeakReference<Ecouteur> ecouteur = new WeakReference<>(null);
    static void definirEcouteur(Ecouteur e) { ecouteur = new WeakReference<>(e); }

    private MediaSession session;
    private PowerManager.WakeLock verrouCpu;
    private WifiManager.WifiLock verrouWifi;

    static void maj(Context ctx, String canal, boolean micro) {
        Intent i = new Intent(ctx, TalkieService.class).setAction(ACTION_MAJ)
                .putExtra("canal", canal).putExtra("micro", micro);
        ctx.startForegroundService(i);
    }

    static void arreter(Context ctx) {
        ctx.stopService(new Intent(ctx, TalkieService.class));
    }

    static void creerCanaux(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel s = new NotificationChannel(CANAL_SESSION, ctx.getString(R.string.canal_session), NotificationManager.IMPORTANCE_LOW);
        s.setShowBadge(false);
        NotificationChannel a = new NotificationChannel(CANAL_ALERTES, ctx.getString(R.string.canal_alertes), NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(s);
        nm.createNotificationChannel(a);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        creerCanaux(this);
        session = new MediaSession(this, "TalkieWalkie");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public boolean onMediaButtonEvent(Intent intent) {
                KeyEvent ev = androidx.core.content.IntentCompat.getParcelableExtra(intent, Intent.EXTRA_KEY_EVENT, KeyEvent.class);
                if (ev == null || ev.getAction() != KeyEvent.ACTION_DOWN || ev.getRepeatCount() > 0) return true;
                String action = Politique.actionTouche(ev.getKeyCode());
                if (action != null) transmettre("media", action);
                return true;
            }
        });
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_STOP)
                .setState(PlaybackState.STATE_PLAYING, 0, 1f).build());
        session.setActive(true);

        // CPU et Wi-Fi maintenus pendant la session seulement (communication temps réel), libérés à l'arrêt
        PowerManager pm = getSystemService(PowerManager.class);
        verrouCpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TalkieWalkie:session");
        verrouCpu.setReferenceCounted(false);
        verrouCpu.acquire(12 * 60 * 60 * 1000L);   // borne de sécurité : 12 h
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        verrouWifi = wm.createWifiLock(Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF, "TalkieWalkie:session");
        verrouWifi.setReferenceCounted(false);
        verrouWifi.acquire();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_MICRO_OFF.equals(action)) { transmettre("micOff", null); return START_NOT_STICKY; }
        if (ACTION_QUITTER.equals(action)) { transmettre("quitter", null); return START_NOT_STICKY; }
        if (ACTION_ARRET.equals(action) || intent == null) { stopSelf(); return START_NOT_STICKY; }
        String canal = intent.getStringExtra("canal");
        boolean micro = intent.getBooleanExtra("micro", false);
        int type = Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
        ServiceCompat.startForeground(this, ID_NOTIF, notification(canal == null ? "" : canal, micro), type);
        return START_NOT_STICKY;   // jamais relancé seul : sans la page, il n'y a plus de session
    }

    private Notification notification(String canal, boolean micro) {
        PendingIntent ouvrir = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CANAL_SESSION)
                .setSmallIcon(R.drawable.ic_notif)
                .setContentTitle(getString(R.string.notif_connecte, canal))
                .setContentText(getString(micro ? R.string.notif_micro_ouvert : R.string.notif_micro_coupe))
                .setContentIntent(ouvrir)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        if (micro) b.addAction(0, getString(R.string.action_couper), action(ACTION_MICRO_OFF, 1));
        b.addAction(0, getString(R.string.action_quitter), action(ACTION_QUITTER, 2));
        return b.build();
    }

    private PendingIntent action(String a, int code) {
        return PendingIntent.getService(this, code, new Intent(this, TalkieService.class).setAction(a),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void transmettre(String evt, String donnee) {
        Ecouteur e = ecouteur.get();
        if (e != null) e.evenement(evt, donnee);
        else stopSelf();   // plus de page : la session n'existe plus
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();   // l'utilisateur a fermé l'app depuis les tâches récentes : la session se termine
    }

    @Override
    public void onDestroy() {
        if (session != null) { session.setActive(false); session.release(); }
        if (verrouCpu != null && verrouCpu.isHeld()) verrouCpu.release();
        if (verrouWifi != null && verrouWifi.isHeld()) verrouWifi.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
