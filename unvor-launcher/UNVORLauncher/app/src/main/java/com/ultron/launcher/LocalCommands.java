package com.ultron.launcher;
import java.text.Normalizer;
import java.util.*;
import java.util.regex.*;
/** Bounded local intent parser: execution never depends on an LLM response. */
public final class LocalCommands {
 public final String type,text;public final int hour,minute;
 private LocalCommands(String t,String s,int h,int m){type=t;text=s;hour=h;minute=m;}
 public static String normalize(String s){return Normalizer.normalize(s==null?"":s,Normalizer.Form.NFD).replaceAll("\\p{M}","").toLowerCase(Locale.ITALIAN).replaceAll("[^\\p{L}\\p{N}: ]"," ").trim().replaceAll(" +"," ");}
 private static int number(String s){String[] words={"zero","uno","due","tre","quattro","cinque","sei","sette","otto","nove","dieci","undici","dodici","tredici","quattordici","quindici","sedici","diciassette","diciotto","diciannove","venti","ventuno","ventidue","ventitre","ventiquattro","venticinque","ventisei","ventisette","ventotto","ventinove","trenta","trentuno","trentadue","trentatre","trentaquattro","trentacinque","trentasei","trentasette","trentotto","trentanove","quaranta","quarantuno","quarantadue","quarantatre","quarantaquattro","quarantacinque","quarantasei","quarantasette","quarantotto","quarantanove","cinquanta","cinquantuno","cinquantadue","cinquantatre","cinquantaquattro","cinquantacinque","cinquantasei","cinquantasette","cinquantotto","cinquantanove"};for(int i=0;i<words.length;i++)if(words[i].equals(s))return i;try{return Integer.parseInt(s);}catch(Exception e){return -1;}}
 public static LocalCommands parse(String raw){String s=normalize(raw).replaceFirst("^(?:(?:ehi|hey|ei) )?(?:unvor|ultron) +","").replaceFirst("^puoi +","");
  if(s.startsWith("chiama ")&&s.length()>7&&s.length()<120)return new LocalCommands("call",s.substring(7),-1,-1);
  Matcher a=Pattern.compile("^(?:(?:metti|imposta|crea) (?:la |una )?)?sveglia (?:alle|per le|all) ([a-z0-9]+)(?:(?::| e | )([a-z0-9]+))?$").matcher(s);
  if(a.matches()){int h=number(a.group(1)),m=a.group(2)==null?0:a.group(2).equals("mezza")?30:a.group(2).equals("un quarto")?15:number(a.group(2));if(h>=0&&h<=23&&m>=0&&m<=59)return new LocalCommands("alarm","",h,m);return new LocalCommands("invalidTime","",-1,-1);}
  if(s.equals("agenda")||s.equals("apri agenda")||s.equals("apri l agenda")||s.equals("calendario"))return new LocalCommands("planner","",-1,-1);
  if(s.startsWith("aggiungi appuntamento")||s.startsWith("crea appuntamento"))return new LocalCommands("newEvent",raw,-1,-1);
  if(s.contains("turni")||s.contains("turno di lavoro"))return new LocalCommands("shifts","",-1,-1);
  if(s.equals("agenda di oggi")||s.contains("appuntamenti")||s.contains("impegni"))return new LocalCommands("summary","",-1,-1);
  if(s.contains("ore sono"))return new LocalCommands("time","",-1,-1);
  if(s.startsWith("apri ")&&s.length()>5)return new LocalCommands("open",s.substring(5),-1,-1);
  return new LocalCommands("unknown",s,-1,-1);
 }
}
