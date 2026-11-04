/**
 * Scoring math and result normalization for the cat beauty judge.
 *
 * The model scores every dimension on a 0–100 completion scale; the weighted
 * total is always computed here so the breed's published point allocation is the
 * only thing that decides the 100-point total. This keeps the final number stable
 * even when the model is chatty about its own arithmetic.
 *
 * @module dsh-cat-beauty/score
 */

/** Grade bands from top to bottom. Labels are deliberately playful but the notes explain the CFA intent. */
export const GRADE_BANDS = [
  { min: 95, id: 'splus', label: 'Best in Show 级', note: '顶级赛猫水准，几乎无可挑剔' },
  { min: 90, id: 's', label: 'Grand Champion 级', note: '优秀赛级，细节非常到位' },
  { min: 85, id: 'aplus', label: 'Champion 级', note: '赛级水准，仅有轻微偏差' },
  { min: 79, id: 'a', label: '赛级预备', note: '品相明显高于普通家猫' },
  { min: 72, id: 'bplus', label: '品相优良', note: '可爱的标准家猫，有突出优点' },
  { min: 65, id: 'b', label: '标准家猫', note: '日常颜值在线，符合大众审美' },
  { min: 55, id: 'c', label: '个性选手', note: '不走标准路线，但很有辨识度' },
  { min: 0, id: 'd', label: '灵魂选手', note: '颜值全点在性格上了' },
]

/** Clamp one model score to an integer 0–100. @param {unknown} value @param {number} fallback @returns {number} */
export function clampScore(value, fallback = 60) {
  const number = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof number !== 'number' || !Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(100, Math.round(number)))
}

/**
 * Weighted 100-point total: each dimension's 0–100 completion score scales its
 * share of the breed's point allocation.
 * @param {readonly { key: string, max: number }[]} points - the breed's score points.
 * @param {Record<string, number>} scores - completion score per point key.
 * @returns {number} rounded total in 0–100.
 */
export function weightedTotal(points, scores) {
  const total = points.reduce((sum, point) => sum + (clampScore(scores?.[point.key], 0) / 100) * point.max, 0)
  return Math.max(0, Math.min(100, Math.round(total)))
}

/** @param {readonly { max: number }[]} points @returns {boolean} whether the allocation sums to exactly 100. */
export function allocationIs100(points) {
  return Math.round(points.reduce((sum, point) => sum + point.max, 0)) === 100
}

/** @param {number} total - 0–100 weighted total. @returns {typeof GRADE_BANDS[number]} the matching band. */
export function gradeFor(total) {
  return GRADE_BANDS.find((band) => total >= band.min) ?? GRADE_BANDS[GRADE_BANDS.length - 1]
}

/**
 * Extract the first balanced JSON object from model text.
 *
 * Handles a fenced code block, leading prose, trailing commentary, and the two
 * failure modes seen in practice: invisible characters around the payload and a
 * response truncated mid-object by the token cap. Truncation repair closes the
 * string/brackets and, when the tail is still malformed, walks back to the last
 * comma so a partial-but-valid scorecard survives.
 * @param {string} text - raw model output.
 * @returns {Record<string, unknown>|undefined} the parsed object, or undefined.
 */
export function extractJson(text) {
  if (typeof text !== 'string') return undefined
  const cleaned = text
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned)
  const sources = fenced === null ? [cleaned] : [fenced[1], cleaned]

  for (const source of sources) {
    const first = source.indexOf('{')
    if (first === -1) continue
    // The payload normally starts at the first brace. Repair (close a truncated
    // tail) is attempted on that outer object before any later brace, because a
    // later brace is usually a nested object and would parse as a partial card.
    const balanced = parseBalancedObject(source, first)
    if (balanced !== undefined) return balanced
    const repaired = repairTruncatedObject(source)
    if (repaired !== undefined) return repaired
    // Prose before the payload: try later starts, balanced-only.
    let searchFrom = first + 1
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const start = source.indexOf('{', searchFrom)
      if (start === -1) break
      const later = parseBalancedObject(source, start)
      if (later !== undefined) return later
      searchFrom = start + 1
    }
  }
  return undefined
}

/**
 * Parse the object that starts at `start` when it closes normally.
 * @param {string} source - candidate text.
 * @param {number} start - index of the opening brace.
 * @returns {Record<string, unknown>|undefined} parsed object.
 */
function parseBalancedObject(source, start) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return parseLenientObject(source.slice(start, index + 1))
    }
  }
  return undefined
}

/**
 * Parse one object body, retrying after removing trailing commas.
 * @param {string} body - object text that should be complete.
 * @returns {Record<string, unknown>|undefined} parsed object.
 */
function parseLenientObject(body) {
  const candidates = [body, body.replace(/,\s*([}\]])/g, '$1')]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed
    } catch {
      /* try the next candidate */
    }
  }
  return undefined
}

/**
 * Recover a scorecard from a truncated response: close the open string and
 * brackets, and if the tail is still malformed, drop the trailing segment and
 * try again until the object parses.
 * @param {string} source - full model text.
 * @returns {Record<string, unknown>|undefined} parsed object.
 */
function repairTruncatedObject(source) {
  const start = source.indexOf('{')
  if (start === -1) return undefined
  let candidate = source.slice(start).trimEnd()
  if (candidate.endsWith('```')) candidate = candidate.slice(0, -3).trimEnd()

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const fixed = closeJson(candidate)
    if (fixed !== undefined) {
      const parsed = parseLenientObject(fixed)
      if (parsed !== undefined) return parsed
    }
    const cut = candidate.lastIndexOf(',')
    if (cut <= 0) return undefined
    candidate = candidate.slice(0, cut).trimEnd()
  }
  return undefined
}

/**
 * Close a truncated JSON object: terminate an open string, drop a trailing
 * comma, and append the missing closers in reverse order.
 * @param {string} text - truncated object text beginning with `{`.
 * @returns {string|undefined} closed text, or undefined when brackets mismatch.
 */
function closeJson(text) {
  let inString = false
  let escaped = false
  const stack = []
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') stack.push(char)
    else if (char === '}' || char === ']') {
      const open = stack.pop()
      if ((char === '}' && open !== '{') || (char === ']' && open !== '[')) return undefined
    }
  }
  let fixed = text
  if (inString) fixed += '"'
  fixed = fixed.replace(/,\s*$/, '')
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    fixed += stack[index] === '{' ? '}' : ']'
  }
  return fixed
}

/** Clamp one price estimate to a sane CNY range; non-numbers become 0 (no estimate). */
export function clampPrice(value) {
  const number = typeof value === 'string' ? Number(value.replace(/[^\d.]/g, '')) : value
  if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) return 0
  return Math.min(500_000, Math.round(number))
}

/**
 * Normalize one model answer into a renderable result.
 *
 * Missing dimensions are filled conservatively, scores are clamped, and the
 * total always comes from the breed allocation rather than the model.
 * @param {Record<string, unknown>|undefined} raw - parsed model JSON (may be undefined).
 * @param {{ id: string, name: string, points: readonly { key: string, label: string, max: number }[] }} breed - the scored breed.
 * @returns {{
 *   breedId: string, breedName: string, caption: string,
 *   breedMatch: number, breedNote: string,
 *   scores: Record<string, number>, comments: Record<string, string>,
 *   highlights: string[], improvements: string[], judge: string, total: number,
 * }} the normalized result.
 */
export function normalizeResult(raw, breed) {
  const scores = {}
  const comments = {}
  const rawScores = raw !== undefined && typeof raw.scores === 'object' && raw.scores !== null ? raw.scores : {}
  const rawComments = raw !== undefined && typeof raw.comments === 'object' && raw.comments !== null ? raw.comments : {}

  for (const point of breed.points) {
    const hasScore = Object.prototype.hasOwnProperty.call(rawScores, point.key)
    scores[point.key] = hasScore ? clampScore(rawScores[point.key], 60) : 60
    const comment = rawComments[point.key]
    comments[point.key] =
      typeof comment === 'string' && comment.trim() !== ''
        ? comment.trim()
        : hasScore
          ? '照片角度有限，该项按可见部分评估。'
          : '该项在照片中不可见，按保守值计分。'
  }

  const list = (value, limit) =>
    Array.isArray(value)
      ? value
          .filter((entry) => typeof entry === 'string' && entry.trim() !== '')
          .map((entry) => entry.trim())
          .slice(0, limit)
      : []

  const text = (value, max) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : ''

  const rawPrice = raw !== undefined && typeof raw.priceEstimate === 'object' && raw.priceEstimate !== null ? raw.priceEstimate : {}
  const priceMin = clampPrice(rawPrice.min)
  const priceMax = priceMin === 0 ? 0 : Math.max(priceMin, clampPrice(rawPrice.max))

  return {
    breedId: breed.id,
    breedName: breed.name,
    priceEstimate: {
      min: priceMin,
      max: priceMax,
      currency: 'CNY',
      note: text(rawPrice.note, 60) || '参考价受血统、证书、地区与年龄影响，仅供娱乐。',
    },
    caption: text(raw?.caption, 24) || '一只很有想法的猫',
    breedMatch: raw === undefined ? 0 : clampScore(raw.breedMatch, 50),
    breedNote: text(raw?.breedNote, 120) || '未能取得品种匹配说明。',
    scores,
    comments,
    highlights: list(raw?.highlights, 3),
    improvements: list(raw?.improvements, 3),
    judge: text(raw?.judge, 400) || '裁判还在整理措辞，请再看一眼照片。',
    total: weightedTotal(breed.points, scores),
  }
}

/**
 * Assert the shipped breed table is internally consistent: unique ids, unique
 * point keys, and every point allocation summing to exactly 100.
 * @param {readonly { id: string, name: string, points: readonly { key: string, max: number }[] }[]} breeds - breed table.
 * @returns {void}
 * @throws {Error} when a breed breaks the contract.
 */
export function validateBreeds(breeds) {
  const ids = new Set()
  for (const breed of breeds) {
    if (ids.has(breed.id)) throw new Error(`duplicate breed id: ${breed.id}`)
    ids.add(breed.id)
    const keys = new Set()
    for (const point of breed.points) {
      if (keys.has(point.key)) throw new Error(`${breed.id}: duplicate point key "${point.key}"`)
      keys.add(point.key)
      if (!Number.isFinite(point.max) || point.max <= 0) throw new Error(`${breed.id}.${point.key}: bad max`)
    }
    if (!allocationIs100(breed.points)) {
      const sum = breed.points.reduce((total, point) => total + point.max, 0)
      throw new Error(`${breed.id}: point allocation sums to ${sum}, expected 100`)
    }
    if (breed.points.length < 3) throw new Error(`${breed.id}: needs at least 3 score points`)
  }
}
