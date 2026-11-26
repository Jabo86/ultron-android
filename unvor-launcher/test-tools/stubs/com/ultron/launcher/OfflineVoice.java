package com.ultron.launcher;
import android.content.Context;
/** CI-only Java stub; real Vosk OfflineVoice.java is compiled in the APK. */
public final class OfflineVoice {
  public interface Callback {
    void state(String phase);
    void text(String text);
    void error(String text);
    void wake(String text);
  }
  public OfflineVoice(Context context, Callback callback) {}
  public void warm() {}
  public void start() {}
  public void listenForWake() {}
  public void stop() {}
  public void close() {}
}
