# Les méthodes du pont WebView sont appelées par messages (addWebMessageListener), pas par réflexion :
# aucune règle @JavascriptInterface n'est nécessaire. Les bibliothèques fournissent leurs règles consommateur.
-keep class com.google.android.libraries.identity.googleid.** { *; }
