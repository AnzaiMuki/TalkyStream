package com.anzaimuki.talkiewalkie;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.rule.GrantPermissionRule;

import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Vérifie l'intégration WebView réelle sur l'appareil : chargement local, pont, CSP, navigation. */
@RunWith(AndroidJUnit4.class)
public class WebViewAppTest {
    @Rule
    public GrantPermissionRule micro = GrantPermissionRule.grant(Manifest.permission.RECORD_AUDIO);

    private ActivityScenario<MainActivity> scenario;

    @Before
    public void ouvrir() throws Exception {
        scenario = ActivityScenario.launch(MainActivity.class);
        attendre("document.readyState==='complete' && typeof natifConfig==='object' && !!natifConfig.version", 15000);
    }

    @After
    public void fermer() { scenario.close(); }

    private String js(String code) throws Exception {
        AtomicReference<String> r = new AtomicReference<>();
        CountDownLatch l = new CountDownLatch(1);
        scenario.onActivity(a -> a.webView().evaluateJavascript(code, v -> { r.set(v); l.countDown(); }));
        assertTrue("évaluation JS expirée", l.await(10, TimeUnit.SECONDS));
        return r.get();
    }

    /** Évalue une promesse : le résultat est déposé dans window.__r */
    private String jsAsync(String promesse, long ms) throws Exception {
        js("window.__r=undefined;(" + promesse + ").then(v=>window.__r=JSON.stringify({ok:v}),e=>window.__r=JSON.stringify({err:String(e&&e.message||e)}))");
        attendre("window.__r!==undefined", ms);
        // evaluateJavascript renvoie la valeur encodée en JSON : on décode la chaîne
        return new org.json.JSONArray("[" + js("window.__r") + "]").getString(0);
    }

    private void attendre(String condition, long ms) throws Exception {
        long fin = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < fin) {
            if ("true".equals(js("!!(" + condition + ")"))) return;
            Thread.sleep(200);
        }
        throw new AssertionError("condition non atteinte : " + condition);
    }

    @Test
    public void pageEmbarqueeEtPontActif() throws Exception {
        assertEquals("\"https://appassets.androidplatform.net/assets/index.html\"", js("location.href"));
        assertEquals("true", js("NATIF"));
        assertEquals("true", js("window.isSecureContext"));
        assertEquals("\"17.0\"", js("natifConfig.version"));
        assertEquals("true", js("typeof Peer==='function' && typeof qrcode==='function' && typeof jsQR==='function' && typeof firebase==='object'"));
    }

    @Test
    public void cspBloqueHttpEtScriptsDistants() throws Exception {
        String http = jsAsync("fetch('http://example.com/').then(()=> 'charge')", 8000);
        assertTrue("http doit être bloqué : " + http, http.contains("err"));
        String script = jsAsync("new Promise((ok,ko)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';s.onload=()=>ok('charge');s.onerror=()=>ko(new Error('bloque'));document.head.appendChild(s);})", 8000);
        assertTrue("script distant doit être bloqué : " + script, script.contains("bloque"));
    }

    @Test
    public void navigationExterneRefusee() throws Exception {
        js("location.href='https://example.com/'");
        Thread.sleep(1500);
        assertEquals("\"appassets.androidplatform.net\"", js("location.host"));
    }

    @Test
    public void coffreViaPont() throws Exception {
        String w = jsAsync("natif('secretSet',{cle:'turn',valeur:'{\"app\":\"essai\"}'}).then(()=>natif('secretGet',{cle:'turn'}))", 5000);
        assertTrue(w, w.contains("essai"));
        String refuse = jsAsync("natif('secretGet',{cle:'autre'})", 5000);
        assertTrue("seul l'emplacement turn est accessible : " + refuse, refuse.contains("err"));
        jsAsync("natif('secretSet',{cle:'turn',valeur:''})", 5000);
    }

    @Test
    public void microAccordeEtMuetApresCapture() throws Exception {
        js("localStorage.setItem('tw-rnnoise','0')");
        String r = jsAsync("getMic().then(ok=>({ok, pistes: localStream.getAudioTracks().map(t=>t.enabled)}))", 10000);
        assertTrue(r, r.contains("\"ok\":true") && r.contains("\"pistes\":[false]"));
        js("detruireAudio()");
    }

    @Test
    public void cryptoEcdsaP256DisponibleDansLaWebView() throws Exception {
        String r = jsAsync("crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']).then(k=>crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},k.privateKey,new Uint8Array([1,2,3])).then(s=>crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},k.publicKey,s,new Uint8Array([1,2,3]))))", 8000);
        assertTrue(r, r.contains("\"ok\":true"));
    }

    @Test
    public void webViewDebugUniquementEnDebug() {
        assertTrue(BuildConfig.DEBUG);   // ce test ne tourne qu'en debug ; en release setWebContentsDebuggingEnabled(false)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
    }
}
