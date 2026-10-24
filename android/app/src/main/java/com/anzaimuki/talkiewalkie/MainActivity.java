package com.anzaimuki.talkiewalkie;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

public class MainActivity extends ComponentActivity implements TalkieService.Ecouteur {
    private static final String TAG = "TalkieWalkie";

    private FrameLayout racine;
    private WebView web;
    private Pont pont;
    private WebViewAssetLoader chargeur;
    private boolean sessionActive;
    private PermissionRequest demandeWeb;
    private ActivityResultLauncher<String[]> lanceurPermissions;
    private SharedPreferences ui;

    @Override
    protected void onCreate(Bundle etat) {
        super.onCreate(etat);
        ui = getSharedPreferences("tw-ui", MODE_PRIVATE);
        TalkieService.creerCanaux(this);
        TalkieService.definirEcouteur(this);
        lanceurPermissions = registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), this::resultatPermissions);

        // Plein écran bord à bord : les barres système sont compensées par un padding (la page garde ses marges CSS)
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        racine = new FrameLayout(this);
        ViewCompat.setOnApplyWindowInsetsListener(racine, (v, ins) -> {
            Insets b = ins.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets clavier = ins.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(b.left, b.top, b.right, Math.max(b.bottom, clavier.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        setContentView(racine);
        appliquerTheme(ui.getBoolean("sombre", false));

        creerWebView();
        Uri lien = getIntent().getData();
        web.loadUrl(Politique.urlDemarrage(lien == null ? null : lien.toString()));

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                web.evaluateJavascript("typeof twRetour==='function'&&twRetour()", v -> {
                    if ("true".equals(v)) return;
                    if (sessionActive) moveTaskToBack(true);   // la session continue en arrière-plan
                    else finish();
                });
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void creerWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);   // inspection DevTools en debug uniquement
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        racine.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // le son reçu doit jouer sans toucher l'écran
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);   // rendu identique au HTML de référence (la taille système ne déforme pas la mise en page)
        // ws:// n'est utilisé que par le mode Local (serveur PeerJS du réseau privé, adresse vérifiée en JS) ;
        // la CSP de la page interdit http: et tout script/média distant.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) androidx.webkit.WebSettingsCompat.setSafeBrowsingEnabled(s, true);

        chargeur = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        pont = new Pont(this);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "TWNative", Collections.singleton(Pont.ORIGINE), pont);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return chargeur.shouldInterceptRequest(r.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String url = r.getUrl().toString();
                if (Politique.estPageApp(url)) return false;
                if (r.hasGesture() && Politique.estLienExterneAutorise(url)) ouvrirExterne(url);
                return true;   // aucune autre page ne s'ouvre dans l'app
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                // Le moteur de rendu a planté (mémoire) : on reconstruit proprement au lieu de faire planter l'app
                Log.e(TAG, "moteur WebView arrêté, crash=" + d.didCrash());
                definirSession(false, "", false);
                racine.removeView(web);
                web.destroy();
                Toast.makeText(MainActivity.this, R.string.erreur_rendu, Toast.LENGTH_LONG).show();
                creerWebView();
                web.loadUrl(Politique.URL_APP);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest r) {
                runOnUiThread(() -> demanderPermissionsWeb(r));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest r) {
                if (demandeWeb == r) demandeWeb = null;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                if (BuildConfig.DEBUG) Log.d(TAG, "console: " + m.message());
                return true;   // en release, rien de la console (pseudos, canaux…) ne part dans logcat
            }

            @Override
            public boolean onJsAlert(WebView v, String url, String message, JsResult res) {
                new AlertDialog.Builder(MainActivity.this).setTitle(R.string.app_name).setMessage(message)
                        .setPositiveButton(R.string.ok, (d, w) -> res.confirm())
                        .setOnCancelListener(d -> res.confirm()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView v, String url, String message, JsResult res) {
                new AlertDialog.Builder(MainActivity.this).setTitle(R.string.app_name).setMessage(message)
                        .setPositiveButton(R.string.ok, (d, w) -> res.confirm())
                        .setNegativeButton(R.string.annuler, (d, w) -> res.cancel())
                        .setOnCancelListener(d -> res.cancel()).show();
                return true;
            }
        });
    }

    // ===== Permissions micro / caméra demandées par la page =====
    private void demanderPermissionsWeb(PermissionRequest r) {
        if (!Pont.ORIGINE.equals(r.getOrigin().toString().replaceAll("/$", ""))) { r.deny(); return; }
        List<String> android = new ArrayList<>();
        for (String res : r.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) android.add(Manifest.permission.RECORD_AUDIO);
            else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) android.add(Manifest.permission.CAMERA);
            else { r.deny(); return; }   // toute autre ressource (MIDI, DRM…) est refusée
        }
        List<String> manquantes = new ArrayList<>();
        for (String p : android) if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) manquantes.add(p);
        if (manquantes.isEmpty()) { r.grant(r.getResources()); return; }
        if (demandeWeb != null) demandeWeb.deny();
        demandeWeb = r;
        lanceurPermissions.launch(manquantes.toArray(new String[0]));
    }

    private void resultatPermissions(Map<String, Boolean> res) {
        PermissionRequest r = demandeWeb;
        demandeWeb = null;
        if (r == null) return;
        List<String> accordees = new ArrayList<>();
        for (String ressource : r.getResources()) {
            String p = PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(ressource) ? Manifest.permission.RECORD_AUDIO : Manifest.permission.CAMERA;
            if (ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED) accordees.add(ressource);
            else Toast.makeText(this, p.equals(Manifest.permission.CAMERA) ? R.string.permission_camera_refusee : R.string.permission_micro_refusee, Toast.LENGTH_LONG).show();
        }
        if (accordees.size() == r.getResources().length) r.grant(r.getResources());
        else r.deny();
    }

    // ===== Session (appelé par le pont) =====
    void definirSession(boolean actif, String canal, boolean micro) {
        if (actif) {
            if (!sessionActive && Build.VERSION.SDK_INT >= 33
                    && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                lanceurPermissions.launch(new String[]{Manifest.permission.POST_NOTIFICATIONS});
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                try {
                    TalkieService.maj(this, canal, micro);
                } catch (Exception e) {
                    Log.w(TAG, "service de premier plan refusé", e);   // ex. démarrage interdit en arrière-plan
                }
            }
            setVolumeControlStream(AudioManager.STREAM_VOICE_CALL);
        } else if (sessionActive) {
            TalkieService.arreter(this);
            setVolumeControlStream(AudioManager.USE_DEFAULT_STREAM_TYPE);
        }
        sessionActive = actif;
    }

    void appliquerTheme(boolean sombre) {
        ui.edit().putBoolean("sombre", sombre).apply();
        int fond = ContextCompat.getColor(this, sombre ? R.color.corps_sombre : R.color.corps);
        racine.setBackgroundColor(fond);
        getWindow().getDecorView().setBackgroundColor(fond);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setAppearanceLightStatusBars(!sombre);
        c.setAppearanceLightNavigationBars(!sombre);
    }

    void ouvrirExterne(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException ignore) { }
    }

    @Override
    public void evenement(String evt, String donnee) {
        runOnUiThread(() -> { if (pont != null) pont.evenement(evt, donnee); });
    }

    @Override
    protected void onNewIntent(@NonNull Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri lien = intent.getData();
        if (lien == null) return;
        String url = Politique.urlDemarrage(lien.toString());
        if (url.equals(Politique.URL_APP)) return;
        if (sessionActive) {
            // Session en cours : la page demande confirmation avant de changer de canal
            String q = url.substring(Politique.URL_APP.length());
            web.evaluateJavascript("typeof traiterInvitation==='function'&&traiterInvitation(" + Politique.litteralJs(BuildConfig.PUBLIC_URL + q) + ")", null);
        } else web.loadUrl(url);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        // Sans session, la page est mise en pause ; pendant une session elle doit continuer (audio, signalisation)
        if (web != null && !sessionActive) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        TalkieService.definirEcouteur(null);
        if (sessionActive) TalkieService.arreter(this);
        if (pont != null) pont.fermer();
        if (web != null) {
            racine.removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }

    /** Pour les tests instrumentés. */
    WebView webView() { return web; }
    boolean sessionActive() { return sessionActive; }
    View vueRacine() { return racine; }
}
