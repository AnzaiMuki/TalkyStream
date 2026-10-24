package com.anzaimuki.talkiewalkie;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class CoffreSecretsTest {
    private final Context ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test
    public void allerRetourChiffre() throws Exception {
        CoffreSecrets c = new CoffreSecrets(ctx);
        String secret = "{\"app\":\"monapp\",\"cle\":\"CLE-SECRETE-123456\"}";
        c.ecrire("test", secret);
        assertEquals(secret, c.lire("test"));
        String brut = c.brut("test");
        assertNotNull(brut);
        assertFalse("le secret ne doit pas être stocké en clair", brut.contains("CLE-SECRETE"));
        c.ecrire("test", "");
        assertNull(c.lire("test"));
    }

    @Test
    public void ivAleatoire() throws Exception {
        CoffreSecrets c = new CoffreSecrets(ctx);
        c.ecrire("test", "identique");
        String a = c.brut("test");
        c.ecrire("test", "identique");
        assertNotEquals("deux chiffrements identiques révéleraient le contenu", a, c.brut("test"));
    }

    @Test
    public void donneesAltereesRejetees() throws Exception {
        CoffreSecrets c = new CoffreSecrets(ctx);
        c.ecrire("test", "valeur");
        String brut = c.brut("test");
        char dernier = brut.charAt(brut.length() - 2);
        String altere = brut.substring(0, brut.length() - 2) + (dernier == 'A' ? 'B' : 'A') + brut.charAt(brut.length() - 1);
        ctx.getSharedPreferences("tw-secrets", Context.MODE_PRIVATE).edit().putString("test", altere).commit();
        assertNull("le tag GCM doit rejeter un chiffré modifié", c.lire("test"));
    }

    @Test
    public void chiffreLieASonNom() throws Exception {
        CoffreSecrets c = new CoffreSecrets(ctx);
        c.ecrire("a", "secret-a");
        ctx.getSharedPreferences("tw-secrets", Context.MODE_PRIVATE).edit().putString("b", c.brut("a")).commit();
        assertNull("un chiffré déplacé sous un autre nom doit être rejeté (AAD)", c.lire("b"));
        c.ecrire("a", "");
    }
}
