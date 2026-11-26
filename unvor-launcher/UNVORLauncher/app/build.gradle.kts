plugins { id("com.android.application") }
android {
 namespace = "com.ultron.launcher"
 compileSdk = 35
 defaultConfig {
  applicationId = "com.ultron.launcher"
  minSdk = 29
  targetSdk = 35
  versionCode = 138
  versionName = "0.9.8-samsung116-turni-custom"
 }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_1_8; targetCompatibility = JavaVersion.VERSION_1_8 }
}

dependencies { implementation(files("libs/vosk-classes.jar", "libs/jna-classes.jar")) }
