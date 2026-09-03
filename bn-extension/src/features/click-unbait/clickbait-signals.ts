/**
 * Clickbait detection by curiosity gap, not by catchphrase.
 *
 * The phrase list this replaces ("you won't believe", "one weird trick") scored 0 on every
 * headline on upworthy.com and buzzfeed.com — sites whose whole business is clickbait. Two
 * reasons. It was looking for a 2014 house style nobody writes any more, and every pattern
 * used a straight apostrophe, so `won’t` as actually published never matched anything.
 *
 * What modern clickbait has in common is structural: the headline names the *reaction* to
 * the payoff instead of the payoff. "…and it's eye-opening" tells you how to feel about a
 * list you have not been shown; "reveals the fastest way to change your life" promises a
 * method and withholds it; "And He Has Just 1 Wish" counts a thing without naming it. A
 * straight news headline does the opposite — it spends its words on the outcome itself
 * ("Bank of England holds interest rates at 4.5%"), which is what `concreteness` credits.
 *
 * Signals are scored together rather than any one being decisive: soft feature headlines on
 * a normal news site trip one of these often enough, and labelling those is how a reader
 * learns to ignore the label.
 */

export interface ClickbaitScore {
	score: number;
	flags: string[];
}

interface Signal {
	id: string;
	weight: number;
	re: RegExp;
	/** Plain English for the Content Analysis modal. Required, so it cannot drift out of
	 *  sync with the signal list — `singular_tease` was added to the scorer and forgotten in
	 *  a separate description map, and every headline it caught alone said "sensational
	 *  framing" instead. */
	says: string;
}

/** Straight-quote everything first: published copy uses ’ and “ ”, patterns use ' and ". */
export function normaliseForMatching(headline: string): string {
	return String(headline || '')
		.replace(/[‘’‚‛`´]/g, "'")
		.replace(/[“”„‟]/g, '"')
		.replace(/[–—]/g, '-')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Nouns that name a payoff without giving it. Shared by the two signals that look for one. */
const PAYOFF_NOUNS =
	'thing|trick|word|habit|rule|question|reason|secret|mistake|test|hack|tip|change|move|' +
	'item|photo|detail|moment|sign|wish|lesson|skill|phrase|sentence|ingredient|step|' +
	'answer|clue|note|line';

/**
 * The payoff is named as a countable thing and then not named. "just one Post-it note",
 * "the one thing", "a 10-second hand test" — the reader is told there is an answer and has
 * to click for it.
 */
const WITHHELD_PAYOFF = new RegExp(
	'\\b(?:just |only |this |these |that |the |a |an )?(?:one|1|two|2|three|3|\\d+)?\\s*' +
		'(?:simple |single |weird |strange |surprising |common |basic |secret |little )?' +
		`(?:${PAYOFF_NOUNS})s?\\b`,
	'i'
);

const SIGNALS: Signal[] = [
	{
		id: 'reaction_tail',
		says: "ends by rating the story instead of telling it",
		weight: 0.4,
		re: /,?\s+and\s+(?:fails?|nails?|flops?|loses?|wins?|it|they|he|she|i|we|you|the\s+\w+|his\s+\w+|her\s+\w+|their\s+\w+)(?:'s|'re|'m|'ve|'ll|\s+(?:is|are|was|were|has|have|will|did|does))?\s+[^,?]{0,60}$/i,
	},
	{
		id: 'evaluative_tail',
		says: "ends on a verdict rather than a fact",
		weight: 0.35,
		re: /\b(eye-opening|priceless|iconic|unbelievable|incredible|hilarious|heartbreaking|heartwarming|wholesome|savage|brutal|perfect|spot on|too real|so real|is real|says it all|speaks volumes|hits different|honestly surprising|absolutely \w+|spectacularly|hilariously|miserably|magnificently)\s*[.!]?$/i,
	},
	{
		id: 'vague_transformation',
		says: "promises a change without saying what changed",
		weight: 0.4,
		re: /\b(chang(?:ed|es|ing)\s+(?:[\w'-]+\s+){0,2}(?:life|everything)|changed everything|changes everything|will never be the same|broke the internet|went viral|goes viral|is going viral|nothing was the same)\b/i,
	},
	{
		id: 'reaction_verb',
		says: "describes the reaction, not the event",
		weight: 0.4,
		re: /\b(jaw drops?|jaw-dropping|left (?:\w+\s+){0,2}(?:speechless|stunned|in tears|shook|shaken)|can'?t believe|cannot believe|had us (?:laughing|crying)|moved to tears|stunned|floored|freaking out|lost it|melts? hearts?|will make you|still laughing)\b/i,
	},
	{
		id: 'reader_challenge',
		says: "dares or flatters the reader",
		weight: 0.4,
		re: /\b(only (?:\w+\s+){0,3}(?:can|will|would)\b|you'?re (?:brilliant|a genius|smart|in the top)|most people (?:fail|can'?t|don'?t|get)|if you can|can you (?:name|guess|spot|find)|test your|how many .{0,20}can you|bet you)\b/i,
	},
	{
		id: 'listicle',
		says: "a numbered list whose items are withheld",
		weight: 0.3,
		// Adjectives pad the count on purpose ("55 Absolutely Hilarious Tweets"), so allow a
		// few words between the number and the noun.
		re: /^\s*\d+\s+\w|\b\d+\s+(?:[\w'-]+\s+){0,3}(reasons|ways|things|secrets|tips|signs|times|photos|pictures|celebrities|tweets|books|recipes|moments|facts|rules|habits|skills|mistakes|questions|stories|quotes|memes)\b/i,
	},
	{
		id: 'superlative_promise',
		says: "promises a best/fastest method without naming it",
		weight: 0.35,
		re: /\b(?:the\s+)?(\w{3,}est|best|worst|only|most \w+)[\s-]+(?:[\w'-]+[\s-]+){0,2}(way|thing|method|trick|habit|rule|reason|secret)\b/i,
	},
	// Authority borrowed to license the tease. Harmless with a stated finding, so it leans
	// on the withheld-payoff signal to matter.
	{
		id: 'borrowed_authority',
		says: "cites an expert to license the tease",
		weight: 0.2,
		re: /\b(doctor|dr\.?|psychiatrist|psychologist|neurologist|therapist|nutritionist|dietitian|scientist|researcher|expert|professor|harvard|stanford|oxford|nasa|ceo)\b[^.]{0,40}\b(reveals?|shares?|explains?|warns?|says|admits?|breaks down)\b/i,
	},
	// A phrase in quotes doing the teasing: 'the fastest way to change your life'.
	{
		id: 'teaser_quote',
		says: "quotes a phrase without its context",
		weight: 0.2,
		re: /'[^']{12,60}'|"[^"]{12,60}"/,
	},
	// "Then …", "Now …", "X years later …" — a turn whose content is withheld.
	{
		id: 'withheld_turn',
		says: "sets up a turn and stops",
		weight: 0.3,
		re: /\.\s*(then|now|but then|what happened|years later|\d+ years later)\b|\bwhat happened next\b/i,
	},
	{
		id: 'reader_assumption',
		says: "leads on what you supposedly assume",
		weight: 0.3,
		re: /\byou'?(?:d|ll|ve)\s+(?:expect|think|never|be|want|guess)\b|\byou (?:won'?t|will never|would never|need to see|have to see)\b/i,
	},
	{
		id: 'withheld_payoff',
		says: "names a thing it will not name",
		weight: 0.35,
		re: WITHHELD_PAYOFF,
	},
	// "The one thing…", "just one Post-it note", "a single question": counting the payoff to
	// exactly one is the oldest move there is, and on its own it is the whole curiosity gap.
	{
		id: 'singular_tease',
		says: "counts the payoff to exactly one, then does not name it",
		weight: 0.25,
		re: new RegExp(
			"\\b(?:just |only )?(?:the|a|an|this)?\\s*\\b(?:one|1|single)\\s+" +
				`(?:[\\w'-]+[\\s-]+){0,2}(?:${PAYOFF_NOUNS})\\b`,
			'i'
		),
	},
	// Something was said or counted, and the headline names only that it exists: "People
	// love his response", "their explanation makes sense", "An Absolutely Wild Amount".
	{
		id: 'withheld_referent',
		says: "refers to something it does not state",
		weight: 0.3,
		re: /\b(?:his|her|their|its|the|this|these|that|a|an|[\w'-]+'s)\s+(?:[\w'-]+[\s-]+){0,2}(response|reply|replies|explanation|comments?|reaction|answer|take|statement|remarks?|message|confession|admission|revelation|amount|number|result|outcome)\b/i,
	},
	{
		id: 'demonstrative_count',
		says: "points at a count without naming the items",
		weight: 0.3,
		re: /\b(these|those|this)\s+\d+\b/i,
	},
	{
		id: 'intensifier',
		says: "an intensifier standing in for the fact",
		weight: 0.25,
		re: /\b(absolutely|literally|genuinely|brutally|seriously|wildly|insanely|super|totally|utterly|ridiculously|unbelievably|surprisingly|shockingly)\s+\w|\bso (?:much|many|bizarre|real|good|bad|weird|funny|wrong)\b/i,
	},
	{
		id: 'crowd_reaction',
		says: "the crowd's reaction stands in for the story",
		weight: 0.3,
		re: /\b(?:people|fans|moms|dads|parents|users|viewers|everyone|the internet)\s+(?:are|is|have|has|love[ds]?|can'?t|shared|say|says|applaud\w*|side-eye\w*)\b|\bhas (?:people|everyone|fans) (?:asking|talking|wondering)\b/i,
	},
];

/**
 * A headline that spends its words on the outcome does not need the reader to click. Scores
 * and money and named consequences are the marks of it; they buy the headline credit back.
 */
const CONCRETE: { id: string; credit: number; re: RegExp }[] = [
	// A score, a percentage, a sum, a death toll: the finding itself, stated.
	{ id: 'figure', credit: 0.25, re: /\b\d+(?:[.,]\d+)?\s?(%|per cent|percent)|\b\d+-\d+\b|[£$€]\s?\d|\b\d+(?:,\d{3})+\b|\b\d+\s?(m|bn|k)\b/i },
	// News-desk framing: "Place: what happened", "Live. …", an attributed quote.
	{ id: 'news_frame', credit: 0.2, re: /^(live[.:]|breaking[.:])|^[A-Z][a-z][\w' -]{1,26}:\s/ },
	// A completed action with a named object.
	{
		id: 'outcome_verb',
		credit: 0.2,
		re: /\b(dies|died|killed|wins?|won|beat|beats|resigns?|quits?|retires?|arrested|charged|sentenced|jailed|elected|appointed|replaced|banned|approved|rejected|launches?|announces?|signs?|joins?|holds?|cuts?|raises?|drops?|recalls?|acquires?|sues?)\b/i,
	},
];

/** A signal at or below this weight is too weak to flag a headline by itself. */
const WEAK_SIGNAL_CEILING = 0.3;

/** Ceiling on the benefit of the doubt a concrete-looking headline earns. */
const MAX_CONCRETE_CREDIT = 0.3;

/** Above this, a headline is withholding enough to be worth unravelling. */
export const CLICKBAIT_THRESHOLD = 0.4;

/**
 * Quizzes and personality tests are engagement bait, but Click Unbait's whole move is to
 * fetch the destination and state the payoff — and a quiz's "payoff" is the reader taking
 * it. There is nothing honest to put in the brackets, so we leave them alone.
 */
const QUIZ =
	/\bquiz\b|\btrivia\b|\bcrossword\b|\bword chains?\b|\bcan you (?:name|guess|spot|solve|get|make it|pass|answer|finish)\b|^(?:if you can|let's see if|forget which)\b|\bhow many .{0,24}can you\b|\b\d+\s?\/\s?\d+\b|\bwhich \w+ (?:should you|are you)\b|\bare you (?:a|an|the) \w+\?|\bhow (?:much|well) do you know\b|\bexam\b|\bchallenge\b\s*$/i;

export function isQuizHeadline(headline: string): boolean {
	return QUIZ.test(normaliseForMatching(headline));
}

/** Every signal the scorer can raise. Used by tests to check each one is described. */
export function allSignalIds(): string[] {
	return SIGNALS.map((s) => s.id);
}

/** Signal ids as something a reader can follow, e.g. in the Content Analysis modal. */
export function describeSignals(flags: string[], limit = 3): string {
	const described = flags
		.map((f) => SIGNALS.find((s) => s.id === f)?.says)
		.filter(Boolean) as string[];
	return described.slice(0, limit).join('; ') || 'sensational framing';
}

/** Signals that name the problem, as opposed to concreteness credits and the quiz marker. */
export function namedSignals(flags: string[]): string[] {
	return flags.filter((f) => SIGNALS.some((s) => s.id === f));
}

export function scoreClickbait(headline: string): ClickbaitScore {
	const text = normaliseForMatching(headline);
	if (!text) return { score: 0, flags: [] };
	if (isQuizHeadline(text)) return { score: 0, flags: ['quiz_out_of_scope'] };

	let score = 0;
	const flags: string[] = [];

	for (const signal of SIGNALS) {
		if (!signal.re.test(text)) continue;
		score += signal.weight;
		flags.push(signal.id);
	}

	// A lone *weak* signal is not a curiosity gap — feature writing on a straight news site
	// trips one routinely. A lone strong signal is, so it keeps its full weight.
	if (flags.length === 1 && score < WEAK_SIGNAL_CEILING) score *= 0.6;

	// Concreteness is evidence the headline states its outcome, but a headline can do both
	// — "$3,404 … the attorney's reply left her in tears" names a sum and still withholds
	// the story. So the credit is capped, and never takes more than half of what the
	// signals found.
	let credit = 0;
	for (const concrete of CONCRETE) {
		if (!concrete.re.test(text)) continue;
		credit += concrete.credit;
		flags.push(`concrete:${concrete.id}`);
	}
	score -= Math.min(credit, MAX_CONCRETE_CREDIT, score / 2);

	return { score: Math.max(0, Math.min(1, score)), flags };
}
