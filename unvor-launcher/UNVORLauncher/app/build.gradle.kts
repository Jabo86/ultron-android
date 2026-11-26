plugins { id("com.android.application") }
android {
 namespace = "com.ultron.launcher"
 compileSdk = 35
 defaultConfig {
  applicationId = "com.ultron.launcher"
  minSdk = 29
  targetSdk = 35
  versionCode = 135
  versionName = "0.9.5-original116-ai-news-study"
 }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_1_8; targetCompatibility = JavaVersion.VERSION_1_8 }
}

dependencies { implementation(files("libs/vosk-classes.jar", "libs/jna-classes.jar")) }
