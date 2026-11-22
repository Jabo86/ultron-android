import React from "react";
import { Image, StyleSheet, View } from "react-native";
export default function HudBackdrop() {
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Image source={require("../../../assets/hud/background.webp")} resizeMode="cover" fadeDuration={0} style={[StyleSheet.absoluteFill, { opacity: 0.17 }]} />
    <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,5,10,0.45)" }]} />
  </View>;
}
