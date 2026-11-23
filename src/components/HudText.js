import React, { forwardRef, memo } from "react";
import { Platform, StyleSheet, Text as NativeText, TextInput as NativeTextInput } from "react-native";

// Keep inputs, accessibility, selection and refs native. Only typography changes.
const body = Platform.OS === "android" ? "UltronBody" : undefined;
const display = Platform.OS === "android" ? "UltronDisplay" : undefined;
export const Text = memo(forwardRef(function HudText({ style, ...props }, ref) {
  const resolved = StyleSheet.flatten(style) || {};
  const heading = Number(resolved.fontSize) >= 22;
  const base = resolved.fontFamily ? null : { fontFamily: heading ? display : body };
  return <NativeText {...props} ref={ref} style={[base, style]} />;
}));
export const TextInput = forwardRef(function HudTextInput({ style, ...props }, ref) {
  return <NativeTextInput {...props} ref={ref} style={[{ fontFamily: body }, style]} />;
});
