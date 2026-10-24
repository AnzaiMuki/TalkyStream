package com.anzaimuki.talkiewalkie;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import org.json.JSONObject;

import java.util.Locale;

/**
 * Pont page ↔ Android. Exposé par WebViewCompat.addWebMessageListener sous le nom « TWNative »,
 * restreint à l'origine https://appassets.androidplatform.net et au cadre principal.
 * Aucune méthode n'est accessible par réflexion (pas d'addJavascriptInterface).
 */
final class Pont implements WebViewCompat.WebMessageListener {
    private static final String TAG = "TWPont";
    static final String ORIGINE = "https://" + Politique.HOTE_APP;

    private final MainActivity act;
    private final CoffreSecrets coffre;
    private JavaScriptReplyProxy proxy;
    private TextToSpeech tts;
    private boolean ttsPret;
    private String[] ttsEnAttente;
    private int idNotif = 100;

    Pont(MainActivity act) {
        this.act = act;
        this.coffre = new CoffreSecrets(act);
    }

    @Override
    public void onPostMessage(@NonNull WebView view, @NonNull WebMessageCompat message, @NonNull Uri origine,
                              boolean cadrePrincipal, @NonNull JavaScriptReplyProxy reponse) {
        if (!cadrePrincipal || !ORIGINE.equals(origine.toString().replaceAll("/$", ""))) return;   // ceinture et bretelles
        proxy = reponse;
        int id = -1;
        try {
            JSONObject m = new JSONObject(message.getData());
            id = m.getInt("id");
            traiter(id, m.getString("cmd"), m.optJSONObject("args") == null ? new JSONObject() : m.getJSONObject("args"));
        } catch (Exception e) {
            if (BuildConfig.DEBUG) Log.w(TAG, "message rejeté", e);
            if (id >= 0) erreur(id, "requete", "Requête invalide");
        }
    }

    private void traiter(int id, String cmd, JSONObject a) throws Exception {
        switch (cmd) {
            case "hello": {
                JSONObject c = new JSONObject()
                        .put("version", BuildConfig.VERSION_NAME)
                        .put("debug", BuildConfig.DEBUG)
                        .put("publicUrl", BuildConfig.PUBLIC_URL)
                        .put("updateUrl", BuildConfig.UPDATE_URL)
                        .put("turnUrl", BuildConfig.TURN_SERVICE_URL)
                        .put("googleConfigure", !BuildConfig.GOOGLE_WEB_CLIENT_ID.isEmpty());
                if (BuildConfig.DEBUG) c.put("encartHaut", act.vueRacine().getPaddingTop());   // outils de capture (debug)
                ok(id, c);
                break;
            }
            case "session":
                act.definirSession(a.optBoolean("actif"), a.optString("canal", ""), a.optBoolean("micro"));
                ok(id, null);
                break;
            case "secretGet":
                ok(id, coffre.lire(nomSecret(a)));
                break;
            case "secretSet": {
                String v = a.optString("valeur", "");
                if (v.length() > 8192) { erreur(id, "taille", "Valeur trop longue"); return; }
                coffre.ecrire(nomSecret(a), v);
                ok(id, null);
                break;
            }
            case "theme":
                act.appliquerTheme(a.optBoolean("sombre"));
                ok(id, null);
                break;
            case "share": {
                String texte = a.optString("texte", "") + "\n" + a.optString("url", "");
                Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, texte.trim());
                act.startActivity(Intent.createChooser(i, act.getString(R.string.partager)));
                ok(id, null);
                break;
            }
            case "openUrl": {
                String url = a.optString("url", "");
                if (!Politique.estLienExterneAutorise(url)) { erreur(id, "url", "Lien refusé"); return; }
                act.ouvrirExterne(url);
                ok(id, null);
                break;
            }
            case "speak":
                parler(a.optString("texte", ""), a.optString("langue", "fr-FR"));
                ok(id, null);
                break;
            case "notify":
                notifier(a.optString("type", ""), a.optString("titre", ""), a.optString("texte", ""));
                ok(id, null);
                break;
            case "googleSignIn":
                connexionGoogle(id);
                break;
            case "googleSignOut":
                CredentialManager.create(act).clearCredentialStateAsync(new ClearCredentialStateRequest(), new CancellationSignal(),
                        ContextCompat.getMainExecutor(act), new CredentialManagerCallback<Void, ClearCredentialException>() {
                            @Override public void onResult(Void r) { ok(id, null); }
                            @Override public void onError(@NonNull ClearCredentialException e) { erreur(id, "google", e.getClass().getSimpleName()); }
                        });
                break;
            default:
                erreur(id, "inconnu", "Commande inconnue");
        }
    }

    /** Seul l'emplacement « turn » existe : la page ne peut pas lire d'autres entrées du coffre. */
    private static String nomSecret(JSONObject a) {
        String n = a.optString("cle", "");
        if (!"turn".equals(n)) throw new IllegalArgumentException("secret inconnu");
        return n;
    }

    private void connexionGoogle(int id) {
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_WEB_CLIENT_ID).build();
        GetCredentialRequest req = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        CredentialManager.create(act).getCredentialAsync(act, req, new CancellationSignal(), ContextCompat.getMainExecutor(act),
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override
                    public void onResult(GetCredentialResponse r) {
                        Credential c = r.getCredential();
                        if (c instanceof CustomCredential && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                            try {
                                ok(id, GoogleIdTokenCredential.createFrom(c.getData()).getIdToken());   // jeton jamais journalisé
                            } catch (Exception e) {
                                erreur(id, "google", "Jeton Google illisible");
                            }
                        } else erreur(id, "google", "Type d'identifiant inattendu");
                    }

                    @Override
                    public void onError(@NonNull GetCredentialException e) {
                        if (e instanceof GetCredentialCancellationException) erreur(id, "annule", "Annulé");
                        else if (e instanceof NoCredentialException) erreur(id, "google", "Aucun compte Google disponible sur cet appareil");
                        else erreur(id, "google", "Connexion Google impossible (" + e.getClass().getSimpleName() + ")");
                    }
                });
    }

    private void parler(String texte, String langue) {
        if (tts == null) {
            tts = new TextToSpeech(act, s -> {
                ttsPret = s == TextToSpeech.SUCCESS;
                if (ttsPret && ttsEnAttente != null) { parler(ttsEnAttente[0], ttsEnAttente[1]); ttsEnAttente = null; }
            });
        }
        if (!ttsPret) { ttsEnAttente = new String[]{texte, langue}; return; }
        if (texte.isEmpty()) { tts.stop(); return; }
        tts.setLanguage(Locale.forLanguageTag(langue));
        tts.setSpeechRate(1.1f);
        tts.speak(texte.length() > 300 ? texte.substring(0, 300) : texte, TextToSpeech.QUEUE_FLUSH, null, "tw");
    }

    private void notifier(String type, String titre, String texte) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(act, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        PendingIntent ouvrir = PendingIntent.getActivity(act, 0, new Intent(act, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(act, TalkieService.CANAL_ALERTES)
                .setSmallIcon(R.drawable.ic_notif)
                .setContentTitle(titre.length() > 60 ? titre.substring(0, 60) : titre)
                .setContentText(texte.length() > 160 ? texte.substring(0, 160) : texte)
                .setContentIntent(ouvrir)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)   // contenu masqué sur l'écran verrouillé
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory("appel".equals(type) ? NotificationCompat.CATEGORY_CALL : NotificationCompat.CATEGORY_MESSAGE);
        try {
            NotificationManagerCompat.from(act).notify("appel".equals(type) ? 2 : ++idNotif, b.build());
        } catch (SecurityException ignore) { }
    }

    /** Événement natif → page (boutons du casque, actions de la notification). */
    void evenement(String evt, String donnee) {
        if (proxy == null) return;
        try {
            JSONObject m = new JSONObject().put("evt", evt);
            if (donnee != null) m.put("data", donnee);
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) proxy.postMessage(m.toString());
        } catch (Exception e) {
            if (BuildConfig.DEBUG) Log.w(TAG, "événement non transmis", e);
        }
    }

    private void ok(int id, Object data) {
        repondre(id, true, data, null, null);
    }

    private void erreur(int id, String code, String msg) {
        repondre(id, false, null, code, msg);
    }

    private void repondre(int id, boolean ok, Object data, String code, String msg) {
        if (proxy == null) return;
        try {
            JSONObject m = new JSONObject().put("id", id).put("ok", ok);
            if (data != null) m.put("data", data);
            if (code != null) m.put("code", code).put("err", msg);
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) proxy.postMessage(m.toString());
        } catch (Exception ignore) { }
    }

    void fermer() {
        if (tts != null) tts.shutdown();
        tts = null;
    }
}
