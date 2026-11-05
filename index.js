/**
 * dsh-cat-star — host half.
 *
 * Serves four things over one browser-authenticated prefix route:
 *
 *   GET  /cat-beauty/breeds      the shipped CFA-inspired score cards (for the picker)
 *   POST /cat-beauty/score       one photo or N video frames + a breed id -> a scorecard
 *   POST /cat-beauty/read-file   read a local media path pasted into the panel
 *
 * The score itself is a one-shot model call through `ctx.llm` with the media
 * admitted by `ctx.attachments`. The total is always recomputed host-side from the
 * breed's published point allocation, never trusted from the model.
 *
 * `read-file` exists because a browser cannot see the bytes behind a Finder paste:
 * the clipboard carries only a path. This host runs on the same machine, so it can
 * read that path and hand the bytes back for local frame extraction.
 *
 * @module dsh-cat-star
 */

import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BREEDS, breedById } from './src/breeds.js'
import { buildJudgePrompt } from './src/prompt.js'
import { extractJson, normalizeResult, validateBreeds } from './src/score.js'

/** Plugin row identity for the profile patch. */
export const name = 'dsh-cat-star'

/**
 * Services required before mounting. `llm` and `attachments` do the judging,
 * `webServer` owns the route, and `connection` carries the deployment's
 * request-admission fence (same fence `/api` applies).
 */
export const inject = ['llm', 'attachments', 'webServer', 'connection']

/** Route prefix. One prefix route so the two operations share the admission path. */
const ROUTE_PATH = '/cat-beauty'

/** Largest accepted request body: a 25 MiB image becomes ~34 MiB of base64, so 48 MiB leaves headroom. */
const MAX_BODY_BYTES = 48 * 1024 * 1024

/** Largest accepted decoded image, mirrored to the UI copy. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/** Largest accepted video file for the paste-a-path route, mirrored to the UI copy. */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024

/** Most frames accepted for one video clip (photos are processed as one frame). */
const MAX_IMAGES = 6

/** Model used for judging. An image-capable route is required. */
const JUDGE_PROVIDER = process.env.DSH_CAT_JUDGE_PROVIDER || 'deepseek-official'
const JUDGE_MODEL = process.env.DSH_CAT_JUDGE_MODEL || 'deepseek-flash'

/** Judge call ceiling; one parse-failure retry must fit. The browser waits a little longer. */
const JUDGE_TIMEOUT_MS = 180_000

/** Output budget. Too small a cap truncates the JSON and used to break parsing. */
const JUDGE_MAX_TOKENS = 4096

/** Accepted source image media types. */
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Extension -> media type for the paste-a-path route. Video files are frame-extracted in the browser. */
const LOCAL_MEDIA_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
  ['mov', 'video/quicktime'],
  ['m4v', 'video/x-m4v'],
  ['avi', 'video/x-msvideo'],
  ['mkv', 'video/x-matroska'],
])

/** Public leaderboard entry the host forwards publishes to (same-origin for the browser). */
const LEADERBOARD_TARGET = process.env.DSH_CAT_LEADERBOARD_URL || 'https://dsh-cat-beauty-leaderboard.netlify.app'

/** In-flight judge calls. Photos are cheap, but model calls are not: cap concurrency at 2. */
let inFlight = 0
const MAX_IN_FLIGHT = 2

/** One request-scoped error with the HTTP status the client should see. */
class RouteError extends Error {
  /**
   * @param {string} message - client-facing message.
   * @param {number} status - HTTP status to answer with.
   * @param {string} code - stable machine-readable code.
   */
  constructor(message, status, code) {
    super(message)
    this.name = 'RouteError'
    this.status = status
    this.code = code
  }
}

/**
 * Map one failure onto the wire.
 * @param {unknown} error - whatever the handler threw.
 * @returns {RouteError} the wire error.
 */
function asRouteError(error) {
  if (error instanceof RouteError) return error
  if (error?.code === 'IMAGE_OFFLOAD_REQUIRED' || error?.code === 'CONTEXT_WINDOW_EXCEEDED') {
    return new RouteError(String(error.message ?? error), 413, error.code)
  }
  if (typeof error?.code === 'string' && error.code.startsWith('ATTACHMENT')) {
    return new RouteError(String(error.message ?? error), 400, error.code)
  }
  if (error?.name === 'AttachmentError' || typeof error?.code === 'string' && error.code.startsWith('IMAGE_')) {
    return new RouteError(String(error.message ?? error), 400, String(error.code))
  }
  return new RouteError(error instanceof Error ? error.message : String(error), 500, 'internal')
}

/**
 * Send a JSON body.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {number} status - HTTP status.
 * @param {unknown} payload - JSON-serializable payload.
 */
function sendJson(res, status, payload) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Whether a request may be served at all.
 *
 * Prefers the connection service's own admission decision (Host/Origin fence +
 * browser-session cookie), and falls back to the loopback/trusted-host fence when
 * that service is not mounted.
 * @param {object} ctx - the plugin context.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {number|undefined} a rejection status, or undefined to admit.
 */
function admissionStatus(ctx, req) {
  const connection = ctx.get('connection')
  if (connection?.requestRejection !== undefined) {
    return connection.requestRejection(req)
  }
  if (ctx.webRuntime?.isRequestTrusted !== undefined) {
    return ctx.webRuntime.isRequestTrusted(req) ? undefined : 403
  }
  const host = req.headers.host
  if (typeof host !== 'string') return 403
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  const loopback =
    hostname === 'localhost' ||
    hostname === '::1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  if (loopback) return undefined
  const trusted = ctx.get?.('webStartup')?.trustedHosts ?? ctx.get?.('webRuntime')?.trustedHosts
  if (Array.isArray(trusted) && trusted.some((entry) => entry === host || entry === hostname)) {
    return undefined
  }
  return 403
}

/**
 * Read a JSON request body with a hard byte cap.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {number} limit - maximum bytes.
 * @returns {Promise<Record<string, unknown>>} the parsed object.
 */
async function readJsonBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new RouteError(`请求体超过 ${Math.floor(limit / 1024 / 1024)}MB 上限`, 413, 'BODY_TOO_LARGE')
    chunks.push(chunk)
  }
  if (size === 0) throw new RouteError('请求体为空', 400, 'EMPTY_BODY')
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RouteError('请求体不是合法 JSON', 400, 'INVALID_JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RouteError('请求体必须是 JSON 对象', 400, 'INVALID_BODY')
  }
  return parsed
}

/**
 * Normalize a pasted path (plain absolute path or file:// URL).
 * @param {string} raw - clipboard text.
 * @returns {string} an absolute local path.
 */
function resolvePastedPath(raw) {
  let value = String(raw).trim().replace(/^["'`]+|["'`]+$/g, '')
  if (value.startsWith('file://')) {
    try {
      value = fileURLToPath(value)
    } catch {
      throw new RouteError('无法解析这个文件 URL', 400, 'BAD_PATH')
    }
  }
  if (!value.startsWith('/')) throw new RouteError('只支持绝对路径（或 file:// 链接）', 400, 'BAD_PATH')
  return value
}

/**
 * Read one pasted media file for the browser to preview and frame-extract.
 * @param {string} rawPath - pasted path.
 * @returns {Promise<{ mediaType: string, name: string, bytes: Buffer }>} file contents.
 */
async function readPastedMedia(rawPath) {
  const path = resolvePastedPath(rawPath)
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
  const mediaType = LOCAL_MEDIA_TYPES.get(extension)
  if (mediaType === undefined) {
    throw new RouteError('只支持图片（PNG/JPEG/WebP/GIF）或视频（MP4/WebM/MOV/M4V/AVI/MKV）', 400, 'UNSUPPORTED_MEDIA_TYPE')
  }
  let info
  try {
    info = await stat(path)
  } catch {
    throw new RouteError(`找不到文件: ${basename(path)}`, 404, 'FILE_NOT_FOUND')
  }
  if (!info.isFile()) throw new RouteError('这个路径不是普通文件', 400, 'NOT_A_FILE')
  const limit = mediaType.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
  if (info.size > limit) {
    throw new RouteError(`文件超过 ${Math.floor(limit / 1024 / 1024)}MB 上限`, 413, 'FILE_TOO_LARGE')
  }
  let bytes
  try {
    bytes = await readFile(path)
  } catch {
    throw new RouteError('读取文件失败（权限或磁盘问题）', 500, 'FILE_READ_FAILED')
  }
  return { mediaType, name: basename(path), bytes }
}


/**
 * Validate one score request's still-unparsed fields.
 *
 * Accepts the multi-image shape `{ breedId, images: [{mediaType, data}], fileName }`
 * and the legacy single-image shape `{ breedId, mediaType, data }`.
 * @param {Record<string, unknown>} body - parsed request body.
 * @returns {{ breed: object, images: { mediaType: string, data: string }[], fileName: string }} validated request.
 */
function validateImages(rawImages) {
  if (!Array.isArray(rawImages) || rawImages.length === 0) throw new RouteError('缺少图片数据', 400, 'MISSING_IMAGE')
  if (rawImages.length > MAX_IMAGES) throw new RouteError(`一次最多 ${MAX_IMAGES} 张图片`, 400, 'TOO_MANY_IMAGES')
  return rawImages.map((image, index) => {
    const mediaType = typeof image?.mediaType === 'string' ? image.mediaType : ''
    if (!MEDIA_TYPES.has(mediaType)) {
      throw new RouteError(`第 ${index + 1} 张图片类型不支持: ${mediaType || '(空)'}`, 400, 'UNSUPPORTED_MEDIA_TYPE')
    }
    const data = typeof image?.data === 'string' ? image.data.trim() : ''
    if (data === '') throw new RouteError(`第 ${index + 1} 张图片缺少数据`, 400, 'MISSING_IMAGE')
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
    const bytes = Math.floor((data.length * 3) / 4) - padding
    if (bytes > MAX_IMAGE_BYTES) {
      throw new RouteError(`第 ${index + 1} 张图片超过 ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB 上限`, 413, 'IMAGE_TOO_LARGE')
    }
    return { mediaType, data }
  })
}

/**
 * Validate one score request's still-unparsed fields.
 *
 * Accepts the multi-image shape `{ breedId, images: [{mediaType, data}], fileName }`
 * and the legacy single-image shape `{ breedId, mediaType, data }`.
 * @param {Record<string, unknown>} body - parsed request body.
 * @returns {{ breed: object, images: { mediaType: string, data: string }[], fileName: string, mediaKind: 'photo'|'video' }} validated request.
 */
function validateScoreRequest(body) {
  const breedId = typeof body.breedId === 'string' ? body.breedId : ''
  const breed = breedById(breedId)
  if (breed === undefined) throw new RouteError(`未知品种: ${breedId || '(空)'}`, 400, 'UNKNOWN_BREED')

  let rawImages = Array.isArray(body.images) ? body.images : []
  if (rawImages.length === 0 && typeof body.data === 'string' && body.data.trim() !== '') {
    rawImages = [{ mediaType: body.mediaType, data: body.data }]
  }
  const images = validateImages(rawImages)

  const fileName = typeof body.fileName === 'string' && body.fileName.trim() !== '' ? body.fileName.trim().slice(0, 80) : 'cat-photo'
  const mediaKind = body.mediaKind === 'video' ? 'video' : 'photo'
  return { breed, images, fileName, mediaKind }
}

/** Prompt for the auto-detect route: species + closest CFA breeds. */
function buildDetectPrompt() {
  const breedLines = BREEDS.map((breed) => `- ${breed.id}: ${breed.name}（${breed.en}）— ${breed.blurb}`).join('\n')
  const system = `你是猫品种识别专家。根据照片判断画面里的动物是不是猫，如果是猫，给出最接近的 CFA 品种候选。只输出一个 JSON 对象，不要 Markdown 代码块，不要输出思考过程。`
  const user = `候选品种（id: 中文名（英文名）— 特点）：
${breedLines}

请识别这张照片并输出：
{"subject":"cat"|"dog"|"other","speciesNote":"一句话说明画面里是什么动物、什么状态","candidates":[{"breedId":"上面列表里的 id","confidence":0-1 的数字,"reason":"20 字以内的判断依据"}]}

要求：
- candidates 最多 3 个，按置信度降序；只使用上面列表里的 breedId。
- 如果画面里不是猫，candidates 用空数组，speciesNote 说明是什么动物。
- 如果照片看不清，给低置信度并说明。`
  return { system, user }
}

/**
 * Run one detect call and normalize its answer.
 * @param {object} ctx - the plugin context.
 * @param {{ type: 'image', attachment: object }[]} imageBlocks - admitted images.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<{ subject: string, speciesNote: string, candidates: object[] }>} normalized detection.
 */
async function runDetect(ctx, imageBlocks, signal) {
  const prompt = buildDetectPrompt()
  const stream = ctx.llm.stream({
    provider: JUDGE_PROVIDER,
    model: JUDGE_MODEL,
    system: prompt.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }, ...imageBlocks] }],
    temperature: 0.1,
    maxTokens: 900,
    signal,
  })
  let text = ''
  let reason
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish') reason = chunk.reason
  }
  if (reason !== undefined && (reason.kind === 'error' || reason.kind === 'aborted')) {
    const failure = reason.failure ?? {}
    throw new RouteError(String(failure.message ?? '模型调用失败'), failure.code === 'RATE_LIMIT' ? 429 : 502, typeof failure.code === 'string' ? failure.code : 'JUDGE_FAILED')
  }
  const parsed = extractJson(text)
  if (parsed === undefined) throw new RouteError('识别结果不是合法 JSON，重试一次。', 502, 'UNPARSEABLE_RESULT')
  const subject = parsed.subject === 'cat' ? 'cat' : parsed.subject === 'dog' ? 'dog' : 'other'
  const candidates = []
  for (const candidate of Array.isArray(parsed.candidates) ? parsed.candidates : []) {
    if (candidates.length >= 3) break
    const breed = typeof candidate?.breedId === 'string' ? breedById(candidate.breedId) : undefined
    if (breed === undefined) continue
    const rawConfidence = typeof candidate.confidence === 'number' ? candidate.confidence : Number(candidate.confidence)
    const confidence = Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(100, Math.round(rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence)))
      : 50
    candidates.push({
      breedId: breed.id,
      name: breed.name,
      en: breed.en,
      confidence,
      reason: typeof candidate.reason === 'string' ? candidate.reason.trim().slice(0, 60) : '',
    })
  }
  return {
    subject,
    speciesNote: typeof parsed.speciesNote === 'string' ? parsed.speciesNote.trim().slice(0, 120) : '',
    candidates,
  }
}

/**
 * Run one judge call and assemble its text.
 * @param {object} ctx - the plugin context.
 * @param {object} breed - the selected breed.
 * @param {{ type: 'image', attachment: object }[]} imageBlocks - admitted image blocks in display order.
 * @param {AbortSignal} signal - cancellation.
 * @param {number} frameCount - number of images (1 for a photo).
 * @param {'photo'|'video'} mediaKind - whether the frames are stills or video samples.
 * @returns {Promise<{ text: string, reason: object|undefined, usage: object|undefined }>} raw answer.
 */
async function runJudge(ctx, breed, imageBlocks, signal, frameCount, mediaKind) {
  const prompt = buildJudgePrompt(breed, { frameCount, kind: mediaKind })
  const stream = ctx.llm.stream({
    provider: JUDGE_PROVIDER,
    model: JUDGE_MODEL,
    system: prompt.system,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt.user }, ...imageBlocks],
      },
    ],
    temperature: 0.3,
    maxTokens: JUDGE_MAX_TOKENS,
    signal,
  })

  let text = ''
  let reason
  let usage
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'usage') usage = chunk.usage
    else if (chunk.type === 'finish') reason = chunk.reason
  }
  return { text, reason, usage }
}

/**
 * Mount the routes.
 * @param {object} ctx - the plugin context.
 */
export function apply(ctx) {
  validateBreeds(BREEDS)

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          const rejection = admissionStatus(ctx, req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }

          const controller = new AbortController()
          res.on('close', () => controller.abort())

          try {
            const url = new URL(req.url ?? '/', 'http://dsh.internal')
            const operation = url.pathname.slice(ROUTE_PATH.length).replace(/^\/+|\/+$/g, '')

            if (operation === 'breeds') {
              if (req.method !== 'GET') throw new RouteError('只支持 GET', 405, 'METHOD_NOT_ALLOWED')
              sendJson(res, 200, {
                ok: true,
                breeds: BREEDS.map((breed) => ({
                  id: breed.id,
                  name: breed.name,
                  en: breed.en,
                  coat: breed.coat,
                  blurb: breed.blurb,
                  points: breed.points.map((point) => ({ key: point.key, label: point.label, max: point.max, hint: point.hint })),
                })),
              })
              return
            }

            if (operation === 'read-file') {
              if (req.method !== 'POST') throw new RouteError('只支持 POST', 405, 'METHOD_NOT_ALLOWED')
              const body = await readJsonBody(req, 64 * 1024)
              const pastedPath = typeof body.path === 'string' ? body.path : ''
              if (pastedPath.trim() === '') throw new RouteError('缺少文件路径', 400, 'MISSING_PATH')
              const media = await readPastedMedia(pastedPath)
              sendJson(res, 200, {
                ok: true,
                mediaType: media.mediaType,
                name: media.name,
                bytes: media.bytes.length,
                data: media.bytes.toString('base64'),
              })
              return
            }

            if (operation === 'detect') {
              if (req.method !== 'POST') throw new RouteError('只支持 POST', 405, 'METHOD_NOT_ALLOWED')
              if (inFlight >= MAX_IN_FLIGHT) throw new RouteError('评审队列已满，请稍后再试', 429, 'RATE_LIMITED')
              const body = await readJsonBody(req, MAX_BODY_BYTES)
              const images = validateImages(Array.isArray(body.images) ? body.images : [])
              const startedAt = Date.now()
              const timeout = setTimeout(() => controller.abort(), 60_000)
              inFlight += 1
              try {
                const imageBlocks = []
                for (const image of images.slice(0, 1)) {
                  const attachment = await ctx.attachments.saveImage({
                    data: Buffer.from(image.data, 'base64'),
                    mediaType: image.mediaType,
                    name: 'detect-photo',
                  })
                  imageBlocks.push({ type: 'image', attachment })
                }
                const detected = await runDetect(ctx, imageBlocks, controller.signal)
                sendJson(res, 200, {
                  ok: true,
                  subject: detected.subject,
                  speciesNote: detected.speciesNote,
                  candidates: detected.candidates,
                  meta: { provider: JUDGE_PROVIDER, model: JUDGE_MODEL, elapsedMs: Date.now() - startedAt, frames: 1 },
                })
              } finally {
                clearTimeout(timeout)
                inFlight -= 1
              }
              return
            }

            if (operation === 'publish') {
              if (req.method !== 'POST') throw new RouteError('只支持 POST', 405, 'METHOD_NOT_ALLOWED')
              const body = await readJsonBody(req, 200 * 1024)
              const controller = new AbortController()
              const timer = setTimeout(() => controller.abort(), 20_000)
              try {
                const response = await fetch(LEADERBOARD_TARGET + '/api/scores', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(body),
                  signal: controller.signal,
                })
                const text = await response.text()
                let payload
                try {
                  payload = JSON.parse(text)
                } catch {
                  payload = { ok: false, error: 'upstream returned a non-JSON response' }
                }
                sendJson(res, response.status, payload)
              } catch (error) {
                throw new RouteError('发布失败：' + (error instanceof Error ? error.message : String(error)), 502, 'PUBLISH_FAILED')
              } finally {
                clearTimeout(timer)
              }
              return
            }

            if (operation === 'score') {
              if (req.method !== 'POST') throw new RouteError('只支持 POST', 405, 'METHOD_NOT_ALLOWED')
              if (inFlight >= MAX_IN_FLIGHT) throw new RouteError('评审队列已满，请稍后再试', 429, 'RATE_LIMITED')

              const body = await readJsonBody(req, MAX_BODY_BYTES)
              const { breed, images, fileName, mediaKind } = validateScoreRequest(body)

              const startedAt = Date.now()
              const timeout = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS)

              inFlight += 1
              try {
                const imageBlocks = []
                for (const image of images) {
                  const attachment = await ctx.attachments.saveImage({
                    data: Buffer.from(image.data, 'base64'),
                    mediaType: image.mediaType,
                    name: fileName,
                  })
                  imageBlocks.push({ type: 'image', attachment })
                }

                const answer = await runJudge(ctx, breed, imageBlocks, controller.signal, images.length, mediaKind)
                if (answer.reason !== undefined && (answer.reason.kind === 'error' || answer.reason.kind === 'aborted')) {
                  const failure = answer.reason.failure ?? {}
                  throw new RouteError(
                    String(failure.message ?? '模型调用失败'),
                    failure.code === 'RATE_LIMIT' ? 429 : 502,
                    typeof failure.code === 'string' ? failure.code : 'JUDGE_FAILED',
                  )
                }

                let finalAnswer = answer
                let parsed = extractJson(answer.text)
                if (parsed === undefined) {
                  // One automatic retry: a transient format drift should not surface as a user-facing failure.
                  finalAnswer = await runJudge(ctx, breed, imageBlocks, controller.signal, images.length, mediaKind)
                  if (finalAnswer.reason !== undefined && (finalAnswer.reason.kind === 'error' || finalAnswer.reason.kind === 'aborted')) {
                    const failure = finalAnswer.reason.failure ?? {}
                    throw new RouteError(
                      String(failure.message ?? '模型调用失败'),
                      failure.code === 'RATE_LIMIT' ? 429 : 502,
                      typeof failure.code === 'string' ? failure.code : 'JUDGE_FAILED',
                    )
                  }
                  parsed = extractJson(finalAnswer.text)
                }

                if (parsed === undefined) {
                  const truncated = finalAnswer.reason?.kind === 'max-tokens'
                  sendJson(res, 502, {
                    ok: false,
                    error: {
                      code: 'UNPARSEABLE_RESULT',
                      message: truncated ? '评审结果被 token 上限截断，自动重试后仍失败。' : '评审结果不是合法 JSON，已自动重试仍失败。',
                      raw: finalAnswer.text.slice(0, 3000),
                    },
                  })
                  return
                }

                if (parsed.subject === 'other') {
                  sendJson(res, 200, {
                    ok: false,
                    error: {
                      code: 'NOT_A_CAT',
                      message: '照片里好像不是一只猫，换一张猫片试试？',
                    },
                  })
                  return
                }

                const result = normalizeResult(parsed, breed)
                sendJson(res, 200, {
                  ok: true,
                  result,
                  meta: {
                    provider: JUDGE_PROVIDER,
                    model: JUDGE_MODEL,
                    elapsedMs: Date.now() - startedAt,
                    frames: images.length,
                    retried: finalAnswer !== answer,
                    usage: finalAnswer.usage,
                  },
                })
              } finally {
                clearTimeout(timeout)
                inFlight -= 1
              }
              return
            }

            throw new RouteError('未知接口', 404, 'NOT_FOUND')
          } catch (error) {
            const routeError = asRouteError(error)
            sendJson(res, routeError.status, {
              ok: false,
              error: { code: routeError.code, message: routeError.message },
            })
          }
        },
      }),
    'dsh-cat-star: breed cards and judge route',
  )
}
