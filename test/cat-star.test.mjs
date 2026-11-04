/**
 * Unit and route tests for dsh-cat-beauty.
 *
 * Run: node test/cat-beauty.test.mjs
 *
 * The route tests mount the real handler against a fake ctx (webServer, llm,
 * attachments) so the wire contract — admission, validation, weighting, error
 * codes — is pinned without a model or a live server.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../index.js'
import { BREEDS } from '../src/breeds.js'
import { buildJudgePrompt } from '../src/prompt.js'
import {
  GRADE_BANDS,
  clampScore,
  extractJson,
  gradeFor,
  normalizeResult,
  validateBreeds,
  weightedTotal,
} from '../src/score.js'

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`ok   ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

/* ------------------------------ breed data ------------------------------ */

check('breed table is internally valid (unique ids/keys, each sums to 100)', () => {
  validateBreeds(BREEDS)
  assert.ok(BREEDS.length >= 30, `expected at least 30 breeds, got ${BREEDS.length}`)
})

check('every breed carries at least 3 score points and a Chinese name', () => {
  for (const breed of BREEDS) {
    assert.ok(breed.points.length >= 3, breed.id)
    assert.ok(breed.name.length > 0, breed.id)
    assert.ok(breed.en.length > 0, breed.id)
    assert.ok(breed.coat in { long: 1, short: 1, hairless: 1, rex: 1 }, breed.id)
  }
})

check('persian matches the CFA published allocation', () => {
  const persian = BREEDS.find((breed) => breed.id === 'persian')
  assert.deepEqual(
    persian.points.map((point) => [point.key, point.max]),
    [
      ['head', 30],
      ['body', 20],
      ['coat', 10],
      ['balance', 5],
      ['refinement', 5],
      ['color', 20],
      ['eyeColor', 10],
    ],
  )
})

/* -------------------------------- scoring -------------------------------- */

check('weighted total uses the breed allocation, not a flat mean', () => {
  const points = [
    { key: 'head', max: 30 },
    { key: 'body', max: 70 },
  ]
  // 100 on head (30 pts) + 50 on body (35 pts) = 65
  assert.equal(weightedTotal(points, { head: 100, body: 50 }), 65)
})

check('weighted total clamps and rounds', () => {
  const points = [{ key: 'a', max: 100 }]
  assert.equal(weightedTotal(points, { a: 130 }), 100)
  assert.equal(weightedTotal(points, { a: -5 }), 0)
  assert.equal(weightedTotal(points, { a: 66.6 }), 67)
})

check('clampScore accepts numeric strings and falls back', () => {
  assert.equal(clampScore('88'), 88)
  assert.equal(clampScore('bad', 70), 70)
  assert.equal(clampScore(undefined, 55), 55)
})

check('grade bands are ordered and exhaustive', () => {
  assert.equal(gradeFor(100).id, 'splus')
  assert.equal(gradeFor(85).id, 'aplus')
  assert.equal(gradeFor(0).id, 'd')
  for (let total = 0; total <= 100; total += 1) {
    assert.ok(gradeFor(total), String(total))
  }
  assert.equal(GRADE_BANDS[GRADE_BANDS.length - 1].min, 0)
})

/* ------------------------------ JSON parsing ------------------------------ */

check('extractJson parses a fenced object', () => {
  const text = 'Here you go:\n```json\n{"subject":"cat","scores":{"head":80}}\n```\nThanks.'
  assert.deepEqual(extractJson(text), { subject: 'cat', scores: { head: 80 } })
})

check('extractJson survives braces inside strings', () => {
  const text = '{"caption":"这只猫的嘴巴像 } 一样","n":1}'
  assert.deepEqual(extractJson(text), { caption: '这只猫的嘴巴像 } 一样', n: 1 })
})

check('extractJson returns undefined for garbage', () => {
  assert.equal(extractJson('no json here'), undefined)
  assert.equal(extractJson('{"broken": '), undefined)
  assert.equal(extractJson(''), undefined)
})

check('extractJson repairs a response truncated mid-string', () => {
  const truncated =
    '{"subject":"cat","caption":"圆脸","scores":{"head":80,"body":70,"coat":60,"balance":50,"refinement":40,"color":30,"eyeColor":20},"comments":{"head":"好","body":"还行","coat":"短","balance":"平","refinement":"嫩","color":"灰'
  const parsed = extractJson(truncated)
  assert.ok(parsed, 'truncated payload should still parse')
  assert.equal(parsed.subject, 'cat')
  assert.equal(parsed.scores.head, 80)
  assert.equal(parsed.scores.eyeColor, 20)
})

check('extractJson repairs a response truncated mid-number', () => {
  const parsed = extractJson('{"subject":"cat","scores":{"head":80,"body":7')
  assert.ok(parsed)
  assert.equal(parsed.subject, 'cat')
  assert.equal(parsed.scores.head, 80)
})

check('extractJson tolerates trailing commas', () => {
  assert.deepEqual(extractJson('{"subject":"cat","scores":{"head":80,},}'), { subject: 'cat', scores: { head: 80 } })
})

/* ----------------------------- normalization ----------------------------- */

check('normalizeResult fills missing dimensions with conservative defaults', () => {
  const breed = { id: 'x', name: '测试猫', points: [{ key: 'head', label: '头部', max: 100 }] }
  const result = normalizeResult(undefined, breed)
  assert.equal(result.scores.head, 60)
  assert.equal(result.total, 60)
  assert.equal(result.breedMatch, 0)
  assert.ok(result.judge.length > 0)
  assert.ok(result.comments.head.includes('不可见'))
})

check('normalizeResult clamps out-of-range and wrong-typed scores', () => {
  const breed = { id: 'x', name: '测试猫', points: [{ key: 'head', label: '头部', max: 50 }, { key: 'eye', label: '眼睛', max: 50 }] }
  const result = normalizeResult({ scores: { head: 120, eye: '七十分' }, comments: { head: '好', eye: '还行' }, caption: '  ', highlights: ['a', '', 3], improvements: [] }, breed)
  assert.equal(result.scores.head, 100)
  assert.equal(result.scores.eye, 60) // unparseable -> fallback
  assert.equal(result.total, Math.round((100 / 100) * 50 + (60 / 100) * 50))
  assert.deepEqual(result.highlights, ['a'])
  assert.ok(result.caption.length > 0)
  assert.equal(result.priceEstimate.min, 0)
  assert.equal(result.priceEstimate.max, 0)
})

check('normalizeResult keeps a valid CNY price range', () => {
  const breed = { id: 'x', name: '测试猫', points: [{ key: 'head', label: '头部', max: 100 }] }
  const result = normalizeResult({ scores: { head: 80 }, priceEstimate: { min: 3000, max: 8000, note: '布偶宠物级' } }, breed)
  assert.equal(result.priceEstimate.min, 3000)
  assert.equal(result.priceEstimate.max, 8000)
  assert.equal(result.priceEstimate.currency, 'CNY')
  assert.ok(result.priceEstimate.note.length > 0)
})

check('prompt mentions every score key and forbids markdown fences', () => {
  const persian = BREEDS.find((breed) => breed.id === 'persian')
  const { system, user } = buildJudgePrompt(persian)
  for (const point of persian.points) assert.ok(user.includes(point.key), point.key)
  assert.ok(system.includes('JSON'))
  assert.ok(system.includes('不要') || system.includes('不要用'))
  assert.ok(system.length > 200)
})

check('prompt distinguishes multi-photo from video frames', () => {
  const persian = BREEDS.find((breed) => breed.id === 'persian')
  const multi = buildJudgePrompt(persian, { frameCount: 3, kind: 'photo' })
  const video = buildJudgePrompt(persian, { frameCount: 4, kind: 'video' })
  assert.ok(multi.user.includes('3 张照片'), 'multi-photo copy')
  assert.ok(multi.user.includes('不同角度'), 'multi-photo angles')
  assert.ok(video.user.includes('视频'), 'video copy')
  assert.ok(video.user.includes('4 张图片'), 'video frame count')
})

/* -------------------------------- routes -------------------------------- */

class FakeResponse {
  constructor() {
    this.status = 0
    this.headers = {}
    this.body = ''
    this.headersSent = false
  }
  writeHead(status, headers) {
    this.status = status
    Object.assign(this.headers, headers ?? {})
    this.headersSent = true
  }
  end(chunk) {
    if (chunk !== undefined) this.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  }
  on() {}
  destroy() {}
}

function makeRequest(method, path, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload)
  const stream = Readable.from(body === '' ? [] : [Buffer.from(body, 'utf8')])
  stream.method = method
  stream.url = path
  stream.headers = { host: '127.0.0.1:3080', 'content-type': 'application/json' }
  return stream
}

function makeJudgeStream(typeValid = true) {
  const breed = BREEDS.find((entry) => entry.id === 'persian')
  const scores = Object.fromEntries(breed.points.map((point) => [point.key, 80]))
  const comments = Object.fromEntries(breed.points.map((point) => [point.key, '点评']))
  const payload = typeValid
    ? {
        subject: 'cat',
        caption: '圆脸小可爱',
        breedMatch: 88,
        breedNote: '特征基本符合波斯猫',
        scores,
        comments,
        highlights: ['眼睛圆', '毛量足'],
        improvements: ['鼻梁略高'],
        judge: '整体是一只漂亮的波斯猫。',
      }
    : { subject: 'other', caption: '未知生物' }
  const text = typeValid ? JSON.stringify(payload) : JSON.stringify(payload)
  return (async function* generate() {
    yield { type: 'text-delta', index: 0, text: text.slice(0, 10) }
    yield { type: 'text-delta', index: 0, text: text.slice(10) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

function makeCtx(options = {}) {
  const routes = []
  const ctx = {
    effect(fn) {
      return fn()
    },
    get(name) {
      return options.services?.[name]
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    attachments: {
      saveImage: async () => ({ attachmentId: 'att_test', mediaType: 'image/jpeg', bytes: 9, width: 10, height: 10 }),
    },
    llm: {
      stream() {
        return options.judgeStream ? options.judgeStream() : makeJudgeStream()
      },
    },
  }
  return { ctx, routes }
}

async function callRoute(routes, method, path, payload) {
  assert.equal(routes.length, 1)
  const response = new FakeResponse()
  await routes[0].handler(makeRequest(method, path, payload), response)
  let parsed
  try {
    parsed = response.body === '' ? undefined : JSON.parse(response.body)
  } catch {
    parsed = undefined
  }
  return { status: response.status, headers: response.headers, payload: parsed, text: response.body }
}

async function routesWork() {
  const { ctx, routes } = makeCtx()
  apply(ctx)

  const breeds = await callRoute(routes, 'GET', '/cat-beauty/breeds')
  assert.equal(breeds.status, 200)
  assert.equal(breeds.payload.ok, true)
  assert.equal(breeds.payload.breeds.length, BREEDS.length)
  assert.deepEqual(Object.keys(breeds.payload.breeds[0]).sort(), ['blurb', 'coat', 'en', 'id', 'name', 'points'])

  const scored = await callRoute(routes, 'POST', '/cat-beauty/score', {
    breedId: 'persian',
    images: [{ mediaType: 'image/jpeg', data: Buffer.from('fake-jpeg').toString('base64') }],
    fileName: 'cat.jpg',
  })
  assert.equal(scored.status, 200)
  assert.equal(scored.payload.ok, true)
  assert.equal(scored.payload.result.total, 80)
  assert.equal(scored.payload.result.breedId, 'persian')
  assert.equal(scored.payload.meta.provider, 'deepseek-official')
  assert.equal(scored.payload.meta.frames, 1)

  const multiFrame = await callRoute(routes, 'POST', '/cat-beauty/score', {
    breedId: 'persian',
    images: [
      { mediaType: 'image/jpeg', data: 'AAAA' },
      { mediaType: 'image/jpeg', data: 'BBBB' },
      { mediaType: 'image/jpeg', data: 'CCCC' },
      { mediaType: 'image/jpeg', data: 'DDDD' },
    ],
    fileName: 'cat-video',
  })
  assert.equal(multiFrame.status, 200)
  assert.equal(multiFrame.payload.ok, true)
  assert.equal(multiFrame.payload.meta.frames, 4)

  const legacy = await callRoute(routes, 'POST', '/cat-beauty/score', {
    breedId: 'persian',
    mediaType: 'image/jpeg',
    data: 'AAAA',
  })
  assert.equal(legacy.status, 200)
  assert.equal(legacy.payload.ok, true)

  const unknown = await callRoute(routes, 'POST', '/cat-beauty/score', {
    breedId: 'dragon',
    images: [{ mediaType: 'image/jpeg', data: 'AAAA' }],
  })
  assert.equal(unknown.status, 400)
  assert.equal(unknown.payload.error.code, 'UNKNOWN_BREED')

  const badMedia = await callRoute(routes, 'POST', '/cat-beauty/score', {
    breedId: 'persian',
    images: [{ mediaType: 'image/gif2', data: 'AAAA' }],
  })
  assert.equal(badMedia.status, 400)
  assert.equal(badMedia.payload.error.code, 'UNSUPPORTED_MEDIA_TYPE')

  const tooMany = await callRoute(routes, 'POST', '/cat-beauty/score', {
    breedId: 'persian',
    images: Array.from({ length: 7 }, () => ({ mediaType: 'image/jpeg', data: 'AAAA' })),
  })
  assert.equal(tooMany.status, 400)
  assert.equal(tooMany.payload.error.code, 'TOO_MANY_IMAGES')

  const notCat = makeCtx({ judgeStream: () => makeJudgeStream(false) })
  apply(notCat.ctx)
  const other = await callRoute(notCat.routes, 'POST', '/cat-beauty/score', {
    breedId: 'persian',
    images: [{ mediaType: 'image/jpeg', data: 'AAAA' }],
  })
  assert.equal(other.status, 200)
  assert.equal(other.payload.ok, false)
  assert.equal(other.payload.error.code, 'NOT_A_CAT')

  const wrongMethod = await callRoute(routes, 'POST', '/cat-beauty/breeds', {})
  assert.equal(wrongMethod.status, 405)
  console.log(`ok   routes: breeds, photo, multi-frame, legacy, validation, non-cat, method guard`)

  // read-file: the host reads a path pasted from Finder and returns media bytes.
  const dir = await mkdtemp(join(tmpdir(), 'cat-beauty-test-'))
  try {
    const imagePath = join(dir, 'cat.png')
    const textPath = join(dir, 'notes.txt')
    await writeFile(imagePath, Buffer.from('fake-png-bytes'))
    await writeFile(textPath, 'hello')

    const read = await callRoute(routes, 'POST', '/cat-beauty/read-file', { path: imagePath })
    assert.equal(read.status, 200)
    assert.equal(read.payload.ok, true)
    assert.equal(read.payload.name, 'cat.png')
    assert.equal(read.payload.mediaType, 'image/png')
    assert.equal(Buffer.from(read.payload.data, 'base64').toString('utf8'), 'fake-png-bytes')

    const missing = await callRoute(routes, 'POST', '/cat-beauty/read-file', { path: join(dir, 'nope.mp4') })
    assert.equal(missing.status, 404)
    assert.equal(missing.payload.error.code, 'FILE_NOT_FOUND')

    const relative = await callRoute(routes, 'POST', '/cat-beauty/read-file', { path: 'cat.png' })
    assert.equal(relative.status, 400)
    assert.equal(relative.payload.error.code, 'BAD_PATH')

    const unsupported = await callRoute(routes, 'POST', '/cat-beauty/read-file', { path: textPath })
    assert.equal(unsupported.status, 400)
    assert.equal(unsupported.payload.error.code, 'UNSUPPORTED_MEDIA_TYPE')
    console.log('ok   routes: read-file (media bytes, missing, relative path, unsupported extension)')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  // Admission: a mounted connection service that rejects must win.
  const fenced = makeCtx({ services: { connection: { requestRejection: () => 403 } } })
  apply(fenced.ctx)
  const rejected = await callRoute(fenced.routes, 'GET', '/cat-beauty/breeds')
  assert.equal(rejected.status, 403)
  console.log('ok   routes: connection admission fence')
}


function makeDetectStream(subject = 'cat') {
  const payload = {
    subject,
    speciesNote: subject === 'cat' ? '一只重点色猫' : '一只狗',
    candidates: subject === 'cat'
      ? [
          { breedId: 'ragdoll', confidence: 0.86, reason: '重点色蓝眼' },
          { breedId: 'persian', confidence: 0.2, reason: '脸偏圆' },
        ]
      : [],
  }
  const text = JSON.stringify(payload)
  return (async function* generate() {
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

async function detectWorks() {
  const { ctx, routes } = makeCtx({ judgeStream: () => makeDetectStream('cat') })
  apply(ctx)
  const detected = await callRoute(routes, 'POST', '/cat-beauty/detect', {
    images: [{ mediaType: 'image/jpeg', data: 'AAAA' }],
  })
  assert.equal(detected.status, 200)
  assert.equal(detected.payload.ok, true)
  assert.equal(detected.payload.subject, 'cat')
  assert.equal(detected.payload.candidates.length, 2)
  assert.equal(detected.payload.candidates[0].breedId, 'ragdoll')
  assert.equal(detected.payload.candidates[0].confidence, 86)
  assert.equal(detected.payload.candidates[1].confidence, 20)

  const dogCtx = makeCtx({ judgeStream: () => makeDetectStream('dog') })
  apply(dogCtx.ctx)
  const dog = await callRoute(dogCtx.routes, 'POST', '/cat-beauty/detect', {
    images: [{ mediaType: 'image/jpeg', data: 'AAAA' }],
  })
  assert.equal(dog.status, 200)
  assert.equal(dog.payload.subject, 'dog')
  assert.equal(dog.payload.candidates.length, 0)
  console.log('ok   routes: detect (cat candidates, normalized confidence, non-cat subject)')
}

/* ------------------------------- run async ------------------------------- */

async function main() {
  await routesWork()
  await detectWorks()
  console.log(`\n${passed + 4} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
