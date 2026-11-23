import { NativeModules, Share } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { getBlob, setBlobDurably } from "./lock";
import { sha256Hex } from "./crypto";
import { withSystemActivity } from "./lockGuard";

export const copyMessageText = async text => NativeModules.LatticeDeviceInfo.copySensitiveText(text);
export const shareMessageText = text => withSystemActivity(() => Share.share({ message: text }));

const empty = Object.freeze([]);
let writes = Promise.resolve();

export async function hiddenMessageIds(user, conversation) {
  if (!user?.lns || !user?.server || !conversation) return [];
  const data = await getBlob("message-actions:" + sha256Hex(JSON.stringify([user.server, user.lns, conversation])));
  return data?.hidden || [];
}

export function useMessagePreferences(user, conversation) {
  const scope = user?.lns && user?.server && conversation
    ? "message-actions:" + sha256Hex(JSON.stringify([user.server, user.lns, conversation])) : null;
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    let active = true;
    if (scope) getBlob(scope).then(data => {
      if (active) setLoaded({ scope, data });
    }).catch(() => {});
    return () => { active = false; };
  }, [scope]);

  const set = useCallback((field, id, enabled) => {
    if (!scope || id == null) return Promise.reject(new Error("Chat non disponibile."));
    const update = writes.catch(() => {}).then(async () => {
      const data = await getBlob(scope) || {};
      const ids = new Set(data[field] || []);
      if (enabled) ids.add(String(id));
      else ids.delete(String(id));
      const next = { ...data, [field]: [...ids] };
      await setBlobDurably(scope, next);
      setLoaded({ scope, data: next });
    });
    writes = update;
    return update;
  }, [scope]);
  const data = loaded?.scope === scope ? loaded?.data : null;
  return { hidden: data?.hidden || empty, pinned: data?.pinned || empty, set };
}
