export const theme = {
  bg: "#050E1F",
  surface: "#09182D",
  surfaceAlt: "#102440",
  border: "#25476B",
  text: "#F6FAFF",
  textDim: "#ACBFDA",
  textFaint: "#8098B8",
  primary: "#72C7FF",
  primaryDeep: "#133762",
  accent: "#72C7FF",
  danger: "#FFACBE",
  bubbleMe: "#72C7FF",
  bubbleThem: "#0E203A",
  onAccent: "#04152A",
  accentWash: "#112D4D",
  accentLine: "#356792",
};

const STEPS = ["#72C7FF", "#82AFFF", "#AAD9FF", "#4B8CD8", "#95BFFF", "#66A2EC", "#C4E6FF", "#559BDB", "#E0F2FF"];
export function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < (seed || "").length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return STEPS[h % STEPS.length];
}
