import java.util.Properties

plugins {
    id("com.android.application")
}

// Valeurs de configuration lues dans local.properties puis gradle.properties (jamais de secret ici)
val locales = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun config(cle: String, defaut: String = ""): String =
    (locales.getProperty(cle) ?: providers.gradleProperty(cle).orNull ?: defaut).trim()
fun chaine(v: String) = "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.anzaimuki.talkiewalkie"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.anzaimuki.talkiewalkie"
        minSdk = 26
        targetSdk = 36
        versionCode = 17          // aligné sur APP_VERSION de web/index.html
        versionName = "17.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", chaine(config("tw.googleWebClientId")))
        buildConfigField("String", "TURN_SERVICE_URL", chaine(config("tw.turnServiceUrl")))
        buildConfigField("String", "PUBLIC_URL", chaine(config("tw.publicUrl", "https://anzaimuki.github.io/TalkyStream/")))
        buildConfigField("String", "UPDATE_URL", chaine(config("tw.updateUrl", "https://github.com/AnzaiMuki/TalkyStream/releases/latest")))
    }

    buildFeatures { buildConfig = true }

    // L'interface est le fichier web/index.html et ses dépendances embarquées (source unique)
    sourceSets["main"].assets.srcDirs("../../web")
    // Debug uniquement : le HTML de référence non modifié, pour la comparaison visuelle dans la même WebView
    sourceSets["debug"].assets.srcDirs(layout.buildDirectory.dir("generated/reference-assets"))

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Pas de signingConfig : aucune clé de production n'est disponible ici (voir docs/INSTALLATION.md)
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions { unitTests.isReturnDefaultValues = true }
    lint { abortOnError = true; warningsAsErrors = false; checkReleaseBuilds = true }
}

val copierReference = tasks.register<Copy>("copierReference") {
    from(rootProject.file("../talkie-walkie-final3.html")) { rename { "index.html" } }
    // Les identifiants TURN codés en dur dans l'original ne doivent jamais se retrouver dans un APK
    filter { ligne: String ->
        ligne.replace(Regex("""^(const (EXPRESS|METERED)_(USER|PASS) = )'[^']*';"""), "$1'';")
    }
    into(layout.buildDirectory.dir("generated/reference-assets/reference"))
}
tasks.matching { it.name == "mergeDebugAssets" || it.name == "generateDebugLintReportModel" || it.name == "lintAnalyzeDebug" }
    .configureEach { dependsOn(copierReference) }

dependencies {
    implementation("androidx.core:core:1.15.0")
    implementation("androidx.activity:activity:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    testImplementation("junit:junit:4.13.2")

    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
}
