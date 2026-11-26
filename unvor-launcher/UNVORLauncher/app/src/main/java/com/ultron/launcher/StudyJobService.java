package com.ultron.launcher;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.os.Handler;
import android.os.Looper;

/** Android-native periodic study job: only on charging + unmetered network.
 * No Play Services, no Google account. Saves only verified encyclopedia excerpts.
 */
public final class StudyJobService extends JobService {
    private volatile boolean stopped;
    private final Handler handler=new Handler(Looper.getMainLooper());
    @Override public boolean onStartJob(JobParameters params) {
        stopped=false;
        if(!StudyEngine.enabled(this))return false;
        StudyEngine.study(this,result->handler.post(()->{
            if(!stopped)jobFinished(params,false);
        }));
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) {
        stopped=true;
        return false;
    }
}
