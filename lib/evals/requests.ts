/**
 * The request eval [234]: each case is what a unit said after its call sign, and what
 * `splitRequest` should make of it: a request for recon or not, the words cut out, what is left for
 * the model, the track named, and whether the call was only the request. No model, so it runs in
 * `npm test` as well as `npm run eval:requests`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitRequest, type Split } from "../geo/requests";

export interface RequestCase {
  id: string;
  tags?: string[];
  text: string;
  /** Only the fields given are scored. `text` is what the model gets once the request is cut out. */
  expect: { request: boolean; words?: string; text?: string; n?: number | null; only?: boolean };
  note?: string;
}

export interface RequestEval {
  about?: string;
  cases: RequestCase[];
}

export interface RequestScore {
  id: string;
  pass: boolean;
  /**
   * The worst miss: a request read where none was said. Its words are cut out of the report the
   * model reads, and a request the unit never made waits in the command post's tray.
   */
  falseRequest: boolean;
  misses: string[];
  got: Split;
}

export const REQUEST_CASES = join(__dirname, "../../evals/requests.cases.json");

export function loadRequestEval(file = REQUEST_CASES): RequestEval {
  return JSON.parse(readFileSync(file, "utf8")) as RequestEval;
}

export function scoreRequestCase(c: RequestCase): RequestScore {
  const got = splitRequest(c.text);
  const want = c.expect;
  const misses: string[] = [];
  const asked = got.request != null;
  if (asked !== want.request) misses.push(asked ? `read a request ("${got.request!.words}"), wanted none` : "no request read, wanted one");
  if (want.words != null && got.request?.words !== want.words) misses.push(`words "${got.request?.words ?? ""}", wanted "${want.words}"`);
  if (want.text != null && got.text !== want.text) misses.push(`left "${got.text}", wanted "${want.text}"`);
  if (want.n !== undefined && (got.request?.n ?? null) !== want.n) misses.push(`track ${got.request?.n ?? "none"}, wanted ${want.n ?? "none"}`);
  if (want.only != null && got.only !== want.only) misses.push(want.only ? "a report read, wanted the request on its own" : "the request on its own, wanted a report too");
  return { id: c.id, pass: misses.length === 0, falseRequest: asked && !want.request, misses, got };
}
