export type AssistantLanguage = "en" | "hi";

export function detectLanguage(text: string): AssistantLanguage | null {
  if (/[\u0900-\u097f]/u.test(text)) return "hi";
  if (/\b(?:mereko|merko|meko|mere|mujhe|mereku|kidhar|kaiku|nakko|nako|hau|haan|han|nahi|nahin|dikhao|batao|leke|chalo|kitna|kitni|kitne|kab|pahunchenge|waqt|samay|raasta|rasta|raste|raaste|paas|nazdeek|nazdik|aaspaas|idhar|udhar|wahan|pehla|doosra|dusra|alag|doosre|dusre|theek|band|roko|khula|khuli|jaankari|baare|dawakhana|dawai|kaunsa|konsa|mat|agar)\b/i.test(text)) return "hi";
  return null;
}

export function normalizeHindi(text: string): string {
  const words: Record<string, string> = {
    "मुझे": "mujhe", "मेरे": "mere", "मेरी": "meri", "मेरा": "mera", "मेरेको": "mereko", "मेरेकु": "mereko", "मेरेकू": "mereko", "मेको": "meko", "मेरको": "merko", "हमको": "humko",
    "अभी": "abhi", "यहाँ": "yahan", "यहां": "yahan", "इधर": "idhar", "वहाँ": "wahan", "वहां": "wahan", "उधर": "udhar", "मौजूदा": "current", "वर्तमान": "current", "लोकेशन": "location", "जगह": "jagah",
    "से": "se", "तक": "tak", "को": "ko", "पर": "par", "में": "mein", "के": "ke", "की": "ki", "का": "ka", "और": "aur", "या": "ya", "लेकिन": "lekin", "अगर": "agar", "यदि": "agar", "फिर": "phir", "बिना": "without", "तो": "toh",
    "ले": "le", "लेके": "leke", "लेकर": "lekar", "चलो": "chalo", "चल": "chal", "जाओ": "jao", "जाना": "jana", "जाने": "jane", "है": "hai", "हैं": "hain", "हो": "ho", "होगा": "hoga", "चाहिए": "chahiye",
    "दिखाओ": "dikhao", "दिखा": "dikha", "बताओ": "batao", "बता": "bata", "ढूंढो": "dhundo", "ढूँढो": "dhundo", "ढूंढ़ो": "dhundo", "खोजो": "khojo", "देखो": "dekho", "चेक": "check", "करो": "karo", "कर": "kar", "दो": "do", "दीजिए": "dijiye", "कृपया": "please", "ज़रा": "zara", "जरा": "zara",
    "पास": "paas", "नज़दीक": "nazdeek", "नजदीक": "nazdeek", "आसपास": "aaspaas", "सबसे": "sabse", "करीब": "kareeb", "रास्ते": "raste", "रास्ता": "rasta", "रूट": "route", "दूसरा": "doosra", "दूसरे": "doosre", "दूसरी": "doosri", "पहला": "pehla", "पहले": "pehle", "पहली": "pehli", "तीसरा": "teesra", "तीसरे": "teesre", "तीसरी": "teesri", "चौथा": "chautha", "चौथी": "chautha", "चौथे": "chautha", "पाँचवाँ": "paanchva", "पांचवां": "paanchva", "पांचवे": "paanchva",
    "कितना": "kitna", "कितनी": "kitni", "कितने": "kitne", "कब": "kab", "वक्त": "waqt", "वक़्त": "waqt", "समय": "samay", "देर": "der", "लगेगा": "lagega", "लगेगी": "lagegi", "बचा": "bacha", "बाकी": "baaki", "दूर": "door", "दूरी": "doori", "पहुंचेंगे": "pahunchenge", "पहुँचेंगे": "pahunchenge", "कहाँ": "kahan", "कहां": "kahan", "किधर": "kidhar", "क्या": "kya", "कैसे": "kaise", "क्यों": "kyun", "कायकू": "kaiku", "कौन": "kaun", "सा": "sa", "टाइम": "time", "राह": "rasta", "बनाओ": "banao", "सही": "sahi", "जी": "ji", "बिल्कुल": "bilkul",
    "पेट्रोल": "petrol", "पंप": "pump", "पम्प": "pump", "स्टेशन": "station", "रेस्टोरेंट": "restaurant", "रेस्तरां": "restaurant", "रेस्टोरेंट्स": "restaurants", "खाना": "khana", "होटल": "hotel", "अस्पताल": "hospital", "हॉस्पिटल": "hospital", "दवाखाना": "dawakhana", "दवाई": "dawai", "दवा": "dawa", "मेडिकल": "medical", "फार्मेसी": "pharmacy", "एटीएम": "atm", "पार्किंग": "parking", "कैफे": "cafe", "कॉफी": "coffee", "चार्जिंग": "charging", "चार्जर": "charger", "ट्रैफिक": "traffic", "जाम": "jam",
    "हाँ": "haan", "हां": "haan", "हौ": "hau", "नहीं": "nahi", "नही": "nahi", "ना": "na", "मत": "mat", "नको": "nakko", "नक्को": "nakko", "नाको": "nakko", "बंद": "band", "रोको": "roko", "रोक": "rok", "रद्द": "radd", "कैंसल": "cancel", "कन्फर्म": "confirm", "पक्का": "pakka", "ठीक": "theek", "ठिक": "theek", "विकल्प": "option", "ऑप्शन": "option", "नंबर": "number", "नम्बर": "number", "नेविगेशन": "navigation", "नैविगेशन": "navigation",
    "एक": "ek", "तीन": "teen", "चार": "chaar", "पाँच": "paanch", "पांच": "paanch", "ये": "ye", "यह": "ye", "वो": "wo", "वह": "wo", "उस": "us", "इस": "is", "वाला": "wala", "वाली": "wali", "वाले": "wale", "घर": "ghar", "काम": "kaam", "ऑफिस": "office", "शुरू": "shuru", "मंजिल": "manzil", "मंज़िल": "manzil", "बदलो": "badlo", "बदल": "badal", "चुनो": "chuno", "जानकारी": "jaankari", "बारे": "baare", "खुला": "khula", "खुली": "khuli", "पता": "pata",
  };
  return text.normalize("NFKC").replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966)).replace(/[।॥]/g, ".")
    .replace(/[\p{L}\p{M}]+/gu, (word) => Object.hasOwn(words, word) ? words[word] : word).replace(/\s+/g, " ").trim();
}

export function hindiNegation(text: string): boolean {
  return /\b(?:mat|na|nahi|nahin|naheen|nakko|nako|don't|do not|never|agar|if|unless|lekin|but|ya|or|aur|phir|without)\b/i.test(normalizeHindi(text));
}

function hindiCommand(text: string): string {
  return normalizeHindi(text).replace(/[.!?]+$/, "").replace(/^(?:(?:please|zara|jara|bhai|bhaiya|ustad)\s+)+/i, "");
}

function originalQuery(text: string, query: string): string {
  const clean = text.normalize("NFKC").replace(/[।॥.!?]+$/, "").trim();
  const words = Array.from(clean.matchAll(/\S+/gu));
  for (const [index, word] of words.entries()) {
    for (const last of words.slice(index)) {
      const candidate = clean.slice(word.index, last.index + last[0].length);
      if (normalizeHindi(candidate).toLowerCase() === query.toLowerCase()) return candidate;
    }
  }
  return query;
}

export function hindiDestination(text: string): string | null {
  const clean = hindiCommand(text);
  if (hindiNegation(clean) || /\b(?:kya|kyun|kyu|kaiku|kaise|kitna|kitni|kidhar|kahan|aur|phir)\b/i.test(clean)) return null;
  const person = "(?:(?:mujhe|mereko|merko|mereku|meko|humko)\\s+)?";
  const direct = new RegExp(`^${person}(.+?)\\s+(?:le(?:ke|kar)?\\s+(?:chalo|jao)|le\\s+kar\\s+(?:chalo|jao)|chalo|jana hai|jaana hai)$`, "i");
  const set = /^(?:meri |mera )?(?:destination|manzil) (?:ko )?(.+?) (?:kar do|kardo|set karo|badal do|badlo)$/i;
  let target = (clean.match(direct) ?? clean.match(set))?.[1].replace(/\s+(?:ko|pe|par)$/i, "").trim();
  if (!target || /[?!;]/.test(target)) return null;
  if (/^(?:wahan|vahan|udhar|yahan|idhar|us jagah|is jagah)$/i.test(target)) return "there";
  if (/^(?:(?:mere|meri|mera) )?(?:ghar|kaam)$/i.test(target)) return null;
  target = originalQuery(text, target).replace(/\b(?:sabse (?:paas|nazdeek|nazdik|kareeb)|nazdeeki|nazdiki|nearest)\b|सबसे\s+(?:पास|नज़दीक|नजदीक|करीब)|नज़दीकी|नजदीकी/gi, "nearest");
  return target;
}

export function hindiRoute(text: string): { originQuery: string; query: string } | null {
  const clean = hindiCommand(text);
  if (hindiNegation(clean) || /\b(?:kya|kyun|kyu|kaiku|kaise|aur|phir)\b/i.test(clean)) return null;
  const match = clean.match(/^(?:(?:mujhe|mereko|merko|meko|humko) )?(.+?) se (.+?) tak(?: ka)? (?:(?:route|rasta) (?:dikhao|batao|banao|shuru karo)|le(?:ke|kar)? (?:chalo|jao)|chalo)$/i);
  return match ? { originQuery: originalQuery(text, match[1].trim()), query: originalQuery(text, match[2].trim()) } : null;
}

export function hindiStop(text: string): boolean {
  const clean = hindiCommand(text);
  return !hindiNegation(clean) && /^(?:(?:mera|meri|ye|yeh) )?(?:route|navigation|rasta) (?:band (?:karo|kar do)|roko|rok do|cancel (?:karo|kar do)|radd karo)$/i.test(clean);
}

export function hindiReferenceText(text: string): string {
  const ordinalAliases: Record<string, string> = { pehla: "first", pehli: "first", pehle: "first", pahla: "first", pahle: "first", pehley: "first", doosra: "second", doosri: "second", doosre: "second", dusra: "second", dusri: "second", dusre: "second", teesra: "third", teesri: "third", teesre: "third", tisra: "third", chautha: "fourth", paanchva: "fifth" };
  const numbers: Record<string, string> = { ek: "one", do: "two", teen: "three", chaar: "four", char: "four", paanch: "five" };
  const bare = normalizeHindi(text).replace(/[.!?]+$/, "").toLowerCase();
  if (Object.hasOwn(numbers, bare) || /^\d{1,2}$/.test(bare)) return `option ${numbers[bare] ?? bare}`;
  return normalizeHindi(text).replace(/\b(pehla|pehli|pehle|pahla|pahle|pehley|doosra|doosri|doosre|dusra|dusri|dusre|teesra|teesri|teesre|tisra|chautha|paanchva)\b/gi, (word) => ordinalAliases[word.toLowerCase()])
    .replace(/\b(?:wala|wali|wale)\b/gi, "one").replace(/\b(option|number)\s+(ek|do|teen|chaar|char|paanch)\b/gi, (_, noun: string, value: string) => `${noun} ${numbers[value.toLowerCase()]}`)
    .replace(/\baur\b/gi, "and").replace(/\bya\b/gi, "or");
}

export function hindiConfirmation(text: string): "yes" | "no" | null {
  const clean = normalizeHindi(text).replace(/[,!.?]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:nahi|nahin|nakko|nako|cancel(?: karo)?|radd karo|nahi chahiye)$/i.test(clean)) return "no";
  if (/^(?:(?:haan|han|hau|ha) ?(?:ji|bhai)?|ji|bilkul|(?:haan |hau )?(?:theek hai|sahi hai|confirm(?: karo| kar do)?|route confirm(?: karo)?|confirm route|destination confirm(?: karo)?|pakka|kar do|chalo))$/i.test(clean)) return "yes";
  return null;
}

export function hindiChoice(text: string): boolean {
  return /^(?:(?:option|number)\s+(?:one|two|three|four|five|\d{1,2})|(?:first|second|third|fourth|fifth)(?: (?:one|option|result))?)(?: (?:chuno|select karo))?[.!?]*$/i.test(hindiReferenceText(text));
}