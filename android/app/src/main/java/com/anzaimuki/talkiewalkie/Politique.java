package com.anzaimuki.talkiewalkie;

import android.view.KeyEvent;

import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.regex.Pattern;

/** Règles de sécurité sans dépendance Android (testées sur la JVM). */
final class Politique {
    static final String HOTE_APP = "appassets.androidplatform.net";
    static final String URL_APP = "https://" + HOTE_APP + "/assets/index.html";

    private static final Pattern CANAL = Pattern.compile("^[A-Za-z0-9_\\-]{1,20}$");
    private static final Pattern IP = Pattern.compile("^(wss://)?[A-Za-z0-9.\\-\\[\\]:]{1,60}$");
    private static final Pattern CODE_PRO = Pattern.compile("^[A-Za-z0-9_\\-]{1,200}$");
    private static final Pattern LIEN_INVITATION = Pattern.compile("^https://anzaimuki\\.github\\.io(?:/[^?#]*)?(?:\\?([^#]*))?(?:#.*)?$");

    private Politique() {}

    /** Seules les pages embarquées sont chargées dans la WebView. */
    static boolean estPageApp(String url) {
        try {
            URI u = new URI(url);
            return "https".equals(u.getScheme()) && HOTE_APP.equals(u.getHost()) && u.getPort() == -1
                    && u.getPath() != null && u.getPath().startsWith("/assets/");
        } catch (Exception e) {
            return false;
        }
    }

    /** Liens ouverts dans le navigateur externe (WhatsApp, compte Google, page de mise à jour) : HTTPS uniquement. */
    static boolean estLienExterneAutorise(String url) {
        try {
            URI u = new URI(url);
            return "https".equals(u.getScheme()) && u.getHost() != null && !HOTE_APP.equals(u.getHost());
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Construit l'URL de démarrage à partir d'un lien d'invitation : seuls « canal », « ip » et « code »
     * sont repris, après validation. Tout autre paramètre est ignoré.
     */
    static String urlDemarrage(String lien) {
        if (lien == null) return URL_APP;
        // Analyse tolérante : un paramètre mal formé ne doit pas faire perdre les autres
        java.util.regex.Matcher m = LIEN_INVITATION.matcher(lien);
        if (!m.matches() || m.group(1) == null) return URL_APP;
        String requete = m.group(1);
        StringBuilder sb = new StringBuilder();
        for (String paire : requete.split("&")) {
            int i = paire.indexOf('=');
            if (i <= 0) continue;
            String cle = paire.substring(0, i);
            String val;
            try {
                val = URLDecoder.decode(paire.substring(i + 1), "UTF-8");
            } catch (Exception e) {
                continue;
            }
            boolean ok = ("canal".equals(cle) && CANAL.matcher(val).matches())
                    || ("ip".equals(cle) && IP.matcher(val).matches())
                    || ("code".equals(cle) && CODE_PRO.matcher(val).matches());
            if (!ok || sb.indexOf(cle + "=") >= 0) continue;
            try {
                sb.append(sb.length() == 0 ? '?' : '&').append(cle).append('=').append(URLEncoder.encode(val, "UTF-8"));
            } catch (java.io.UnsupportedEncodingException e) {
                throw new IllegalStateException(e);   // UTF-8 est toujours disponible
            }
        }
        return URL_APP + sb;
    }

    /** Boutons de casque / télécommande → action transmise à la page. null = ignoré. */
    static String actionTouche(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_HEADSETHOOK:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_NEXT:
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                return "bascule";
            case KeyEvent.KEYCODE_MEDIA_STOP:
                return "stop";
            default:
                return null;
        }
    }

    /** Échappe une chaîne pour l'insérer comme littéral JavaScript (evaluateJavascript). */
    static String litteralJs(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '<': sb.append("\\u003c"); break;
                case ' ': sb.append("\\u2028"); break;
                case ' ': sb.append("\\u2029"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
