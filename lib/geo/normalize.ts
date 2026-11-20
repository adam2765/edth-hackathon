/** Lowercase, fold accents, turn punctuation (incl. hyphens and apostrophes) into spaces, collapse spaces. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(" ") : [];
}
