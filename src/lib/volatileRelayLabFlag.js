import { RATCHET_PILOT } from "../config";

export const VOLATILE_RELAY_LAB = RATCHET_PILOT &&
  process.env.EXPO_PUBLIC_ULTRON_VOLATILE_RELAY_LAB === "1";
