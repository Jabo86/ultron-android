import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from "react-native";
import { Text } from "./HudText";
import { Ionicons } from "@expo/vector-icons";
import { apiErr, mlsQuiz } from "../lib/api";
import { openPilotQuiz } from "../lib/pilotGroups";
import { analyzeMessage } from "../lib/threatEngine";
import { theme } from "../theme";
import EncryptedAttachment from "./EncryptedAttachment";
import SafeText from "./SafeText";
import ThreatBanner from "./ThreatBanner";

export default function GroupQuiz({ group, poll, muted, lang }) {
  const say = (it, en) => lang === "en" ? en : it;
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(true);
  const [showSolution, setShowSolution] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const pending = useRef(null);

  const load = useCallback(async (action, choice) => {
    if (pending.current) return;
    const request = Symbol();
    pending.current = request;
    setBusy(true);
    setError("");
    try {
      const raw = await mlsQuiz(group, { action, id: poll.id, ...(choice === undefined ? {} : { choice }) });
      if (pending.current !== request) return;
      const next = openPilotQuiz(poll, raw);
      setState(next);
      setLocked(false);
      if (action === "vote" && next.choice === next.correct) setCelebrate(true);
    } catch (failure) {
      if (pending.current !== request) return;
      const denied = failure?.response?.status === 403;
      setLocked(denied);
      if (denied || failure?.response?.status === 404) setState(null);
      setError(apiErr(failure));
    } finally {
      if (pending.current === request) {
        pending.current = null;
        setBusy(false);
      }
    }
  }, [group, poll]);

  useEffect(() => {
    load("read");
    return () => { pending.current = null; };
  }, [load]);

  useEffect(() => {
    if (!celebrate) return undefined;
    const timeout = setTimeout(() => setCelebrate(false), 1100);
    return () => clearTimeout(timeout);
  }, [celebrate]);

  const done = state?.totals != null;
  const voted = Number.isInteger(state?.choice);
  const total = done ? state.totals.reduce((sum, count) => sum + count, 0) : 0;
  const percent = count => total ? Math.round(100 * count / total) : 0;
  const canVote = state?.started && !done && !busy && !muted;
  const button = (label, onPress) => (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} disabled={busy} style={styles.option}>
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );

  return <View style={styles.root}>
    <View style={styles.heading}>
      <Ionicons name="help-circle-outline" color={theme.primary} size={17} />
      <Text style={styles.label}>Quiz</Text>
      {celebrate && <Ionicons name="sparkles" color="#7ee7ac" size={20} />}
    </View>
    {busy && !state && <ActivityIndicator color={theme.primary} />}
    {!!error && <Text accessibilityLiveRegion="polite" style={styles.dim}>{locked
      ? say("Accesso al quiz bloccato. Controlla la verifica del tuo account.", "Quiz access blocked. Check your account verification.")
      : error}</Text>}
    {!busy && !state && button(say("Riprova", "Retry"), () => load("read"))}
    {state && <>
      <SafeText text={state.question} lang={lang} style={styles.text} />
      <ThreatBanner result={analyzeMessage(state.question, lang)} lang={lang} logLocally={false} />
      {!done && !state.started && !muted && button(say("Inizia quiz", "Start quiz"), () => load("start"))}
      {!done && muted && <Text style={styles.dim}>{say("Voto sospeso.", "Voting paused.")}</Text>}
      {(done || state.started) && state.options.map((option, index) => {
        const correct = done && index === state.correct;
        const incorrect = voted && !correct && index === state.choice;
        return <TouchableOpacity key={index} accessibilityRole="button"
          accessibilityState={{ disabled: !canVote, selected: index === state.choice }}
          disabled={!canVote} onPress={() => load("vote", index)}
          style={[styles.option, correct && styles.correct, incorrect && styles.incorrect]}>
          <View style={styles.heading}>
            <Text style={[styles.text, styles.flex]}>{option}</Text>
            {correct && <Ionicons accessibilityLabel={say("Corretta", "Correct")} name="checkmark-circle" color="#7ee7ac" size={19} />}
            {incorrect && <Ionicons accessibilityLabel={say("Errata", "Incorrect")} name="close-circle" color="#ff909e" size={19} />}
            {done && <Text style={styles.dim}>{state.totals[index]} · {percent(state.totals[index])}%</Text>}
          </View>
        </TouchableOpacity>;
      })}
      {canVote && <Text style={styles.dim}>{say("La risposta è definitiva.", "Your answer is final.")}</Text>}
      {done && <>
        {voted && <Text accessibilityLiveRegion="polite" style={styles.label}>{state.choice === state.correct
          ? say("Risposta esatta", "Correct answer") : say("Risposta errata", "Incorrect answer")}</Text>}
        {!!total && <Text style={styles.dim}>{percent(state.totals[state.correct])}% {say("corrette", "correct")} · {percent(total - state.totals[state.correct])}% {say("errate", "incorrect")}</Text>}
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showSolution }}
          onPress={() => setShowSolution(value => !value)} style={[styles.option, styles.heading]}>
          <Ionicons name="bulb-outline" color={theme.primary} size={19} />
          <Text style={styles.label}>{say("Soluzione", "Solution")}</Text>
        </TouchableOpacity>
        {showSolution && <View style={styles.solution}>
          <Text style={[styles.label, styles.solutionText]}>{state.options[state.correct]}</Text>
          {!!state.explanation && <>
            <SafeText text={state.explanation} lang={lang} style={styles.text} />
            <ThreatBanner result={analyzeMessage(state.explanation, lang)} lang={lang} logLocally={false} />
          </>}
          {!!state.link && <SafeText text={state.link} lang={lang} style={styles.text} />}
          {!!state.file && <EncryptedAttachment att={state.file} pilotGroup={group} />}
        </View>}
        {button(say("Aggiorna risultati", "Refresh results"), () => load("read"))}
      </>}
      {!!error && !done && state.started && button(say("Controlla il voto", "Check vote"), () => load("read"))}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 8, minWidth: 194, paddingVertical: 4 },
  heading: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { color: theme.primary, fontSize: 14, fontWeight: "700" },
  text: { color: theme.text, fontSize: 15 },
  flex: { flex: 1 },
  dim: { color: theme.textDim, fontSize: 12 },
  option: { padding: 10, minHeight: 42, justifyContent: "center", borderRadius: 10, borderWidth: 1,
    borderColor: theme.border, backgroundColor: theme.surface },
  correct: { borderColor: "#7ee7ac", backgroundColor: "#13372d" },
  incorrect: { borderColor: "#ff909e", backgroundColor: "#41212d" },
  solution: { paddingVertical: 6, gap: 6 },
  solutionText: { color: "#7ee7ac" },
});
