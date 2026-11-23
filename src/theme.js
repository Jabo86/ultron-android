// ULTRON HUD: shared black, white and cyan language across the application.
export const theme = {
  bg: "#00050A",
  surface: "#001019",
  surfaceAlt: "#031B29",
  border: "#155268",
  text: "#EFFCFF",
  textDim: "#A8D6E4",
  textFaint: "#7CA5B7",
  primary: "#21DFFF",
  primaryDeep: "#064257",
  accent: "#21DFFF",
  danger: "#FFACBE",
  bubbleMe: "#21DFFF",
  bubbleThem: "#041A25",
  onAccent: "#00121A",
  accentWash: "#062B3B",
  accentLine: "#237F99",
};

const STEPS = ["#21DFFF", "#82AFFF", "#AAD9FF", "#4B8CD8", "#95BFFF", "#66A2EC", "#C4E6FF", "#559BDB", "#E0F2FF"];
export function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < (seed || "").length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return STEPS[h % STEPS.length];
}
