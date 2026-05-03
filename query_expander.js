import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const TOKEN_SYNONYMS = {
  car: ["cars", "automobile", "vehicle", "sedan", "suv", "truck"],
  automobile: ["car", "vehicle"],
  bike: ["bicycle", "cycle"],
  bicycle: ["bike", "cycle"],
  kid: ["child", "children", "toddler"],
  child: ["kid", "children"],
  children: ["child", "kids"],
  woman: ["female", "lady", "girl"],
  man: ["male", "guy", "boy"],
  people: ["person", "crowd", "human"],
  person: ["people", "human"],
  portrait: ["headshot", "face", "selfie"],
  selfie: ["portrait", "face"],
  phone: ["smartphone", "mobile", "cellphone"],
  smartphone: ["phone", "mobile"],
  tv: ["television", "screen", "display"],
  food: ["meal", "dish", "cuisine"],
  drink: ["beverage", "cup", "glass"],
  dog: ["canine", "puppy"],
  cat: ["feline", "kitten"],
  bird: ["avian"],
  beach: ["seaside", "coast", "shore", "ocean"],
  ocean: ["sea", "water", "beach"],
  mountain: ["peak", "hill", "alpine"],
  forest: ["woods", "woodland", "trees"],
  city: ["urban", "downtown", "street", "skyline"],
  building: ["architecture", "structure"],
  home: ["house", "residence"],
  office: ["workplace", "workspace"],
  flower: ["floral", "blossom"],
  tree: ["plant", "forest"],
  river: ["stream", "waterway"],
  night: ["dark", "nighttime", "evening"],
  sunset: ["dusk", "twilight", "goldenhour"],
  sunrise: ["dawn", "morning"],
  snow: ["winter", "frost", "ice"],
  rain: ["rainy", "storm", "wet"],
  text: ["words", "letters", "writing", "typography"],
  sign: ["poster", "label", "text"],
  logo: ["brand", "symbol", "icon"],
  screenshot: ["screen", "ui", "interface"],
  solo: ["single", "alone", "individual"],
  single: ["solo", "alone", "individual"],
  pic: ["photo", "portrait", "image", "shot"],
  photo: ["picture", "image", "shot"],
  group: ["crowd", "team", "together"],
  young: ["youth", "teen", "teenage"],
  sunglasses: ["shades", "aviators", "eyewear", "darkglasses", "sunshades", "goggles"],
  shades: ["sunglasses", "aviators", "eyewear"],
  aviators: ["sunglasses", "shades", "eyewear"],
  eyewear: ["sunglasses", "glasses", "spectacles", "eyeglasses"],
  glasses: ["eyeglasses", "spectacles", "eyewear"],
  eyeglasses: ["glasses", "eye glasses", "spectacles", "eyewear"],
  spectacle: ["spectacles", "glasses", "eyewear"],
  spectacles: ["spectacle", "glasses", "eyeglasses", "eyewear"],
  hat: ["cap", "headwear", "beanie"],
  cap: ["hat", "baseball cap", "headwear"],
  backpack: ["bag", "knapsack", "rucksack"],
  handbag: ["purse", "bag", "tote"],
  purse: ["handbag", "bag", "clutch"],
  hoodie: ["sweatshirt", "jacket"],
  jacket: ["coat", "outerwear"],
  sneakers: ["shoes", "trainers"],
  shoes: ["sneakers", "footwear"],
};

const PHRASE_SYNONYMS = [
  { trigger: "b&w", expansions: ["black white", "black and white", "monochrome", "grayscale"] },
  { trigger: "bw", expansions: ["black white", "black and white", "monochrome", "grayscale"] },
  { trigger: "black and white", expansions: ["monochrome", "grayscale", "b&w"] },
  { trigger: "nyc", expansions: ["new york city", "manhattan", "urban skyline"] },
  { trigger: "new york", expansions: ["nyc", "manhattan"] },
  { trigger: "golden hour", expansions: ["sunset", "warm light", "dusk"] },
  { trigger: "solo pic", expansions: ["single person", "portrait", "one person", "alone"] },
  { trigger: "group photo", expansions: ["multiple people", "crowd", "team"] },
  { trigger: "sun glasses", expansions: ["sunglasses", "shades", "eyewear", "dark glasses"] },
  { trigger: "dark glasses", expansions: ["sunglasses", "shades", "aviators"] },
];

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "with",
  "of",
  "to",
  "and",
  "or",
  "in",
  "on",
  "at",
  "for",
  "by",
  "photo",
  "pic",
  "picture",
  "image",
  "shot",
]);

const BEDROCK_INTENT_PROMPT = [
  "You are a query understanding engine for image search.",
  "Return ONLY JSON with this exact shape:",
  '{"expanded_terms":["..."],"required_phrases":["..."],"intent":{"people_mode":"any|solo|group|none","subject_gender":"any|female|male","subject_age":"any|young|adult|child"}}',
  "Infer people_mode from words like solo, single, group, crowd, family.",
  "Keep expanded_terms short, concrete, and search-friendly.",
  "No markdown, no extra keys.",
].join(" ");

const bedrockIntentCache = new Map();
const NUMBER_WORDS = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
]);

function parseCountToken(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  if (NUMBER_WORDS.has(value)) {
    return NUMBER_WORDS.get(value);
  }

  return null;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || "").trim());
  } catch {
    return null;
  }
}

function parseBedrockText(response) {
  return (response?.output?.message?.content ?? [])
    .filter((chunk) => typeof chunk?.text === "string")
    .map((chunk) => chunk.text)
    .join("")
    .trim();
}

function normalizePeopleMode(value) {
  const normalized = String(value || "any").toLowerCase();
  if (normalized === "solo" || normalized === "group" || normalized === "none") {
    return normalized;
  }
  return "any";
}

function normalizeGender(value) {
  const normalized = String(value || "any").toLowerCase();
  if (normalized === "female" || normalized === "male") {
    return normalized;
  }
  return "any";
}

function normalizeAge(value) {
  const normalized = String(value || "any").toLowerCase();
  if (normalized === "young" || normalized === "adult" || normalized === "child") {
    return normalized;
  }
  return "any";
}

function localIntentFromQuery(query) {
  const q = String(query || "").toLowerCase();
  const tokens = tokenize(q);
  const hasAny = (...candidates) => candidates.some((candidate) => tokens.includes(candidate));

  let people_mode = "any";
  if (hasAny("solo", "single", "alone", "individual")) {
    people_mode = "solo";
  } else if (hasAny("group", "crowd", "family", "team", "together")) {
    people_mode = "group";
  } else if (q.includes("no people") || q.includes("without people")) {
    people_mode = "none";
  }

  let subject_gender = "any";
  if (hasAny("woman", "women", "female", "lady", "girl")) {
    subject_gender = "female";
  } else if (hasAny("man", "men", "male", "boy", "guy")) {
    subject_gender = "male";
  }

  let subject_age = "any";
  if (hasAny("young", "teen", "teenage", "youth")) {
    subject_age = "young";
  } else if (hasAny("child", "kid", "kids", "toddler")) {
    subject_age = "child";
  } else if (hasAny("adult")) {
    subject_age = "adult";
  }

  return {
    people_mode,
    subject_gender,
    subject_age,
  };
}

async function queryBedrockIntent(query) {
  const cacheKey = String(query || "").trim().toLowerCase();
  if (!cacheKey) {
    return null;
  }

  if (bedrockIntentCache.has(cacheKey)) {
    return bedrockIntentCache.get(cacheKey);
  }

  const modelId = String(
    process.env.BEDROCK_QUERY_MODEL || process.env.BEDROCK_VISION_MODEL || "qwen.qwen3-vl-235b-a22b",
  ).trim();
  const region = String(process.env.AWS_REGION || "us-east-1").trim();
  if (!modelId) {
    return null;
  }

  const client = new BedrockRuntimeClient({
    region,
    requestHandler: new NodeHttpHandler(),
  });

  const command = new ConverseCommand({
    modelId,
    messages: [
      {
        role: "user",
        content: [{ text: `${BEDROCK_INTENT_PROMPT}\n\nQUERY: ${query}` }],
      },
    ],
    inferenceConfig: {
      maxTokens: 220,
      temperature: 0,
    },
  });

  try {
    const response = await client.send(command);
    const raw = parseBedrockText(response)
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const expanded_terms = Array.isArray(parsed.expanded_terms)
      ? parsed.expanded_terms.map((v) => String(v || "").trim()).filter(Boolean)
      : [];
    const required_phrases = Array.isArray(parsed.required_phrases)
      ? parsed.required_phrases.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean)
      : [];
    const intent = {
      people_mode: normalizePeopleMode(parsed?.intent?.people_mode),
      subject_gender: normalizeGender(parsed?.intent?.subject_gender),
      subject_age: normalizeAge(parsed?.intent?.subject_age),
    };

    const value = {
      expanded_terms,
      required_phrases,
      intent,
    };
    bedrockIntentCache.set(cacheKey, value);
    return value;
  } catch {
    return null;
  }
}

function extractCoreNouns(tokens) {
  return tokens.filter((token) => !STOPWORDS.has(token) && token.length > 2);
}

function inferPeopleRange(descriptionText) {
  const text = String(descriptionText || "").toLowerCase();
  if (!text) {
    return { min: null, max: null };
  }

  if (/\bno\s+(?:people|persons?|individuals?)\s+(?:are\s+)?(?:visible|present)\b/.test(text)) {
    return { min: 0, max: 0 };
  }

  const exact = text.match(/\bexactly\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:people|persons?|individuals?)\b/);
  if (exact) {
    const count = parseCountToken(exact[1]);
    if (Number.isFinite(count)) {
      return { min: count, max: count };
    }
  }

  const approxRange = text.match(/\b(?:approximately|about|around)\s+(\d{1,3})\s*[\-\u2013]\s*(\d{1,3})\b/);
  if (approxRange) {
    const low = Number(approxRange[1]);
    const high = Number(approxRange[2]);
    return { min: Math.min(low, high), max: Math.max(low, high) };
  }

  const familyOf = text.match(/\bfamily\s+of\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (familyOf) {
    const count = parseCountToken(familyOf[1]);
    if (Number.isFinite(count)) {
      return { min: count, max: count };
    }
  }

  const atLeast = text.match(/\bat\s+least\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:visible\s+)?(?:people|persons?|individuals?)\b/);
  if (atLeast) {
    const count = parseCountToken(atLeast[1]);
    if (Number.isFinite(count)) {
      return { min: count, max: null };
    }
  }

  const visible = text.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:visible\s+)?(?:people|persons?|individuals?)\b/);
  if (visible) {
    const count = parseCountToken(visible[1]);
    if (Number.isFinite(count)) {
      return { min: count, max: count };
    }
  }

  const groupOf = text.match(/\bgroup\s+of\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (groupOf) {
    const count = parseCountToken(groupOf[1]);
    if (Number.isFinite(count)) {
      return { min: count, max: count };
    }
  }

  if (/\bcouple\b/.test(text)) {
    return { min: 2, max: 2 };
  }

  if (/\bgroup\b|\bcrowd\b|\bseveral\b|\bmany\b/.test(text)) {
    return { min: 2, max: null };
  }

  if (/\bsingle\s+(?:woman|man|person|subject)\b/.test(text)) {
    return { min: 1, max: 1 };
  }

  return { min: null, max: null };
}

function textIncludesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function matchesExpandedIntent(record, intentPayload) {
  const intent = intentPayload && typeof intentPayload === "object" ? intentPayload : null;
  if (!intent) {
    return true;
  }

  const raw = record?.raw || {};
  const docText = String(raw.description || record?.metadata?.description || "").toLowerCase();
  const range = inferPeopleRange(docText);
  const peopleMode = normalizePeopleMode(intent.people_mode);
  const gender = normalizeGender(intent.subject_gender);
  const age = normalizeAge(intent.subject_age);
  const requiredPhrases = Array.isArray(intent.required_phrases)
    ? intent.required_phrases.map((v) => String(v || "").toLowerCase()).filter(Boolean)
    : [];

  if (peopleMode === "solo") {
    if (range.min !== null && range.min >= 2) {
      return false;
    }
    if (range.max !== null && range.max === 0) {
      return false;
    }
    if (/\bgroup\b|\bcrowd\b|\bfamily\s+of\s+[2-9]\b/.test(docText)) {
      return false;
    }
  }

  if (peopleMode === "group") {
    if (range.max !== null && range.max <= 1) {
      return false;
    }
  }

  if (peopleMode === "none") {
    if (!(range.min === 0 && range.max === 0)) {
      return false;
    }
  }

  if (gender === "female") {
    const femaleSignals = [/\bwoman\b/, /\bwomen\b/, /\bfemale\b/, /\bgirl\b/, /\blady\b/, /\bshe\b/, /\bher\b/];
    if (!textIncludesAny(docText, femaleSignals)) {
      return false;
    }
  }

  if (gender === "male") {
    const maleSignals = [/\bman\b/, /\bmen\b/, /\bmale\b/, /\bboy\b/, /\bhe\b/, /\bhis\b/];
    if (!textIncludesAny(docText, maleSignals)) {
      return false;
    }
  }

  if (age === "young") {
    const youngSignals = [/\byoung\b/, /\bteen\b/, /\bteenage\b/, /\byouth\b/, /\bgirl\b/, /\bboy\b/];
    if (!textIncludesAny(docText, youngSignals)) {
      return false;
    }
  }

  if (age === "child") {
    const childSignals = [/\bchild\b/, /\bkid\b/, /\btoddler\b/, /\bboy\b/, /\bgirl\b/];
    if (!textIncludesAny(docText, childSignals)) {
      return false;
    }
  }

  for (const phrase of requiredPhrases) {
    if (!docText.includes(phrase)) {
      return false;
    }
  }

  return true;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function addBasicTokenVariants(token, collector) {
  collector.add(token);

  if (token.endsWith("ies") && token.length > 3) {
    collector.add(`${token.slice(0, -3)}y`);
  }

  if (token.endsWith("es") && token.length > 3) {
    collector.add(token.slice(0, -2));
  }

  if (token.endsWith("s") && token.length > 3) {
    collector.add(token.slice(0, -1));
  }

  if (token.endsWith("ing") && token.length > 5) {
    collector.add(token.slice(0, -3));
  }

  if (token.endsWith("ed") && token.length > 4) {
    collector.add(token.slice(0, -2));
  }
}

function generateTypoVariants(token) {
  const out = new Set();
  if (!/^[a-z0-9]+$/.test(token) || token.length < 5) {
    return out;
  }

  // Common omission typo: remove one middle character.
  const mid = Math.floor(token.length / 2);
  out.add(`${token.slice(0, mid)}${token.slice(mid + 1)}`);

  // Common transposition typo: swap two adjacent middle characters.
  if (token.length >= 6) {
    const i = Math.max(1, Math.floor(token.length / 2) - 1);
    const chars = token.split("");
    const tmp = chars[i];
    chars[i] = chars[i + 1];
    chars[i + 1] = tmp;
    out.add(chars.join(""));
  }

  return out;
}

function collectPhraseExpansions(normalizedQuery, collector) {
  for (const phraseRule of PHRASE_SYNONYMS) {
    if (!normalizedQuery.includes(phraseRule.trigger)) {
      continue;
    }

    for (const expansion of phraseRule.expansions) {
      for (const token of tokenize(expansion)) {
        collector.add(token);
      }
    }
  }
}

export async function expandQuery(query) {
  const original = String(query || "").trim();
  if (!original) {
    return {
      query: "",
      expandedQuery: "",
      addedTerms: [],
      changed: false,
      intent: {
        people_mode: "any",
        subject_gender: "any",
        subject_age: "any",
        required_phrases: [],
      },
      intentSource: "none",
    };
  }

  const normalized = original.toLowerCase();
  const baseTokens = tokenize(original);
  const expandedTerms = new Set();
  const localIntent = localIntentFromQuery(original);
  const bedrockIntent = await queryBedrockIntent(original);

  for (const token of baseTokens) {
    addBasicTokenVariants(token, expandedTerms);

    for (const typoVariant of generateTypoVariants(token)) {
      expandedTerms.add(typoVariant);
    }

    const synonyms = TOKEN_SYNONYMS[token] || [];
    for (const synonym of synonyms) {
      for (const synonymToken of tokenize(synonym)) {
        expandedTerms.add(synonymToken);
      }
    }
  }

  collectPhraseExpansions(normalized, expandedTerms);

  for (const token of baseTokens) {
    expandedTerms.delete(token);
  }

  const nounAnchors = extractCoreNouns(baseTokens);
  for (const anchor of nounAnchors) {
    expandedTerms.add(anchor);
  }

  const bedrockTerms = Array.isArray(bedrockIntent?.expanded_terms) ? bedrockIntent.expanded_terms : [];
  for (const term of bedrockTerms) {
    for (const token of tokenize(term)) {
      expandedTerms.add(token);
    }
  }

  const addedTerms = Array.from(expandedTerms).slice(0, 48);
  const expandedQuery = [original, ...addedTerms].join(" ").trim();
  const intent = {
    ...localIntent,
    ...(bedrockIntent?.intent || {}),
    required_phrases: Array.isArray(bedrockIntent?.required_phrases)
      ? bedrockIntent.required_phrases
      : [],
  };

  return {
    query: original,
    expandedQuery,
    addedTerms,
    changed: addedTerms.length > 0,
    intent,
    intentSource: bedrockIntent ? "bedrock" : "local",
  };
}
