// The 19 quiz axes (SPEC sections 1 and 5b). Every axis runs -2..+2.
// neg/pos: pole names. likeNeg/likePos: short phrases used in the one-line match reasons.

export const AXES = [
  { id: 'econ', group: 'ideology', neg: 'Big state', pos: 'Free market', likeNeg: 'a bigger state', likePos: 'free markets' },
  { id: 'social', group: 'ideology', neg: 'Traditional', pos: 'Progressive', likeNeg: 'tradition', likePos: 'progress' },
  { id: 'world', group: 'ideology', neg: 'Restraint', pos: 'Hawk', likeNeg: 'restraint abroad', likePos: 'leading the world' },
  { id: 'system', group: 'ideology', neg: 'Institutionalist', pos: 'Insurgent', likeNeg: 'the institutions', likePos: 'burning it down' },
  { id: 'trade', group: 'ideology', neg: 'Tariffs', pos: 'Free trade', likeNeg: 'tariffs', likePos: 'free trade' },
  { id: 'faith', group: 'ideology', neg: 'Secular', pos: 'Faith in public', likeNeg: 'a secular public square', likePos: 'faith in public life' },
  { id: 'border', group: 'ideology', neg: 'Restrict', pos: 'Open', likeNeg: 'a hard border', likePos: 'open doors' },
  { id: 'tech', group: 'ideology', neg: 'Tech skeptic', pos: 'Accelerate', likeNeg: 'reining in Big Tech', likePos: 'accelerating tech' },
  { id: 'federal', group: 'ideology', neg: 'Centralize', pos: 'States’ rights', likeNeg: 'a strong federal hand', likePos: 'power back to the states' },
  { id: 'democracy', group: 'ideology', neg: 'Strongman', pos: 'Democratic norms', likeNeg: 'a strong executive', likePos: 'democratic norms' },
  { id: 'liberty', group: 'ideology', neg: 'Security', pos: 'Freedom', likeNeg: 'security and order', likePos: 'civil liberties' },
  { id: 'online', group: 'style', neg: 'Offline', pos: 'Extremely online', likeNeg: 'old media', likePos: 'living online' },
  { id: 'style', group: 'style', neg: 'Conciliator', pos: 'Brawler', likeNeg: 'the handshake', likePos: 'the brawl' },
  { id: 'loyalty', group: 'style', neg: 'Free agent', pos: 'Loyal', likeNeg: 'free agency', likePos: 'loyalty to the leader' },
  { id: 'dynasty', group: 'power', neg: 'Meritocrat', pos: 'Family power', likeNeg: 'merit over names', likePos: 'family power' },
  { id: 'libertine', group: 'power', neg: 'Puritan', pos: 'Libertine', likeNeg: 'a clean private life', likePos: 'scandal-proof nerves' },
  { id: 'mach', group: 'triad', neg: 'Straight dealer', pos: 'Schemer', likeNeg: 'straight dealing', likePos: 'the long game' },
  { id: 'narc', group: 'triad', neg: 'Self-effacing', pos: 'Main character', likeNeg: 'a low profile', likePos: 'the spotlight' },
  { id: 'psych', group: 'triad', neg: 'Soft-hearted', pos: 'Ruthless', likeNeg: 'a soft heart', likePos: 'cold calculation' },
];

export const AXIS_IDS = AXES.map(a => a.id);
export const AXIS = Object.fromEntries(AXES.map(a => [a.id, a]));

// How much each group counts in candidate matching.
export const GROUP_WEIGHT = { ideology: 1, style: 0.75, power: 0.6, triad: 0.6 };

export const CHAPTERS = ['announcement', 'primary', 'debate', 'backroom', 'scandal', 'convention', 'election_night'];
export const CHAPTER_SHARE = { announcement: 10, primary: 20, debate: 15, backroom: 15, scandal: 15, convention: 10, election_night: 15 };
export const CHAPTER_TITLE = {
  announcement: 'The Announcement',
  primary: 'The Primary',
  debate: 'The Debate',
  backroom: 'The Backroom',
  scandal: 'The Scandal',
  convention: 'The Convention',
  election_night: 'Election Night',
};
export const CHAPTER_LINE = {
  announcement: 'Every campaign starts with a lie about why.',
  primary: 'Snow in Iowa. Diners in New Hampshire. Your own party first.',
  debate: 'Ninety minutes. Two podiums too many.',
  backroom: 'Where the real votes are counted, and nobody takes minutes.',
  scandal: 'Somebody kept a folder on you.',
  convention: 'Balloons, delegates and a knife behind every speech.',
  election_night: 'The map lights up. The phones do not stop.',
};
