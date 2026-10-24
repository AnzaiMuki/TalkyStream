package com.anzaimuki.talkiewalkie;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.view.KeyEvent;

import org.junit.Test;

public class PolitiqueTest {

    @Test
    public void seulesLesPagesEmbarqueesSontChargees() {
        assertTrue(Politique.estPageApp("https://appassets.androidplatform.net/assets/index.html"));
        assertTrue(Politique.estPageApp("https://appassets.androidplatform.net/assets/index.html?canal=AB12"));
        assertFalse(Politique.estPageApp("http://appassets.androidplatform.net/assets/index.html"));
        assertFalse(Politique.estPageApp("https://appassets.androidplatform.net.evil.com/assets/index.html"));
        assertFalse(Politique.estPageApp("https://appassets.androidplatform.net:8443/assets/index.html"));
        assertFalse(Politique.estPageApp("https://appassets.androidplatform.net/res/x"));
        assertFalse(Politique.estPageApp("file:///android_asset/index.html"));
        assertFalse(Politique.estPageApp("javascript:alert(1)"));
        assertFalse(Politique.estPageApp("https://evil.com/assets/index.html"));
    }

    @Test
    public void liensExternesHttpsUniquement() {
        assertTrue(Politique.estLienExterneAutorise("https://wa.me/229000?text=x"));
        assertTrue(Politique.estLienExterneAutorise("https://github.com/AnzaiMuki/TalkyStream/releases/latest"));
        assertFalse(Politique.estLienExterneAutorise("http://example.com"));
        assertFalse(Politique.estLienExterneAutorise("intent://scan#Intent;end"));
        assertFalse(Politique.estLienExterneAutorise("file:///sdcard/x"));
        assertFalse(Politique.estLienExterneAutorise("javascript:alert(1)"));
        assertFalse(Politique.estLienExterneAutorise("https://appassets.androidplatform.net/assets/index.html"));
    }

    @Test
    public void invitationFiltree() {
        String base = Politique.URL_APP;
        assertEquals(base + "?canal=AB12CD", Politique.urlDemarrage("https://anzaimuki.github.io/TalkyStream/?canal=AB12CD"));
        assertEquals(base + "?canal=1234&ip=192.168.1.5%3A9000", Politique.urlDemarrage("https://anzaimuki.github.io/TalkyStream/?canal=1234&ip=192.168.1.5:9000"));
        // paramètres inconnus, injection, doublons et hôtes étrangers ignorés
        assertEquals(base + "?canal=1234", Politique.urlDemarrage("https://anzaimuki.github.io/TalkyStream/?canal=1234&canal=9999&x=<script>"));
        assertEquals(base, Politique.urlDemarrage("https://anzaimuki.github.io/TalkyStream/?canal=%3Cimg%20src%3Dx%3E"));
        assertEquals(base, Politique.urlDemarrage("https://evil.example/TalkyStream/?canal=1234"));
        assertEquals(base, Politique.urlDemarrage("http://anzaimuki.github.io/TalkyStream/?canal=1234"));
        assertEquals(base, Politique.urlDemarrage(null));
        assertEquals(base, Politique.urlDemarrage("::invalide::"));
    }

    @Test
    public void touchesMedia() {
        assertEquals("bascule", Politique.actionTouche(KeyEvent.KEYCODE_HEADSETHOOK));
        assertEquals("bascule", Politique.actionTouche(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE));
        assertEquals("bascule", Politique.actionTouche(KeyEvent.KEYCODE_MEDIA_NEXT));
        assertEquals("stop", Politique.actionTouche(KeyEvent.KEYCODE_MEDIA_STOP));
        assertNull(Politique.actionTouche(KeyEvent.KEYCODE_VOLUME_UP));
    }

    @Test
    public void litteralJsSansEchappementPossible() {
        assertEquals("\"a\\\"b\\\\c\\n\\u003c/script>\"", Politique.litteralJs("a\"b\\c\n</script>"));
        assertEquals("\"\\u2028\"", Politique.litteralJs("\u2028"));
    }
}
