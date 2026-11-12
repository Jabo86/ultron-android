export const PROFILE_FIELDS = ["headline", "bio", "avatar"];
export const PROFILE_LIMITS = { headline: 120, bio: 500, avatar: 180000 };

export function validAvatar(value) {
  return typeof value === "string" && value.length <= PROFILE_LIMITS.avatar &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function profileDraft(local, remote) {
  const published = remote?.is_public === true ? remote : {};
  const source = local || remote || {};
  const draft = { visibility: {} };
  for (const field of PROFILE_FIELDS) {
    const value = typeof source[field] === "string" ? source[field] : "";
    draft[field] = field === "avatar" ? (validAvatar(value) ? value : "") : value.slice(0, PROFILE_LIMITS[field]);
    draft.visibility[field] = local ? local.visibility?.[field] === true : !!published[field];
  }
  return draft;
}

export function publicProfile(draft) {
  const fields = {};
  for (const field of PROFILE_FIELDS) {
    const value = draft.visibility?.[field] === true ? draft[field] : "";
    fields[field] = field === "avatar" ? (validAvatar(value) ? value : "") : String(value || "").trim().slice(0, PROFILE_LIMITS[field]);
  }
  return { ...fields, is_public: PROFILE_FIELDS.some((field) => !!fields[field]) };
}
