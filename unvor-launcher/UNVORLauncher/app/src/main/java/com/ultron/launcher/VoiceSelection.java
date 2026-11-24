package com.ultron.launcher;
import java.util.*;
public final class VoiceSelection {
 private VoiceSelection(){}
 public static boolean italian(Locale locale){if(locale==null)return false;String language=locale.getLanguage();return"it".equalsIgnoreCase(language)||"ita".equalsIgnoreCase(language);}
 public static List<String> engines(Collection<String> detected,String preferred){LinkedHashSet<String> unique=new LinkedHashSet<>();for(String name:detected)if(name!=null&&!name.startsWith("com.google."))unique.add(name);List<String> result=new ArrayList<>(unique);if(result.remove("org.woheller69.ttsengine"))result.add(0,"org.woheller69.ttsengine");if(preferred!=null&&result.remove(preferred))result.add(0,preferred);return result;}
}
