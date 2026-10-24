package com.anzaimuki.talkiewalkie;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Stockage des réglages sensibles (identifiants TURN, clé API Metered) chiffrés en AES-256-GCM
 * avec une clé non exportable de l'Android Keystore. Aucune cryptographie maison : primitives JCA standard.
 */
final class CoffreSecrets {
    private static final String ALIAS = "tw-secrets-v1";
    private static final String FICHIER = "tw-secrets";
    private final SharedPreferences prefs;

    CoffreSecrets(Context ctx) {
        prefs = ctx.getSharedPreferences(FICHIER, Context.MODE_PRIVATE);
    }

    private static SecretKey cle() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)   // IV aléatoire imposé par le Keystore
                .build());
        return kg.generateKey();
    }

    void ecrire(String nom, String valeur) throws Exception {
        if (valeur == null || valeur.isEmpty()) {
            prefs.edit().remove(nom).apply();
            return;
        }
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, cle());
        c.updateAAD(nom.getBytes(StandardCharsets.UTF_8));   // lie le chiffré à son nom : pas d'échange entre entrées
        byte[] iv = c.getIV();
        byte[] ct = c.doFinal(valeur.getBytes(StandardCharsets.UTF_8));
        String enc = Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
        prefs.edit().putString(nom, enc).apply();
    }

    /** Renvoie null si absent ou illisible (clé effacée, données altérées : le tag GCM échoue). */
    String lire(String nom) {
        String enc = prefs.getString(nom, null);
        if (enc == null) return null;
        try {
            String[] p = enc.split(":", 2);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, cle(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
            c.updateAAD(nom.getBytes(StandardCharsets.UTF_8));
            return new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            prefs.edit().remove(nom).apply();
            return null;
        }
    }

    /** Valeur brute stockée (pour les tests : vérifier que rien n'est en clair). */
    String brut(String nom) {
        return prefs.getString(nom, null);
    }
}
