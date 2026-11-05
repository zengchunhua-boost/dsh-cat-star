/*!
 * dsh-cat-beauty — client half (browser bundle).
 *
 * Contributes a "猫颜评分" entry to the sidebar panel list and a central panel
 * that uploads one cat photo, asks the host to judge it against a CFA-inspired
 * breed score card, and renders the scorecard (ring, radar, per-dimension bars,
 * judge commentary, local history).
 *
 * Bundle format: the DSH client-bundle shape — a lazy-CJS closure registered via
 * `window.__ModuleLoader__.load({ id, factory })`. `react` comes from the shell's
 * module table; nothing else is imported.
 */
window.__ModuleLoader__.load({
  id: 'dsh-cat-star',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    /** The id shared by the sidebar entry and the main panel it opens. */
    var PANEL_ID = 'cat-star'
    var HISTORY_KEY = 'dsh-cat-star:history:v1'
    /** Public leaderboard worker; empty hides the publish button. Deploy dsh-cat-beauty-leaderboard and paste its URL here. */
    var LEADERBOARD_URL = 'https://dsh-cat-beauty-leaderboard.netlify.app'
    var HISTORY_LIMIT = 10
    var MAX_IMAGE_BYTES = 25 * 1024 * 1024
    var MAX_VIDEO_BYTES = 50 * 1024 * 1024
    var MAX_PHOTOS = 4
    var MAX_EDGE = 1600

    /** Tiny createElement alias so the tree below stays readable without JSX. */
    function h(tag, props) {
      var children = Array.prototype.slice.call(arguments, 2)
      return React.createElement.apply(React, [tag, props].concat(children))
    }

    /** Grade tone used by the ring, bars and badges. */
    function toneFor(total) {
      if (total >= 85) return '#22c55e'
      if (total >= 72) return '#3b82f6'
      if (total >= 60) return '#f59e0b'
      return '#ef4444'
    }

    /** Format a timestamp as a short local date-time. */
    function formatTime(ts) {
      var date = new Date(ts)
      var pad = function (value) { return String(value).padStart(2, '0') }
      return (
        date.getFullYear() +
        '-' + pad(date.getMonth() + 1) +
        '-' + pad(date.getDate()) +
        ' ' + pad(date.getHours()) +
        ':' + pad(date.getMinutes())
      )
    }

    /** Friendly Chinese copy for stable host/model failure codes. */
    var ERROR_COPY = {
      NO_ADAPTER: '当前 profile 没有可用的模型适配器。',
      MISSING_CREDENTIAL: '模型凭据缺失，先在设置里配置 DeepSeek API Key。',
      INVALID_CREDENTIAL: '模型凭据无效，检查一下 API Key。',
      AUTH: '模型接口拒绝了这次请求（鉴权失败）。',
      QUOTA: '模型额度已用完。',
      RATE_LIMIT: '请求太频繁，被模型限流了，稍等再试。',
      CONTEXT_WINDOW_EXCEEDED: '这张照片对模型来说太大了，换一张小一点的。',
      IMAGE_OFFLOAD_REQUIRED: '照片超出了图片预算，换一张更小的。',
      TIMEOUT: '评审超时了（模型长时间没响应），可以重试。',
      TRANSPORT: '网络连接模型服务失败，检查网络后重试。',
      UNPARSEABLE_RESULT: '模型这次没按格式出结果，已自动重试；可以再点一次重试。',
      NOT_A_CAT: '照片里好像不是一只猫，换一张猫片试试？',
      RATE_LIMITED: '评审队列已满，请稍候。',
      IMAGE_TOO_LARGE: '图片太大了，换一张小于 25MB 的。',
      VIDEO_TOO_LARGE: '视频太大了，换一个小于 50MB 的。',
      VIDEO_DECODE_FAILED: '浏览器解码不了这个视频，试试 MP4/H.264 或 WebM。',
      VIDEO_SEEK_TIMEOUT: '视频抽帧超时，换一个短视频或换张照片。',
      PASTE_VIDEO_UNSUPPORTED: '浏览器拿不到剪贴板里的视频文件，请拖入或点选上传。',
      FILE_NOT_FOUND: '找不到这个文件，确认路径后重试。',
      FILE_TOO_LARGE: '文件太大（图片 25MB / 视频 50MB 上限）。',
      BAD_PATH: '只支持绝对路径或 file:// 链接。',
      NOT_A_FILE: '这个路径不是普通文件。',
      MISSING_PATH: '没拿到文件路径，请复制完整文件后再粘贴。',
      FILE_READ_FAILED: '读取本地文件失败，换拖入或点选试试。',
      DETECT_FAILED: '品种识别失败，手动选一个也行。',
      UNSUPPORTED_MEDIA_TYPE: '只支持 PNG / JPEG / WebP / GIF 图片，以及 MP4 / WebM / MOV 视频。',
      UNKNOWN_BREED: '这个品种不在评分表里。',
      NO_BREED: '识别不出品种，手动选一个再评分。',
      internal: '服务端出了点问题，重试一下。',
    }

    /** @param {{code?: string, message?: string}} error @returns {string} */
    function errorText(error) {
      if (error === undefined || error === null) return '未知错误'
      var copy = ERROR_COPY[error.code]
      if (copy !== undefined) return copy
      return error.message || '未知错误'
    }

    /** Cat-head outline glyph, 16px grid. */
    function CatIcon(props) {
      var size = props && props.size ? props.size : 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
        },
        h('path', {
          key: 'head',
          d: 'M3.2 5.4 5.1 2.4l2.05 1.35h1.7L10.9 2.4l1.9 3v4.05a4.8 4.8 0 0 1-4.8 4.8 4.8 4.8 0 0 1-4.8-4.8z',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinejoin: 'round',
        }),
        h('circle', { key: 'eyeL', cx: 6.1, cy: 7.5, r: 0.78, fill: 'currentColor' }),
        h('circle', { key: 'eyeR', cx: 9.9, cy: 7.5, r: 0.78, fill: 'currentColor' }),
        h('path', {
          key: 'mouth',
          d: 'M7.15 9.6c.45.5.85.75 1.85.75s1.4-.25 1.85-.75',
          stroke: 'currentColor',
          strokeWidth: 0.9,
          strokeLinecap: 'round',
        }),
      )
    }

    /** One SVG donut for the 0–100 total. */
    function ScoreRing(props) {
      var total = props.total
      var size = 148
      var stroke = 11
      var radius = (size - stroke) / 2
      var circumference = 2 * Math.PI * radius
      var tone = toneFor(total)
      return h(
        'div',
        { className: 'cb-ring' },
        h(
          'svg',
          { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size },
          h('circle', {
            key: 'track',
            cx: size / 2,
            cy: size / 2,
            r: radius,
            fill: 'none',
            stroke: 'var(--dsw-alias-bg-layer-3, #eceff3)',
            strokeWidth: stroke,
          }),
          h('circle', {
            key: 'value',
            cx: size / 2,
            cy: size / 2,
            r: radius,
            fill: 'none',
            stroke: tone,
            strokeWidth: stroke,
            strokeLinecap: 'round',
            strokeDasharray: (circumference * total) / 100 + ' ' + circumference,
            transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')',
            style: { transition: 'stroke-dasharray 700ms ease' },
          }),
        ),
        h(
          'div',
          { key: 'label', className: 'cb-ring-label' },
          h('strong', { style: { color: tone } }, String(total)),
          h('span', null, '总分'),
        ),
      )
    }

    /** Radar of every dimension's completion score (0–100). */
    function RadarChart(props) {
      var points = props.points
      var scores = props.scores
      var size = 300
      var center = size / 2
      var radius = size * 0.335
      var count = points.length
      var angleAt = function (index) { return -Math.PI / 2 + (index * 2 * Math.PI) / count }
      var vertex = function (index, ratio) {
        var angle = angleAt(index)
        return [center + Math.cos(angle) * radius * ratio, center + Math.sin(angle) * radius * ratio]
      }
      var polygon = function (ratio) {
        return points
          .map(function (_point, index) {
            var xy = vertex(index, ratio)
            return xy[0].toFixed(1) + ',' + xy[1].toFixed(1)
          })
          .join(' ')
      }
      var dataPoints = points.map(function (point, index) {
        var xy = vertex(index, Math.max(0, Math.min(100, scores[point.key] ?? 0)) / 100)
        return xy[0].toFixed(1) + ',' + xy[1].toFixed(1)
      })

      return h(
        'svg',
        {
          className: 'cb-radar',
          viewBox: '0 0 ' + size + ' ' + size,
          role: 'img',
          'aria-label': '各维度得分雷达图',
        },
        [0.25, 0.5, 0.75, 1].map(function (ratio) {
          return h('polygon', {
            key: 'grid-' + ratio,
            points: polygon(ratio),
            fill: ratio === 1 ? 'var(--dsw-alias-bg-layer-2, #f6f8fa)' : 'none',
            stroke: 'var(--dsw-alias-border-l2, #e3e7ec)',
            strokeWidth: 1,
          })
        }),
        points.map(function (_point, index) {
          var xy = vertex(index, 1)
          return h('line', {
            key: 'axis-' + index,
            x1: center,
            y1: center,
            x2: xy[0],
            y2: xy[1],
            stroke: 'var(--dsw-alias-border-l2, #e3e7ec)',
            strokeWidth: 1,
          })
        }),
        h('polygon', {
          key: 'data',
          points: dataPoints.join(' '),
          fill: 'rgba(59,130,246,0.20)',
          stroke: '#3b82f6',
          strokeWidth: 1.8,
          strokeLinejoin: 'round',
        }),
        dataPoints.map(function (text, index) {
          var parts = text.split(',')
          var active = points[index].key === props.highlight
          return h('circle', {
            key: 'dot-' + index,
            cx: parts[0],
            cy: parts[1],
            r: active ? 5.5 : 3,
            fill: active ? '#f59e0b' : '#3b82f6',
          })
        }),
        points.map(function (point, index) {
          var xy = vertex(index, 1.17)
          var anchor = Math.abs(xy[0] - center) < 18 ? 'middle' : xy[0] > center ? 'start' : 'end'
          return h(
            'text',
            {
              key: 'label-' + index,
              x: xy[0],
              y: xy[1],
              textAnchor: anchor,
              dominantBaseline: 'middle',
              className: 'cb-radar-label' + (point.key === props.highlight ? ' cb-radar-label-active' : ''),
            },
            point.label,
            h('tspan', { key: 'score', x: xy[0], dy: '1.1em' }, String(scores[point.key] ?? 0)),
          )
        }),
      )
    }

    /** The 0–100 progress bar used by match and dimensions. */
    function Bar(props) {
      var value = Math.max(0, Math.min(100, props.value ?? 0))
      return h(
        'div',
        { className: 'cb-bar', title: value + '/100' },
        h('span', {
          style: { width: value + '%', background: props.tone ?? toneFor(value) },
        }),
      )
    }

    /** Encode one canvas as a request frame (JPEG, quality ladder under 3.4MB). */
    function frameFromCanvas(canvas) {
      var quality = 0.9
      var dataUrl = canvas.toDataURL('image/jpeg', quality)
      while (dataUrl.length > 3_400_000 && quality > 0.55) {
        quality -= 0.1
        dataUrl = canvas.toDataURL('image/jpeg', quality)
      }
      var base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      return {
        dataUrl: dataUrl,
        base64: base64,
        width: canvas.width,
        height: canvas.height,
        bytes: Math.round((base64.length * 3) / 4),
      }
    }

    /** Downscale a canvas into a small history thumbnail. */
    function thumbFromCanvas(canvas) {
      var thumbEdge = 160
      var scale = Math.min(1, thumbEdge / Math.max(canvas.width, canvas.height))
      var thumbCanvas = document.createElement('canvas')
      thumbCanvas.width = Math.max(1, Math.round(canvas.width * scale))
      thumbCanvas.height = Math.max(1, Math.round(canvas.height * scale))
      thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height)
      return thumbCanvas.toDataURL('image/jpeg', 0.7)
    }

    /** Draw a decoded image/video frame onto a white-backed canvas, capped at MAX_EDGE. */
    function canvasFromSource(source, sourceWidth, sourceHeight) {
      var scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight))
      var width = Math.max(1, Math.round(sourceWidth * scale))
      var height = Math.max(1, Math.round(sourceHeight * scale))
      var canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      var context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.drawImage(source, 0, 0, width, height)
      return canvas
    }

    /** Turn one image File into a frame plus a thumbnail. */
    function prepareImageFrame(file) {
      return new Promise(function (resolve, reject) {
        var mime = typeof file.type === 'string' ? file.type.toLowerCase() : ''
        if (mime === '') {
          var name = typeof file.name === 'string' ? file.name.toLowerCase() : ''
          if (/\.png$/.test(name)) mime = 'image/png'
          else if (/\.webp$/.test(name)) mime = 'image/webp'
          else if (/\.gif$/.test(name)) mime = 'image/gif'
          else mime = 'image/jpeg'
        }
        if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].indexOf(mime) === -1) {
          reject({ code: 'UNSUPPORTED_MEDIA_TYPE', message: '只支持 PNG / JPEG / WebP / GIF 图片' })
          return
        }
        if (file.size > MAX_IMAGE_BYTES) {
          reject({ code: 'IMAGE_TOO_LARGE', message: '图片超过 25MB' })
          return
        }
        var reader = new FileReader()
        reader.onerror = function () {
          reject({ code: 'READ_FAILED', message: '读取图片失败' })
        }
        reader.onload = function () {
          var source = String(reader.result || '')
          var image = new Image()
          image.onerror = function () {
            reject({ code: 'DECODE_FAILED', message: '无法解码这张图片' })
          }
          image.onload = function () {
            var canvas = canvasFromSource(image, image.width, image.height)
            resolve({ frame: frameFromCanvas(canvas), thumb: thumbFromCanvas(canvas) })
          }
          image.src = source
        }
        reader.readAsDataURL(file)
      })
    }

    /** Turn 1–N image Files into one multi-angle photo payload (processed serially). */
    function prepareImages(files) {
      var limited = files.slice(0, MAX_PHOTOS)
      if (limited.length === 0) {
        return Promise.reject({ code: 'MISSING_IMAGE', message: '没有可用的图片' })
      }
      var results = []
      var chain = Promise.resolve()
      limited.forEach(function (file) {
        chain = chain.then(function () {
          return prepareImageFrame(file).then(function (prepared) {
            results.push(prepared)
          })
        })
      })
      return chain.then(function () {
        var frames = results.map(function (item) { return item.frame })
        return {
          kind: 'photos',
          name: results.length > 1 ? results.length + ' 张照片' : (limited[0].name || 'cat-photo'),
          frames: frames,
          dataUrl: frames[0].dataUrl,
          thumb: results[0].thumb,
          width: frames[0].width,
          height: frames[0].height,
          bytes: frames.reduce(function (sum, frame) { return sum + frame.bytes }, 0),
        }
      })
    }

    /** Seek a video and wait for the decoded frame at that time. */
    function seekVideo(video, time) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          cleanup()
          reject({ code: 'VIDEO_SEEK_TIMEOUT', message: '视频抽帧超时，换一个短视频或换张照片' })
        }, 10_000)
        function cleanup() {
          clearTimeout(timer)
          video.removeEventListener('seeked', onSeeked)
        }
        function onSeeked() {
          cleanup()
          resolve()
        }
        video.addEventListener('seeked', onSeeked)
        video.currentTime = time
      })
    }

    /** Sample N frames evenly from a video File; frames are encoded locally, the file is never uploaded. */
    function prepareVideo(file) {
      return new Promise(function (resolve, reject) {
        if (!file.type || ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'].indexOf(file.type) === -1) {
          reject({ code: 'UNSUPPORTED_MEDIA_TYPE', message: '只支持 MP4 / WebM / MOV 视频' })
          return
        }
        if (file.size > MAX_VIDEO_BYTES) {
          reject({ code: 'VIDEO_TOO_LARGE', message: '视频超过 ' + Math.round(MAX_VIDEO_BYTES / 1024 / 1024) + 'MB' })
          return
        }
        var url = URL.createObjectURL(file)
        var video = document.createElement('video')
        video.preload = 'auto'
        video.muted = true
        video.playsInline = true
        var settled = false
        function fail(message) {
          if (settled) return
          settled = true
          URL.revokeObjectURL(url)
          reject({ code: 'VIDEO_DECODE_FAILED', message: message })
        }
        video.onerror = function () {
          fail('浏览器无法解码这个视频（试试 MP4/H.264 或 WebM）')
        }
        video.onloadedmetadata = function () {
          var duration = Number.isFinite(video.duration) ? video.duration : 0
          if (video.videoWidth === 0 || video.videoHeight === 0) {
            fail('视频没有画面')
            return
          }
          if (duration <= 0.05) {
            fail('视频太短，抽不出帧')
            return
          }
          ;(async function sample() {
            try {
              var count = duration < 2 ? 3 : 4
              var frames = []
              var firstCanvas = null
              for (var index = 0; index < count; index += 1) {
                var time = Math.min(Math.max(0, duration * ((index + 0.5) / count)), Math.max(0, duration - 0.05))
                await seekVideo(video, time)
                var canvas = canvasFromSource(video, video.videoWidth, video.videoHeight)
                if (firstCanvas === null) firstCanvas = canvas
                frames.push(frameFromCanvas(canvas))
              }
              settled = true
              URL.revokeObjectURL(url)
              resolve({
                kind: 'video',
                name: file.name || 'cat-video',
                frames: frames,
                dataUrl: frames[0].dataUrl,
                thumb: thumbFromCanvas(firstCanvas),
                width: firstCanvas.width,
                height: firstCanvas.height,
                bytes: frames.reduce(function (sum, frame) { return sum + frame.bytes }, 0),
                duration: duration,
              })
            } catch (error) {
              fail(error && error.message ? error.message : '视频抽帧失败')
            }
          })()
        }
        video.src = url
      })
    }

    /**
     * Pull a media path out of pasted text.
     *
     * Finder puts the path on the clipboard, not the bytes, so a paste only works
     * when the text names an absolute path (or a file:// URL). Multi-line pastes
     * use the first line.
     * @param {string} text - clipboard text/uri-list.
     * @returns {string|undefined} the candidate path.
     */
    function extractMediaPath(text) {
      if (typeof text !== 'string' || text.trim() === '') return undefined
      var value = text.split(/\r?\n/)[0].trim().replace(/^["'`]+|["'`]+$/g, '')
      if (value === '') return undefined
      var looksMedia = /\.(mp4|webm|mov|m4v|avi|mkv|png|jpe?g|webp|gif)$/i.test(value)
      if (!looksMedia) return undefined
      if (value.startsWith('file://')) return value
      if (value.startsWith('/')) return value
      return undefined
    }

    /** Ask the host to read one pasted local path, then wrap its bytes as a File. */
    function readLocalPath(path) {
      return fetch('/cat-beauty/read-file', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: path }),
      })
        .then(function (response) {
          return response.text().then(function (text) {
            var payload = null
            try {
              payload = JSON.parse(text)
            } catch {
              payload = null
            }
            if (!payload || payload.ok !== true) {
              throw {
                code: (payload && payload.error && payload.error.code) || 'FILE_READ_FAILED',
                message: (payload && payload.error && payload.error.message) || '读取本地文件失败',
              }
            }
            return payload
          })
        })
        .then(function (payload) {
          var binary = atob(payload.data)
          var bytes = new Uint8Array(binary.length)
          for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
          return new File([bytes], payload.name || 'local-media', { type: payload.mediaType })
        })
    }

    /** Load local history, tolerating absent/corrupt storage. */
    function loadHistory() {
      try {
        var raw = window.localStorage.getItem(HISTORY_KEY)
        if (raw === null) return []
        var parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : []
      } catch {
        return []
      }
    }

    /** Persist local history without letting quota errors break the page. */
    function saveHistory(items) {
      try {
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)))
      } catch {
        /* storage full or blocked: history is a convenience, not a requirement */
      }
    }

    /** Stable per-dimension color for the bars. */
    function dimTone(index) {
      var palette = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#22c55e', '#ef4444']
      return palette[index % palette.length]
    }

    /** Empty-state illustration and instructions. */
    function EmptyState(props) {
      return h(
        'div',
        { className: 'cb-empty' },
        h(
          'div',
          { className: 'cb-empty-glyph' },
          h(CatIcon, { size: 64 }),
        ),
        h('h2', null, '给猫猫的颜值照个 X 光'),
        h('p', null, '上传 1–4 张猫片或 1 段视频，选好品种，AI 裁判会按 CFA 品种标准的评分点逐项打分。'),
        h(
          'ol',
          { className: 'cb-steps' },
          h('li', null, '左侧上传/拖入 1–4 张照片（或 1 段视频），也可复制文件后直接 Ctrl/Cmd+V'),
          h('li', null, '品种可选：不选也会自动识别高概率品种'),
          h('li', null, '点「开始评分」，等裁判出分'),
        ),
        h('p', { className: 'cb-tip' }, '正面、光线均匀、能看清眼睛与口吻的照片最准；视频会自动均匀抽 4 帧综合评估。'),
      )
    }

    /** One history chip. */
    function HistoryRow(props) {
      var item = props.item
      return h(
        'button',
        {
          type: 'button',
          className: 'cb-history-row',
          title: item.caption,
          onClick: function () {
            props.onOpen(item)
          },
        },
        props.rank ? h('span', { className: 'cb-history-rank' }, '#' + props.rank) : null,
        h('img', { src: item.thumb, alt: '', className: 'cb-history-thumb' }),
        h(
          'span',
          { className: 'cb-history-meta' },
          h('span', { className: 'cb-history-caption' }, item.caption),
          h('span', { className: 'cb-history-sub' }, item.breedName + ' · ' + formatTime(item.ts)),
        ),
        h('strong', { className: 'cb-history-score', style: { color: toneFor(item.total) } }, String(item.total)),
      )
    }

    /** Draw one rounded rectangle path on a 2d context. */
    function roundRectPath(ctx, x, y, width, height, radius) {
      ctx.beginPath()
      ctx.moveTo(x + radius, y)
      ctx.arcTo(x + width, y, x + width, y + height, radius)
      ctx.arcTo(x + width, y + height, x, y + height, radius)
      ctx.arcTo(x, y + height, x, y, radius)
      ctx.arcTo(x, y, x + width, y, radius)
      ctx.closePath()
    }

    /** Wrap text into at most maxLines lines on a 2d context. */
    function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
      var characters = String(text).split('')
      var line = ''
      var lines = 0
      for (var index = 0; index < characters.length; index += 1) {
        var candidate = line + characters[index]
        if (ctx.measureText(candidate).width > maxWidth && line !== '') {
          ctx.fillText(line, x, y + lines * lineHeight)
          line = characters[index]
          lines += 1
          if (lines >= maxLines) {
            ctx.fillText(line.slice(0, Math.max(0, line.length - 1)) + '…', x, y + (maxLines - 1) * lineHeight)
            return
          }
        } else {
          line = candidate
        }
      }
      if (line !== '' && lines < maxLines) ctx.fillText(line, x, y + lines * lineHeight)
    }

    /** Draw the radar into a plain canvas (share card). */
    function drawCanvasRadar(ctx, points, scores, ox, oy, size, font) {
      var center = size / 2
      var radius = size * 0.31
      var count = points.length
      var angleAt = function (index) { return -Math.PI / 2 + (index * 2 * Math.PI) / count }
      var vertex = function (index, ratio) {
        var angle = angleAt(index)
        return [ox + center + Math.cos(angle) * radius * ratio, oy + center + Math.sin(angle) * radius * ratio]
      }
      ctx.strokeStyle = '#dfe4ea'
      ctx.lineWidth = 2
      ;[1 / 3, 2 / 3, 1].forEach(function (ratio) {
        ctx.beginPath()
        points.forEach(function (_point, index) {
          var xy = vertex(index, ratio)
          if (index === 0) ctx.moveTo(xy[0], xy[1])
          else ctx.lineTo(xy[0], xy[1])
        })
        ctx.closePath()
        ctx.stroke()
      })
      points.forEach(function (_point, index) {
        var xy = vertex(index, 1)
        ctx.beginPath()
        ctx.moveTo(ox + center, oy + center)
        ctx.lineTo(xy[0], xy[1])
        ctx.stroke()
      })
      ctx.beginPath()
      points.forEach(function (point, index) {
        var ratio = Math.max(0, Math.min(100, scores[point.key] ?? 0)) / 100
        var xy = vertex(index, ratio)
        if (index === 0) ctx.moveTo(xy[0], xy[1])
        else ctx.lineTo(xy[0], xy[1])
      })
      ctx.closePath()
      ctx.fillStyle = 'rgba(59,130,246,0.22)'
      ctx.fill()
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.font = '400 18px ' + font
      points.forEach(function (point, index) {
        var xy = vertex(index, 1.22)
        ctx.textAlign = Math.abs(xy[0] - (ox + center)) < 26 ? 'center' : xy[0] > ox + center ? 'left' : 'right'
        ctx.fillStyle = '#5b6170'
        ctx.fillText(point.label, xy[0], xy[1])
        ctx.fillStyle = '#8b90a0'
        ctx.fillText(String(scores[point.key] ?? 0), xy[0], xy[1] + 22)
      })
      ctx.textAlign = 'left'
    }

    /** Format an integer amount with thousands separators. */
    function formatMoney(value) {
      return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    /** Build platform-flavored share copy for one result. */
    function buildShareCopy(result, breed, grade, platform, name) {
      var emoji = result.total >= 85 ? '🏆' : result.total >= 72 ? '✨' : result.total >= 60 ? '😺' : '🙈'
      var highlights = (result.highlights || []).slice(0, 3).join('；')
      var improvements = (result.improvements || []).slice(0, 2).join('；')
      if (platform === 'weibo') {
        return (
          '给猫猫按 CFA 品种标准打了个分：' + result.breedName + ' ' + result.total + ' 分（' + grade.label + '）' + emoji + '\n' +
          result.breedNote + '\n' +
          '亮点：' + highlights + '\n' +
          (result.priceEstimate && result.priceEstimate.min > 0
            ? '参考价 ¥' + formatMoney(result.priceEstimate.min) + '–¥' + formatMoney(result.priceEstimate.max) + '\n'
            : '') +
          '裁判说：' + result.judge.slice(0, 70) + '…\n' +
          '#猫猫颜值打分# #吸猫#'
        )
      }
      return (
        (name || result.caption) + '｜' + result.breedName + '颜值打分 ' + result.total + ' 分 ' + emoji + '\n' +
        '品种匹配度 ' + result.breedMatch + '/100：' + result.breedNote + '\n' +
        '亮点：' + highlights + '\n' +
        (improvements ? '扣分点：' + improvements + '\n' : '') +
        (result.priceEstimate && result.priceEstimate.min > 0
          ? '参考价 ¥' + formatMoney(result.priceEstimate.min) + '–¥' + formatMoney(result.priceEstimate.max) + '\n'
          : '') +
        '按 CFA 品种标准逐项打分，你也来给自家猫测测 🐱\n' +
        '#猫咪 #颜值打分 #CFA #吸猫 #猫猫日常'
      )
    }

    /** Copy text to the clipboard, with an execCommand fallback. */
    function copyText(text) {
      function fallback() {
        return new Promise(function (resolve) {
          var area = document.createElement('textarea')
          area.value = text
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.select()
          try { document.execCommand('copy') } catch { /* ignore */ }
          document.body.removeChild(area)
          resolve()
        })
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(fallback)
      }
      return fallback()
    }

    /** Build the 1080×1440 share card canvas for one result. */
    function buildShareCard(result, breed, points, grade, frames, photo, name) {
      return new Promise(function (resolve, reject) {
        var canvas = document.createElement('canvas')
        canvas.width = 1080
        canvas.height = 1440
        var ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('canvas unavailable'))
          return
        }
        var font = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
        var tone = toneFor(result.total)
        ctx.fillStyle = '#f6f8fc'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#1f2329'
        ctx.font = '700 54px ' + font
        ctx.fillText('喵星大道', 80, 110)
        ctx.fillStyle = '#8b90a0'
        ctx.font = '400 26px ' + font
        ctx.fillText('CFA 品种标准 · AI 评审', 82, 156)

        function drawBody(image) {
          if (image) {
            ctx.save()
            roundRectPath(ctx, 80, 200, 400, 400, 36)
            ctx.clip()
            var scale = Math.max(400 / image.width, 400 / image.height)
            var width = image.width * scale
            var height = image.height * scale
            ctx.drawImage(image, 80 + (400 - width) / 2, 200 + (400 - height) / 2, width, height)
            ctx.restore()
          } else {
            roundRectPath(ctx, 80, 200, 400, 400, 36)
            ctx.fillStyle = '#eef1f5'
            ctx.fill()
          }
          ctx.fillStyle = '#1f2329'
          ctx.font = '700 38px ' + font
          wrapCanvasText(ctx, name || result.caption, 540, 260, 460, 50, 2)
          ctx.fillStyle = '#5b6170'
          ctx.font = '400 26px ' + font
          ctx.fillText(result.breedName + (breed ? ' · ' + breed.en : ''), 540, 372)

          ctx.fillStyle = tone
          ctx.font = '800 170px ' + font
          ctx.fillText(String(result.total), 532, 548)
          ctx.fillStyle = '#5b6170'
          ctx.font = '400 26px ' + font
          ctx.fillText('总分', 546, 594)
          ctx.fillStyle = tone
          roundRectPath(ctx, 540, 626, 300, 54, 27)
          ctx.fill()
          ctx.fillStyle = '#ffffff'
          ctx.font = '600 28px ' + font
          ctx.fillText(grade.label, 568, 663)
          ctx.fillStyle = '#5b6170'
          ctx.font = '400 24px ' + font
          ctx.fillText('品种匹配度 ' + result.breedMatch + ' / 100', 540, 706)

          drawCanvasRadar(ctx, points, result.scores, 60, 700, 360, font)
          var barX = 500
          var barWidth = 480
          points.forEach(function (point, index) {
            var y = 758 + index * 44
            var value = Math.max(0, Math.min(100, result.scores[point.key] ?? 0))
            ctx.font = '600 22px ' + font
            ctx.fillStyle = '#1f2329'
            ctx.fillText(point.label, barX, y)
            ctx.font = '400 20px ' + font
            ctx.textAlign = 'right'
            ctx.fillStyle = '#8b90a0'
            ctx.fillText(String(value), barX + barWidth, y)
            ctx.textAlign = 'left'
            roundRectPath(ctx, barX, y + 10, barWidth, 9, 4.5)
            ctx.fillStyle = '#e6eaf0'
            ctx.fill()
            roundRectPath(ctx, barX, y + 10, Math.max(6, (barWidth * value) / 100), 9, 4.5)
            ctx.fillStyle = '#3b82f6'
            ctx.fill()
          })

          ctx.fillStyle = '#1f2329'
          ctx.font = '700 30px ' + font
          ctx.fillText('裁判总评', 80, 1120)
          ctx.fillStyle = '#4a5160'
          ctx.font = '400 22px ' + font
          wrapCanvasText(ctx, result.judge, 80, 1168, 920, 38, 4)
          if (result.priceEstimate && result.priceEstimate.min > 0) {
            ctx.fillStyle = '#5b6170'
            ctx.font = '600 22px ' + font
            ctx.fillText('国内参考价 ¥' + formatMoney(result.priceEstimate.min) + ' – ¥' + formatMoney(result.priceEstimate.max), 80, 1338)
          }

          ctx.fillStyle = '#9aa1ad'
          ctx.font = '400 18px ' + font
          ctx.fillText('评分点结构参考 CFA 品种标准，逐项点评由 AI 生成，仅供娱乐。', 80, 1380)
          ctx.fillText(new Date().toISOString().slice(0, 10) + ' · dsh-cat-beauty', 80, 1408)
        }

        var cover = frames && frames.length > 0 ? frames[0] : photo
        if (!cover) {
          drawBody(null)
          resolve(canvas)
          return
        }
        var image = new Image()
        image.onload = function () {
          drawBody(image)
          resolve(canvas)
        }
        image.onerror = function () {
          drawBody(null)
          resolve(canvas)
        }
        image.src = cover
      })
    }

    /** Render one full scorecard with expandable dimensions and a share export. */
    function ResultCard(props) {
      var result = props.result
      var breed = props.breed
      var points = breed ? breed.points : result.points || props.points
      var tone = toneFor(result.total)

      var nameState = React.useState(props.initialName || result.caption)
      var displayName = nameState[0]
      var setDisplayName = nameState[1]
      var nameEditState = React.useState(false)
      var editingName = nameEditState[0]
      var setEditingName = nameEditState[1]

      React.useEffect(function () {
        setDisplayName(props.initialName || result.caption)
      }, [result.caption, props.initialName])

      var reportIdState = React.useState(function () {
        var now = new Date()
        var pad = function (value) { return String(value).padStart(2, '0') }
        return 'CB-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + Math.random().toString(16).slice(2, 6).toUpperCase()
      })
      var reportId = reportIdState[0]

      var shotTips = (points || []).filter(function (point) {
        return /不可见|受限|角度|光线|照片|画面/.test(result.comments[point.key] || '')
      }).slice(0, 3)

      var dimState = React.useState(null)
      var expandedDim = dimState[0]
      var setExpandedDim = dimState[1]

      var hoverState = React.useState(null)
      var hoverDim = hoverState[0]
      var setHoverDim = hoverState[1]

      var gradeState = React.useState(false)
      var showGrade = gradeState[0]
      var setShowGrade = gradeState[1]

      var shareState = React.useState('idle')
      var shareStatus = shareState[0]
      var setShareStatus = shareState[1]

      var publishState = React.useState('idle')
      var publishStatus = publishState[0]
      var setPublishStatus = publishState[1]

      var publishDialogState = React.useState(false)
      var showPublishDialog = publishDialogState[0]
      var setShowPublishDialog = publishDialogState[1]

      var petNameState = React.useState('')
      var petName = petNameState[0]
      var setPetName = petNameState[1]

      var share = React.useCallback(function () {
        setShareStatus('rendering')
        buildShareCard(result, breed, points, props.grade, props.frames, props.photo, displayName)
          .then(function (canvas) {
            canvas.toBlob(function (blob) {
              if (!blob) {
                setShareStatus('error')
                return
              }
              var url = URL.createObjectURL(blob)
              var link = document.createElement('a')
              link.href = url
              link.download = 'cat-beauty-' + result.total + '.png'
              link.click()
              setTimeout(function () { URL.revokeObjectURL(url) }, 2000)
              setShareStatus('idle')
            }, 'image/png')
          })
          .catch(function () {
            setShareStatus('error')
          })
      }, [result, breed, points, props.grade, props.frames, props.photo, displayName])

      var copyState = React.useState(false)
      var copied = copyState[0]
      var setCopied = copyState[1]
      var panelState = React.useState(false)
      var showPanel = panelState[0]
      var setShowPanel = panelState[1]
      var platformState = React.useState('xiaohongshu')
      var platform = platformState[0]
      var setPlatform = platformState[1]

      var copyShareText = React.useCallback(function () {
        copyText(buildShareCopy(result, breed, props.grade, platform, displayName)).then(function () {
          setCopied(true)
          setTimeout(function () { setCopied(false) }, 1500)
        })
      }, [result, breed, props.grade, platform, displayName])

      var publishScore = React.useCallback(function () {
        var thumb = props.thumb || ''
        setPublishStatus('publishing')
        fetch('/cat-beauty/publish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            total: result.total,
            breedName: result.breedName,
            breedId: result.breedId,
            caption: petName.trim() || result.caption,
            judge: result.judge,
            grade: props.grade.label,
            highlights: result.highlights,
            thumb: thumb,
          }),
        })
          .then(function (response) {
            return response.text().then(function (text) {
              var payload = null
              try {
                payload = JSON.parse(text)
              } catch {
                payload = null
              }
              if (!payload || payload.ok !== true) {
                throw new Error((payload && payload.error) || '发布失败')
              }
              return payload
            })
          })
          .then(function () {
            setPublishStatus('done')
            setShowPublishDialog(false)
          })
          .catch(function () {
            setPublishStatus('error')
          })
      }, [result, props.grade, props.thumb, petName])

      return h(
        'div',
        { className: 'cb-result' },
        h(
          'div',
          { className: 'cb-result-top' },
          h(
            'div',
            { className: 'cb-result-photo' },
            props.frames && props.frames.length > 1
              ? h(
                  'div',
                  { className: 'cb-frame-grid' },
                  props.frames.map(function (src, index) {
                    return h('img', { key: index, src: src, alt: '第 ' + (index + 1) + ' 帧' })
                  }),
                )
              : props.photo
                ? h('img', { src: props.photo, alt: '被打分的猫' })
                : h('div', { className: 'cb-result-photo-fallback' }, h(CatIcon, { size: 40 })),
          ),
          h(
            'div',
            { className: 'cb-result-summary' },
            h('div', { className: 'cb-kicker' }, 'CFA 赛猫评分报告'),
            editingName
              ? h(
                  'div',
                  { className: 'cb-name-edit' },
                  h('input', {
                    className: 'cb-name-input',
                    type: 'text',
                    value: displayName,
                    maxLength: 30,
                    autoFocus: true,
                    placeholder: '宠物名字',
                    onChange: function (event) { setDisplayName(event.target.value) },
                    onKeyDown: function (event) {
                      if (event.key === 'Enter' || event.key === 'Escape') setEditingName(false)
                    },
                  }),
                  h('button', { type: 'button', className: 'cb-btn cb-btn-sm', onClick: function () { setEditingName(false) } }, '确定'),
                )
              : h(
                  'div',
                  { className: 'cb-caption-row' },
                  h('div', { className: 'cb-caption' }, displayName || result.caption),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'cb-name-btn',
                      title: '改个名字（可选，默认用裁判标题）',
                      onClick: function () { setEditingName(true) },
                    },
                    '✎',
                  ),
                ),
            h(
              'div',
              { className: 'cb-chips' },
              h('span', { className: 'cb-chip' }, result.breedName),
              breed ? h('span', { className: 'cb-chip cb-chip-ghost' }, breed.en) : null,
              h(
                'span',
                {
                  className: 'cb-grade',
                  style: { color: tone, borderColor: tone, cursor: 'pointer' },
                  title: '点击查看等级说明',
                  onClick: function () { setShowGrade(!showGrade) },
                },
                props.grade.label,
              ),
              props.historyRank
                ? h('span', { className: 'cb-rank-badge' }, '历史第 ' + props.historyRank + ' 名' + (props.historyCount ? ' / ' + props.historyCount + ' 次' : ''))
                : null,
            ),
            showGrade
              ? h('p', { className: 'cb-grade-info' }, '等级门槛：' + props.grade.min + ' 分及以上。' + props.grade.note)
              : h('p', { className: 'cb-grade-note' }, props.grade.note),
            h(
              'div',
              { className: 'cb-match' },
              h('span', null, '品种匹配度'),
              h('strong', null, String(result.breedMatch)),
              h(Bar, { value: result.breedMatch, tone: tone }),
            ),
            h('p', { className: 'cb-match-note' }, result.breedNote),
          ),
          h(ScoreRing, { total: result.total }),
        ),
        h(
          'div',
          { className: 'cb-meta-row' },
          h('span', null, '报告编号 ' + reportId),
          h('span', null, '评审模型 ' + (props.meta ? props.meta.model : 'deepseek-flash')),
          props.meta && props.meta.frames ? h('span', null, '素材 ' + props.meta.frames + ' 帧') : null,
          h('span', null, new Date().toLocaleDateString('zh-CN')),
        ),
        result.priceEstimate && result.priceEstimate.min > 0
          ? h(
              'section',
              { className: 'cb-card cb-price' },
              h('h3', null, '国内宠物市场参考价'),
              h(
                'div',
                { className: 'cb-price-value' },
                '¥' + formatMoney(result.priceEstimate.min) + ' – ¥' + formatMoney(result.priceEstimate.max),
              ),
              h('p', null, result.priceEstimate.note),
              h('p', { className: 'cb-price-note' }, '按当前国内宠物市场行情 + 品相估算，受血统、证书、地区、年龄影响；仅供娱乐参考，不构成交易建议。'),
            )
          : null,
        h(
          'div',
          { className: 'cb-result-grid' },
          h(
            'section',
            { className: 'cb-card cb-card-radar' },
            h('h3', null, h('span', { className: 'cb-sec-no' }, '01'), '能力雷达'),
            points ? h(RadarChart, { points: points, scores: result.scores, highlight: hoverDim }) : null,
            h('p', { className: 'cb-radar-tip' }, '点右侧维度或悬停，雷达顶点会跟着亮'),
          ),
          h(
            'section',
            { className: 'cb-card' },
            h('h3', null, h('span', { className: 'cb-sec-no' }, '02'), '逐项点评（点击展开）'),
            h(
              'div',
              { className: 'cb-dims' },
              (points || []).map(function (point, index) {
                var expanded = expandedDim === point.key
                var score = result.scores[point.key] ?? 0
                var contribution = ((score / 100) * point.max).toFixed(1)
                return h(
                  'div',
                  {
                    key: point.key,
                    className: 'cb-dim' + (expanded ? ' cb-dim-open' : '') + (hoverDim === point.key ? ' cb-dim-hover' : ''),
                    onClick: function () { setExpandedDim(expanded ? null : point.key) },
                    onMouseEnter: function () { setHoverDim(point.key) },
                    onMouseLeave: function () { setHoverDim(null) },
                  },
                  h(
                    'div',
                    { className: 'cb-dim-head' },
                    h('span', { className: 'cb-dim-label' }, point.label),
                    h(
                      'span',
                      { className: 'cb-dim-score' },
                      h('strong', { style: { color: dimTone(index) } }, String(score)),
                      h('em', null, ' /100 · 权重 ' + point.max),
                    ),
                  ),
                  h(Bar, { value: score, tone: dimTone(index) }),
                  expanded
                    ? h(
                        'div',
                        { className: 'cb-dim-detail' },
                        h('p', null, '标准要点：' + (point.hint || '—')),
                        h('p', null, '评委点评：' + (result.comments[point.key] || '—')),
                        h('p', { className: 'cb-dim-math' }, '得分贡献：' + score + '/100 × ' + point.max + ' 分 = ' + contribution + ' 分'),
                      )
                    : h('p', { className: 'cb-dim-comment' }, result.comments[point.key] || ''),
                )
              }),
            ),
            h('p', { className: 'cb-sum' }, '总分 = Σ(维度完成度 × 权重) = ' + result.total),
          ),
          h(
            'section',
            { className: 'cb-card' },
            h('h3', null, h('span', { className: 'cb-sec-no' }, '03'), '亮点'),
            h(
              'ul',
              { className: 'cb-list cb-list-good' },
              (result.highlights.length > 0 ? result.highlights : ['这只猫的优点需要裁判再想想。']).map(function (text, index) {
                return h('li', { key: index }, text)
              }),
            ),
            h('h3', { className: 'cb-list-gap' }, '扣分点 / 改进'),
            h(
              'ul',
              { className: 'cb-list cb-list-warn' },
              (result.improvements.length > 0 ? result.improvements : ['没有明显扣分项，或者照片角度看不出来。']).map(function (text, index) {
                return h('li', { key: index }, text)
              }),
            ),
          ),
          h(
            'section',
            { className: 'cb-card cb-card-judge' },
            h('h3', null, h('span', { className: 'cb-sec-no' }, '04'), '裁判总评'),
            h('p', { className: 'cb-judge' }, result.judge),
            h(
              'div',
              { className: 'cb-sign' },
              h('span', null, 'CFA 赛猫评审 · AI 裁判'),
              h('span', null, (props.meta ? props.meta.model : 'deepseek-flash') + ' · ' + new Date().toLocaleDateString('zh-CN')),
            ),
          ),
        ),
        shotTips.length > 0
          ? h(
              'section',
              { className: 'cb-card' },
              h('h3', null, h('span', { className: 'cb-sec-no' }, '05'), '下次拍摄建议'),
              h(
                'ul',
                { className: 'cb-list' },
                shotTips.map(function (point) {
                  return h('li', { key: point.key }, point.label + '：' + result.comments[point.key])
                }),
              ),
            )
          : null,
        showPublishDialog
          ? h(
              'section',
              { className: 'cb-card cb-publish' },
              h('h3', null, '发布到公开榜单'),
              h('label', { className: 'cb-publish-label' }, '宠物名字'),
              h('input', {
                className: 'cb-publish-input',
                type: 'text',
                value: petName,
                maxLength: 30,
                placeholder: '给它起个名字（会显示在榜单上）',
                onChange: function (event) { setPetName(event.target.value) },
              }),
              h(
                'div',
                { className: 'cb-publish-preview' },
                props.thumb ? h('img', { src: props.thumb, alt: '' }) : null,
                h('span', null, result.breedName + ' · ' + result.total + ' 分 · ' + props.grade.label),
              ),
              h(
                'div',
                { className: 'cb-publish-actions' },
                h(
                  'button',
                  { type: 'button', className: 'cb-btn cb-btn-primary', onClick: publishScore, disabled: publishStatus === 'publishing' },
                  publishStatus === 'publishing' ? '发布中…' : '确认发布',
                ),
                h('button', { type: 'button', className: 'cb-btn', onClick: function () { setShowPublishDialog(false) } }, '取消'),
              ),
              h('p', { className: 'cb-publish-note' }, '只上传 160px 缩略图 + 名字/品种/分数/评语，不上传原图。'),
            )
          : null,
        showPanel
          ? h(
              'section',
              { className: 'cb-card cb-share-panel' },
              h('h3', null, '分享文案'),
              h(
                'div',
                { className: 'cb-share-tabs' },
                h('button', { type: 'button', className: 'cb-tab' + (platform === 'xiaohongshu' ? ' cb-tab-active' : ''), onClick: function () { setPlatform('xiaohongshu') } }, '小红书'),
                h('button', { type: 'button', className: 'cb-tab' + (platform === 'weibo' ? ' cb-tab-active' : ''), onClick: function () { setPlatform('weibo') } }, '微博'),
              ),
              h('textarea', { className: 'cb-share-text', readOnly: true, value: buildShareCopy(result, breed, props.grade, platform, displayName) }),
              h('button', { type: 'button', className: 'cb-btn cb-btn-primary', onClick: copyShareText }, copied ? '已复制 ✓' : '复制文案'),
            )
          : null,
        h(
          'div',
          { className: 'cb-result-foot' },
          h('button', { type: 'button', className: 'cb-btn cb-btn-primary', onClick: props.onAgain }, '再评一张'),
          h('button', { type: 'button', className: 'cb-btn', onClick: props.onSave }, props.saved ? '已存历史' : '存入历史'),
          h(
            'button',
            { type: 'button', className: 'cb-btn', onClick: share, disabled: shareStatus === 'rendering' },
            shareStatus === 'rendering' ? '生成中…' : shareStatus === 'error' ? '生成失败，重试' : '生成分享图',
          ),
          h(
            'button',
            { type: 'button', className: 'cb-btn', onClick: function () { setShowPanel(!showPanel) } },
            showPanel ? '收起文案' : '分享文案',
          ),
          LEADERBOARD_URL === ''
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'cb-btn' + (publishStatus === 'done' ? ' cb-btn-done' : ''),
                  disabled: publishStatus === 'publishing' || publishStatus === 'done',
                  onClick:
                    publishStatus === 'done'
                      ? function () { window.open(LEADERBOARD_URL, '_blank') }
                      : function () {
                          setPetName(displayName || result.caption)
                          setShowPublishDialog(true)
                        },
                },
                publishStatus === 'publishing'
                  ? '发布中…'
                  : publishStatus === 'done'
                    ? '已上榜 ↗'
                    : publishStatus === 'error'
                      ? '发布失败，重试'
                      : '发布到榜单',
              ),
        ),
      )
    }

    /** The panel itself. */
    function CatPage() {
      var breedsState = React.useState(null)
      var breeds = breedsState[0]
      var setBreeds = breedsState[1]

      var loadState = React.useState({ status: 'loading', error: null })
      var load = loadState[0]
      var setLoad = loadState[1]

      var breedState = React.useState('')
      var breedId = breedState[0]
      var setBreedId = breedState[1]

      var fileState = React.useState(null)
      var file = fileState[0]
      var setFile = fileState[1]

      var judgeState = React.useState({ status: 'idle', error: null })
      var judge = judgeState[0]
      var setJudge = judgeState[1]

      var resultState = React.useState(null)
      var result = resultState[0]
      var setResult = resultState[1]

      var metaState = React.useState(null)
      var meta = metaState[0]
      var setMeta = metaState[1]

      var resultPhotoState = React.useState(null)
      var resultPhoto = resultPhotoState[0]
      var setResultPhoto = resultPhotoState[1]

      var resultFramesState = React.useState(null)
      var resultFrames = resultFramesState[0]
      var setResultFrames = resultFramesState[1]

      var savedState = React.useState(false)
      var saved = savedState[0]
      var setSaved = savedState[1]

      var historyState = React.useState(loadHistory)
      var history = historyState[0]
      var setHistory = historyState[1]

      var dragState = React.useState(false)
      var dragging = dragState[0]
      var setDragging = dragState[1]

      var readingState = React.useState(false)
      var reading = readingState[0]
      var setReading = readingState[1]

      var historyViewState = React.useState('recent')
      var historyView = historyViewState[0]
      var setHistoryView = historyViewState[1]

      var petNameState = React.useState('')
      var petNameInput = petNameState[0]
      var setPetNameInput = petNameState[1]

      var detectState = React.useState({ status: 'idle', candidates: [], subject: null, note: '', error: null })
      var detectInfo = detectState[0]
      var setDetectInfo = detectState[1]

      var inputRef = React.useRef(null)
      var requestRef = React.useRef(null)

      var loadBreeds = React.useCallback(function () {
        setLoad({ status: 'loading', error: null })
        fetch('/cat-beauty/breeds')
          .then(function (response) {
            return response.text().then(function (text) {
              var payload = null
              try {
                payload = JSON.parse(text)
              } catch {
                payload = null
              }
              if (!response.ok || !payload || payload.ok !== true) {
                throw {
                  code: payload && payload.error && payload.error.code,
                  message: (payload && payload.error && payload.error.message) || '加载品种表失败（HTTP ' + response.status + '）',
                }
              }
              return payload
            })
          })
          .then(function (payload) {
            setBreeds(payload.breeds)
            setLoad({ status: 'ready', error: null })
          })
          .catch(function (error) {
            setLoad({ status: 'error', error: error && error.message ? error : { message: '加载品种表失败' } })
          })
      }, [])

      React.useEffect(function () {
        loadBreeds()
      }, [loadBreeds])

      var acceptFiles = React.useCallback(function (fileList) {
        var files = Array.prototype.slice.call(fileList || [])
        if (files.length === 0) return Promise.resolve()
        setJudge({ status: 'idle', error: null })
        var video = null
        var images = []
        for (var index = 0; index < files.length; index += 1) {
          var file = files[index]
          var mime = typeof file.type === 'string' ? file.type.toLowerCase() : ''
          var name = typeof file.name === 'string' ? file.name.toLowerCase() : ''
          // A file set through some automation paths, or copied without an
          // extension, can arrive with an empty MIME; fall back to the suffix.
          var isVideo = mime.indexOf('video/') === 0 || (mime === '' && /\.(mp4|webm|mov|m4v|avi|mkv)$/.test(name))
          var isImage = mime.indexOf('image/') === 0 || (mime === '' && /\.(png|jpe?g|webp|gif)$/.test(name))
          if (isVideo) {
            if (video === null) video = file
          } else if (isImage) {
            images.push(file)
          }
        }
        var prepared = video !== null ? prepareVideo(video) : prepareImages(images)
        return prepared
          .then(function (media) {
            setFile(media)
          })
          .catch(function (error) {
            setJudge({ status: 'error', error: error || { message: '无法处理这些文件' } })
          })
      }, [])

      var runDetect = React.useCallback(function () {
        if (!file) {
          setJudge({ status: 'error', error: { code: 'MISSING_IMAGE', message: '先上传一张猫片' } })
          return
        }
        setDetectInfo({ status: 'loading', candidates: [], subject: null, note: '', error: null })
        fetch('/cat-beauty/detect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            images: [{ mediaType: 'image/jpeg', data: file.frames[0].base64 }],
          }),
        })
          .then(function (response) {
            return response.text().then(function (text) {
              var payload = null
              try {
                payload = JSON.parse(text)
              } catch {
                payload = null
              }
              if (!payload || payload.ok !== true) {
                throw {
                  code: (payload && payload.error && payload.error.code) || 'DETECT_FAILED',
                  message: (payload && payload.error && payload.error.message) || '识别失败',
                }
              }
              return payload
            })
          })
          .then(function (payload) {
            setDetectInfo({
              status: 'idle',
              candidates: payload.candidates || [],
              subject: payload.subject || 'cat',
              note: payload.speciesNote || '',
              error: null,
            })
            if (payload.candidates && payload.candidates.length > 0) setBreedId(payload.candidates[0].breedId)
          })
          .catch(function (error) {
            setDetectInfo({ status: 'idle', candidates: [], subject: null, note: '', error: error || { message: '识别失败' } })
          })
      }, [file])

      React.useEffect(function () {
        var onPaste = function (event) {
          var clipboard = event.clipboardData
          if (!clipboard) return
          var items = clipboard.items || []
          var pickedFiles = []
          for (var index = 0; index < items.length; index += 1) {
            var item = items[index]
            if (item.kind !== 'file') continue
            if (item.type.indexOf('image/') !== 0 && item.type.indexOf('video/') !== 0) continue
            var picked = item.getAsFile()
            if (picked) pickedFiles.push(picked)
          }
          if (pickedFiles.length > 0) {
            event.preventDefault()
            void acceptFiles(pickedFiles)
            return
          }
          // Finder puts file PATHS on the clipboard, not the bytes. The host runs
          // on this machine, so read those paths there and hand the bytes back.
          var text = (clipboard.getData('text/plain') || '') || (clipboard.getData('text/uri-list') || '')
          var pastedPaths = extractMediaPaths(text)
          if (pastedPaths.length > 0) {
            event.preventDefault()
            setJudge({ status: 'idle', error: null })
            setReading(true)
            Promise.all(pastedPaths.map(readLocalPath))
              .then(function (files) {
                return acceptFiles(files)
              })
              .catch(function (error) {
                setJudge({ status: 'error', error: error || { message: '读取本地文件失败' } })
              })
              .finally(function () {
                setReading(false)
              })
          }
        }
        document.addEventListener('paste', onPaste)
        return function () {
          document.removeEventListener('paste', onPaste)
        }
      }, [acceptFiles])

      var currentBreed = React.useMemo(function () {
        if (!breeds || !breedId) return null
        return breeds.find(function (entry) { return entry.id === breedId }) || null
      }, [breeds, breedId])

      var judgeWithBreed = React.useCallback(function (targetBreed) {
        if (!file) return
        setJudge({ status: 'loading', error: null })
        setSaved(false)
        var controller = new AbortController()
        requestRef.current = controller
        var timer = setTimeout(function () { controller.abort() }, 200_000)

        fetch('/cat-beauty/score', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            breedId: targetBreed,
            mediaKind: file.kind === 'video' ? 'video' : 'photo',
            images: file.frames.map(function (frame) {
              return { mediaType: 'image/jpeg', data: frame.base64 }
            }),
            fileName: file.name,
          }),
          signal: controller.signal,
        })
          .then(function (response) {
            return response.text().then(function (text) {
              var payload = null
              try {
                payload = JSON.parse(text)
              } catch {
                payload = null
              }
              if (!payload || payload.ok !== true) {
                throw {
                  code: payload && payload.error && payload.error.code,
                  message: (payload && payload.error && payload.error.message) || '评分失败（HTTP ' + response.status + '）',
                  raw: payload && payload.error && payload.error.raw,
                }
              }
              return payload
            })
          })
          .then(function (payload) {
            setResult(payload.result)
            setMeta(payload.meta || null)
            setResultPhoto(file.dataUrl)
            setResultFrames(
              file.frames.length > 1
                ? file.frames.map(function (frame) { return frame.dataUrl })
                : null,
            )
            setJudge({ status: 'idle', error: null })
          })
          .catch(function (error) {
            if (error && error.name === 'AbortError') {
              setJudge({ status: 'error', error: { code: 'TIMEOUT', message: '评审超时' } })
            } else {
              setJudge({ status: 'error', error: error && error.message ? error : { code: 'internal', message: '评分失败' } })
            }
          })
          .finally(function () {
            clearTimeout(timer)
            requestRef.current = null
          })
      }, [file])

      var startJudge = React.useCallback(function () {
        if (!file) {
          setJudge({ status: 'error', error: { code: 'MISSING_IMAGE', message: '先上传一张猫片' } })
          return
        }
        if (breedId) {
          judgeWithBreed(breedId)
          return
        }
        // No breed picked: detect first, then judge with the most likely breed.
        setJudge({ status: 'loading', error: null })
        setDetectInfo({ status: 'loading', candidates: [], subject: null, note: '', error: null })
        fetch('/cat-beauty/detect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ images: [{ mediaType: 'image/jpeg', data: file.frames[0].base64 }] }),
        })
          .then(function (response) {
            return response.text().then(function (text) {
              var payload = null
              try {
                payload = JSON.parse(text)
              } catch {
                payload = null
              }
              if (!payload || payload.ok !== true) {
                throw {
                  code: (payload && payload.error && payload.error.code) || 'DETECT_FAILED',
                  message: (payload && payload.error && payload.error.message) || '自动识别失败',
                }
              }
              return payload
            })
          })
          .then(function (payload) {
            var top = payload.candidates && payload.candidates[0]
            if (!top) throw { code: 'NO_BREED', message: '识别不出品种，请手动选一个再评分' }
            setBreedId(top.breedId)
            setDetectInfo({
              status: 'idle',
              candidates: payload.candidates || [],
              subject: payload.subject || 'cat',
              note: payload.speciesNote || '',
              error: null,
            })
            judgeWithBreed(top.breedId)
          })
          .catch(function (error) {
            setDetectInfo({ status: 'idle', candidates: [], subject: null, note: '', error: null })
            setJudge({ status: 'error', error: error || { message: '自动识别失败，手动选一个品种吧' } })
          })
      }, [file, breedId, judgeWithBreed])

      var reset = React.useCallback(function () {
        if (requestRef.current) requestRef.current.abort()
        setFile(null)
        setResult(null)
        setMeta(null)
        setResultPhoto(null)
        setResultFrames(null)
        setJudge({ status: 'idle', error: null })
        setSaved(false)
      }, [])

      var commitHistory = React.useCallback(function () {
        if (saved || !result || !currentBreed) return
        var entry = {
          ts: Date.now(),
          breedId: result.breedId,
          breedName: result.breedName,
          caption: result.caption,
          total: result.total,
          thumb: file ? file.thumb : resultPhoto,
          points: currentBreed.points,
          result: result,
        }
        var next = [entry].concat(history.filter(function (item) {
          return !(item.ts === entry.ts)
        })).slice(0, HISTORY_LIMIT)
        setHistory(next)
        saveHistory(next)
        setSaved(true)
      }, [saved, result, currentBreed, file, resultPhoto, history])

      var openHistory = React.useCallback(function (item) {
        setResult(Object.assign({}, item.result, { points: item.points }))
        setMeta(null)
        setResultPhoto(item.thumb || null)
        setResultFrames(null)
        setSaved(true)
        setBreedId(item.breedId)
      }, [])

      var onDrop = function (event) {
        event.preventDefault()
        setDragging(false)
        var dropped = event.dataTransfer && event.dataTransfer.files
        if (dropped && dropped.length > 0) void acceptFiles(dropped)
      }

      var judgeLoading = judge.status === 'loading'
      var judgeError = judge.status === 'error' ? judge.error : null
      var grade = result ? (function () {
        var bands = [
          { min: 95, id: 'splus', label: 'Best in Show 级', note: '顶级赛猫水准，几乎无可挑剔' },
          { min: 90, id: 's', label: 'Grand Champion 级', note: '优秀赛级，细节非常到位' },
          { min: 85, id: 'aplus', label: 'Champion 级', note: '赛级水准，仅有轻微偏差' },
          { min: 79, id: 'a', label: '赛级预备', note: '品相明显高于普通家猫' },
          { min: 72, id: 'bplus', label: '品相优良', note: '可爱的标准家猫，有突出优点' },
          { min: 65, id: 'b', label: '标准家猫', note: '日常颜值在线，符合大众审美' },
          { min: 55, id: 'c', label: '个性选手', note: '不走标准路线，但很有辨识度' },
          { min: 0, id: 'd', label: '灵魂选手', note: '颜值全点在性格上了' },
        ]
        return bands.find(function (band) { return result.total >= band.min }) || bands[bands.length - 1]
      })() : null

      return h(
        'div',
        { className: 'cb-root' },
        h(
          'style',
          null,
          CAT_CSS,
        ),
        h(
          'header',
          { className: 'cb-header' },
          h(
            'div',
            { className: 'cb-brand' },
            h('span', { className: 'cb-brand-glyph' }, h(CatIcon, { size: 22 })),
            h(
              'span',
              null,
              h('strong', null, '喵星大道'),
              h('small', null, 'CFA 品种标准 · AI 评审'),
            ),
          ),
          h(
            'div',
            { className: 'cb-header-side' },
            h('span', { className: 'cb-disclaimer' }, '娱乐向评分，非 CFA 官方评审'),
            meta ? h('span', { className: 'cb-header-meta' }, meta.model + ' · ' + (meta.elapsedMs / 1000).toFixed(1) + 's') : null,
          ),
        ),
        h(
          'div',
          { className: 'cb-body' },
          h(
            'aside',
            { className: 'cb-left' },
            h(
              'div',
              {
                className: 'cb-drop' + (dragging ? ' cb-drop-active' : '') + (file ? ' cb-drop-has-file' : ''),
                onDragOver: function (event) {
                  event.preventDefault()
                  setDragging(true)
                },
                onDragLeave: function () { setDragging(false) },
                onDrop: onDrop,
                onClick: function () { if (inputRef.current) inputRef.current.click() },
                role: 'button',
                tabIndex: 0,
                onKeyDown: function (event) {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    if (inputRef.current) inputRef.current.click()
                  }
                },
              },
              h('input', {
                ref: inputRef,
                type: 'file',
                accept: 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime',
                multiple: true,
                style: { display: 'none' },
                onChange: function (event) {
                  var picked = event.target.files
                  if (picked && picked.length > 0) void acceptFiles(picked)
                  event.target.value = ''
                },
              }),
              file
                ? h(
                    'div',
                    { className: 'cb-drop-preview' },
                    file.kind === 'video' || file.frames.length > 1
                      ? h(
                          'div',
                          { className: 'cb-frame-strip' },
                          file.frames.map(function (frame, index) {
                            return h('img', { key: index, src: frame.dataUrl, alt: '第 ' + (index + 1) + ' 张' })
                          }),
                        )
                      : h('img', { src: file.dataUrl, alt: '待评分的猫' }),
                    h(
                      'div',
                      { className: 'cb-drop-meta' },
                      h('strong', null, file.name),
                      h(
                        'span',
                        null,
                        file.kind === 'video'
                          ? '视频 · ' + file.duration.toFixed(1) + 's · 已抽 ' + file.frames.length + ' 帧'
                          : file.frames.length > 1
                            ? file.frames.length + ' 张照片 · ' + Math.round(file.bytes / 1024) + 'KB · 综合评分'
                            : file.width + ' × ' + file.height + ' · ' + (file.bytes / 1024).toFixed(0) + 'KB',
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cb-link',
                          onClick: function (event) {
                            event.stopPropagation()
                            reset()
                          },
                        },
                        '移除重选',
                      ),
                    ),
                  )
                : h(
                    'div',
                    { className: 'cb-drop-empty' },
                    h(CatIcon, { size: 34 }),
                    h('strong', null, '上传 1–4 张猫片，或 1 段视频'),
                    h('span', null, '多张可一起拖入，或复制文件后 Ctrl/Cmd+V 粘贴'),
                    h('em', null, '多张照片按不同角度综合评分；视频自动抽 4 帧'),
                  ),
              h(
                'div',
                { className: 'cb-drop-hint' },
                file ? '换一个也行，点上方区域重新选' : '正面照 / 稳定跟拍最容易拿高分',
              ),
            ),
            h(
              'div',
              { className: 'cb-picker' },
              h('label', { htmlFor: 'cb-petname' }, '宠物名字（可选）'),
              h('input', {
                id: 'cb-petname',
                className: 'cb-petname-input',
                type: 'text',
                value: petNameInput,
                maxLength: 30,
                placeholder: '不填就用裁判标题',
                onChange: function (event) { setPetNameInput(event.target.value) },
              }),
            ),
            h(
              'div',
              { className: 'cb-picker' },
              h('label', { htmlFor: 'cb-breed' }, '品种'),
              h(
                'select',
                {
                  id: 'cb-breed',
                  value: breedId,
                  onChange: function (event) { setBreedId(event.target.value) },
                },
                h('option', { value: '' }, load.status === 'loading' ? '正在加载品种表…' : '自动识别（推荐，不选也行）'),
                (breeds || []).map(function (breed) {
                  return h('option', { key: breed.id, value: breed.id }, breed.name + ' · ' + breed.en)
                }),
              ),
              currentBreed
                ? h(
                    'div',
                    { className: 'cb-breed-info' },
                    h('p', { className: 'cb-breed-blurb' }, currentBreed.blurb),
                    h(
                      'div',
                      { className: 'cb-breed-points' },
                      currentBreed.points.map(function (point) {
                        return h('span', { key: point.key, title: point.hint }, point.label + ' ' + point.max)
                      }),
                    ),
                  )
                : null,
              h(
                'div',
                { className: 'cb-detect' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cb-btn cb-btn-sm',
                    disabled: detectInfo.status === 'loading' || !file,
                    onClick: runDetect,
                  },
                  detectInfo.status === 'loading' ? '识别中…' : '自动识别宠物/品种',
                ),
                detectInfo.subject && detectInfo.subject !== 'cat'
                  ? h(
                      'p',
                      { className: 'cb-detect-note' },
                      '识别到 ' +
                        (detectInfo.subject === 'dog' ? '狗' : '非猫动物') +
                        (detectInfo.note ? '：' + detectInfo.note : '') +
                        '（本插件只按猫的标准评分）',
                    )
                  : null,
                detectInfo.candidates.length > 0
                  ? h(
                      'div',
                      { className: 'cb-detect-list' },
                      detectInfo.candidates.map(function (candidate) {
                        return h(
                          'button',
                          {
                            key: candidate.breedId,
                            type: 'button',
                            className: 'cb-detect-item' + (candidate.breedId === breedId ? ' cb-detect-active' : ''),
                            title: candidate.reason,
                            onClick: function () { setBreedId(candidate.breedId) },
                          },
                          candidate.name + ' ' + candidate.confidence + '%',
                        )
                      }),
                    )
                  : null,
                detectInfo.error ? h('p', { className: 'cb-detect-note' }, errorText(detectInfo.error)) : null,
              ),
            ),
            judgeError
              ? h(
                  'div',
                  { className: 'cb-error' },
                  h('strong', null, '这次没评成'),
                  h('span', null, errorText(judgeError)),
                  judgeError.code ? h('code', null, judgeError.code) : null,
                  judgeError.raw ? h('pre', { className: 'cb-raw' }, String(judgeError.raw).slice(0, 1200)) : null,
                )
              : null,
            h(
              'div',
              { className: 'cb-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'cb-btn cb-btn-primary cb-btn-lg',
                  disabled: judgeLoading || reading || load.status !== 'ready',
                  onClick: startJudge,
                },
                judgeLoading ? '裁判端详中…' : reading ? '正在读取本地文件…' : '开始评分',
              ),
              h(
                'a',
                {
                  className: 'cb-leaderboard-link',
                  href: LEADERBOARD_URL,
                  target: '_blank',
                  rel: 'noreferrer noopener',
                },
                '🐱 猫猫颜值榜 ↗',
              ),
            ),
            h(
              'div',
              { className: 'cb-history' },
              h(
                'div',
                { className: 'cb-history-head' },
                h('strong', null, '本地历史'),
                history.length > 0
                  ? h(
                      'div',
                      { className: 'cb-history-tools' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cb-link',
                          onClick: function () { setHistoryView(historyView === 'recent' ? 'rank' : 'recent') },
                        },
                        historyView === 'recent' ? '按分数排' : '按时间排',
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cb-link',
                          onClick: function () {
                            setHistory([])
                            saveHistory([])
                          },
                        },
                        '清空',
                      ),
                    )
                  : null,
              ),
              history.length === 0
                ? h('p', { className: 'cb-history-empty' }, '评过的猫会留在这里（只存缩略图和分数）。')
                : (historyView === 'rank'
                    ? history.slice().sort(function (a, b) { return b.total - a.total })
                    : history
                  ).map(function (item, index) {
                    return h(HistoryRow, {
                      key: item.ts,
                      item: item,
                      rank: historyView === 'rank' ? index + 1 : null,
                      onOpen: openHistory,
                    })
                  }),
            ),
          ),
          h(
            'main',
            { className: 'cb-right' },
            judgeLoading
              ? h(
                  'div',
                  { className: 'cb-loading' },
                  h('div', { className: 'cb-loading-cat' }, h(CatIcon, { size: 54 })),
                  h('strong', null, 'CFA 裁判正在端详…'),
                  h('span', null, '看头版、看骨架、看毛量、看眼色，一次评测大约 10–40 秒。'),
                )
              : result
                ? h(ResultCard, {
                    result: result,
                    breed: currentBreed,
                    points: currentBreed ? currentBreed.points : null,
                    grade: grade,
                    photo: resultPhoto,
                    frames: resultFrames,
                    thumb: file ? file.thumb : resultPhoto,
                    initialName: petNameInput,
                    meta: meta,
                    historyRank: history.length > 0 && result ? history.filter(function (item) { return item.total > result.total }).length + 1 : null,
                    historyCount: history.length,
                    onAgain: reset,
                    onSave: commitHistory,
                    saved: saved,
                  })
                : judgeError
                  ? h(
                      'div',
                      { className: 'cb-empty' },
                      h('div', { className: 'cb-empty-glyph cb-empty-glyph-warn' }, h(CatIcon, { size: 54 })),
                      h('h2', null, '裁判没看成'),
                      h('p', null, errorText(judgeError)),
                      judgeError.code ? h('code', { className: 'cb-error-code' }, judgeError.code) : null,
                      judgeError.raw
                        ? h(
                            'details',
                            { className: 'cb-error-details' },
                            h('summary', null, '查看模型原始输出'),
                            h('pre', null, String(judgeError.raw).slice(0, 2500)),
                          )
                        : null,
                      h(
                        'button',
                        { type: 'button', className: 'cb-btn cb-btn-primary', onClick: startJudge },
                        '重试',
                      ),
                    )
                  : h(EmptyState, null),
          ),
        ),
        h(
          'footer',
          { className: 'cb-footer' },
          h('span', null, '评分点结构参考 CFA 品种标准（cfa.org）的 Point Score，逐项点评由 AI 生成，仅供娱乐。'),
          load.status === 'error' ? h('button', { type: 'button', className: 'cb-link', onClick: loadBreeds }, '重新加载品种表') : null,
        ),
      )
    }

    /** Panel-scoped stylesheet, injected once per mounted panel. */
    var CAT_CSS = [
      ':root{--cb-bg:#f2f2f7;--cb-card:#ffffff;--cb-label:#000000;--cb-secondary:#8e8e93;--cb-tertiary:#c7c7cc;--cb-sep:rgba(60,60,67,.12);--cb-blue:#007aff;--cb-green:#34c759;--cb-orange:#ff9500;--cb-red:#ff3b30;--cb-fill:rgba(118,118,128,.12)}',
      '@media (prefers-color-scheme: dark){:root{--cb-bg:#000000;--cb-card:#1c1c1e;--cb-label:#ffffff;--cb-secondary:#98989f;--cb-tertiary:#48484a;--cb-sep:rgba(84,84,88,.65);--cb-fill:rgba(118,118,128,.24)}}',
      '.cb-root{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--cb-bg);color:var(--cb-label);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}',
      '.cb-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;background:var(--cb-bg);border-bottom:.5px solid var(--cb-sep);flex:none}',
      '.cb-brand{display:flex;align-items:center;gap:10px}',
      '.cb-brand-glyph{display:inline-flex;color:var(--cb-blue)}',
      '.cb-brand strong{display:block;font-size:17px;font-weight:700;letter-spacing:-.2px}',
      '.cb-brand small{display:block;font-size:11px;color:var(--cb-secondary)}',
      '.cb-header-side{display:flex;align-items:center;gap:12px;font-size:11px;color:var(--cb-secondary)}',
      '.cb-disclaimer{opacity:.9}',
      '.cb-header-meta{font-variant-numeric:tabular-nums}',
      '.cb-body{flex:1;display:flex;min-height:0}',
      '.cb-left{width:330px;flex:none;display:flex;flex-direction:column;gap:14px;padding:16px;border-right:.5px solid var(--cb-sep);overflow:auto;min-height:0}',
      '.cb-right{flex:1;min-width:0;overflow:auto;padding:20px 24px 28px}',
      '.cb-drop{position:relative;border:.5px solid var(--cb-sep);border-radius:14px;background:var(--cb-card);cursor:pointer;transition:border-color .15s,background .15s;overflow:hidden;flex:none}',
      '.cb-drop:hover{border-color:var(--cb-blue)}',
      '.cb-drop-active{border-color:var(--cb-blue);background:var(--cb-fill)}',
      '.cb-drop-has-file{cursor:default}',
      '.cb-drop-preview img{display:block;width:100%;max-height:260px;object-fit:cover}',
      '.cb-frame-strip{display:grid;grid-template-columns:repeat(2,1fr);gap:2px;background:var(--cb-sep)}',
      '.cb-frame-strip img{width:100%;height:100%;max-height:132px;object-fit:cover;display:block}',
      '.cb-frame-grid{display:grid;grid-template-columns:repeat(2,1fr);grid-auto-rows:1fr;gap:2px;width:100%;height:100%}',
      '.cb-frame-grid img{width:100%;height:100%;object-fit:cover;display:block}',
      '.cb-drop-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:28px 16px;text-align:center;color:var(--cb-secondary)}',
      '.cb-drop-empty strong{font-size:14px;font-weight:600;color:var(--cb-label)}',
      '.cb-drop-empty span{font-size:11.5px}',
      '.cb-drop-empty em{font-size:10.5px;font-style:normal;color:var(--cb-tertiary)}',
      '.cb-drop-meta{display:flex;flex-direction:column;gap:2px;padding:10px 12px;font-size:11px;color:var(--cb-secondary)}',
      '.cb-drop-meta strong{font-size:12.5px;font-weight:600;color:var(--cb-label);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cb-drop-hint{padding:7px 12px;font-size:10.5px;color:var(--cb-tertiary);border-top:.5px solid var(--cb-sep);text-align:center}',
      '.cb-picker{display:flex;flex-direction:column;gap:6px;flex:none}',
      '.cb-picker label{font-size:11px;font-weight:600;color:var(--cb-secondary);letter-spacing:.2px}',
      '.cb-picker select{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:none;background:var(--cb-fill);color:var(--cb-label);font-size:14px;outline:none;-webkit-appearance:none;appearance:none}',
      '.cb-picker input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:none;background:var(--cb-fill);color:var(--cb-label);font-size:14px;outline:none}',
      '.cb-picker input:focus{box-shadow:0 0 0 3px rgba(0,122,255,.25)}',
      '.cb-picker select:focus{box-shadow:0 0 0 3px rgba(0,122,255,.25)}',
      '.cb-breed-info{display:flex;flex-direction:column;gap:6px}',
      '.cb-breed-blurb{font-size:12px;color:var(--cb-secondary);margin:0}',
      '.cb-breed-points{display:flex;flex-wrap:wrap;gap:4px}',
      '.cb-breed-points span{font-size:10.5px;padding:2px 8px;border-radius:999px;background:var(--cb-fill);color:var(--cb-secondary);cursor:help}',
      '.cb-detect{display:flex;flex-direction:column;gap:6px;margin-top:2px}',
      '.cb-btn-sm{padding:6px 12px;font-size:12px;align-self:flex-start}',
      '.cb-detect-list{display:flex;flex-wrap:wrap;gap:4px}',
      '.cb-detect-item{border:none;background:var(--cb-fill);color:var(--cb-label);border-radius:999px;padding:4px 11px;font-size:11.5px;cursor:pointer;transition:background .15s}',
      '.cb-detect-item:hover{background:rgba(118,118,128,.2)}',
      '.cb-detect-active{background:var(--cb-blue);color:#fff}',
      '.cb-detect-note{margin:0;font-size:11px;color:var(--cb-secondary)}',
      '.cb-actions{display:flex;gap:8px;flex:none}',
      '.cb-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 16px;border-radius:12px;border:none;background:var(--cb-fill);color:var(--cb-label);font-size:13px;font-weight:600;cursor:pointer;transition:background .15s,opacity .15s}',
      '.cb-btn:hover{background:rgba(118,118,128,.2)}',
      '.cb-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.cb-btn-lg{flex:1;padding:13px 16px;font-size:15px;font-weight:600}',
      '.cb-btn-primary{background:var(--cb-blue);color:#fff}',
      '.cb-btn-primary:hover:not(:disabled){background:#0066d6}',
      '.cb-btn-done{background:rgba(52,199,89,.14);color:var(--cb-green)}',
      '.cb-btn-done:hover{background:rgba(52,199,89,.2)}',
      '.cb-link{border:none;background:none;padding:0;color:var(--cb-blue);cursor:pointer;font-size:12px;font-weight:500}',
      '.cb-error{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:12px;background:rgba(255,59,48,.08);border:.5px solid rgba(255,59,48,.3);font-size:12px;flex:none}',
      '.cb-error strong{color:var(--cb-red);font-weight:600}',
      '.cb-error code{font-size:10px;opacity:.7}',
      '.cb-error-code{font-size:10.5px;color:var(--cb-secondary);background:var(--cb-fill);padding:2px 8px;border-radius:999px}',
      '.cb-error-details{width:100%;max-width:560px;font-size:11px;text-align:left;color:var(--cb-secondary)}',
      '.cb-error-details summary{cursor:pointer;color:var(--cb-blue)}',
      '.cb-error-details pre{max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-all;background:var(--cb-fill);padding:8px;border-radius:10px;font-size:10px;margin:6px 0 0}',
      '.cb-raw{max-height:140px;overflow:auto;font-size:10px;white-space:pre-wrap;word-break:break-all;margin:4px 0 0;padding:6px;border-radius:8px;background:var(--cb-fill)}',
      '.cb-history{display:flex;flex-direction:column;gap:6px;flex:none;min-height:0}',
      '.cb-history-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;color:var(--cb-secondary)}',
      '.cb-history-tools{display:flex;gap:10px}',
      '.cb-history-empty{margin:0;font-size:11.5px;color:var(--cb-tertiary)}',
      '.cb-history-row{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:12px;border:none;background:var(--cb-card);cursor:pointer;text-align:left;color:inherit;box-shadow:0 1px 2px rgba(0,0,0,.04)}',
      '.cb-history-row:hover{background:var(--cb-fill)}',
      '.cb-leaderboard-link{display:flex;align-items:center;justify-content:center;gap:6px;padding:12px 14px;border-radius:12px;background:var(--cb-card);color:var(--cb-blue);font-size:13px;font-weight:600;text-decoration:none;border:.5px solid var(--cb-sep);flex:none}',
      '.cb-leaderboard-link:hover{background:var(--cb-fill)}',
      '.cb-history-rank{width:22px;flex:none;font-size:12px;font-weight:700;color:var(--cb-secondary);text-align:center}',
      '.cb-history-thumb{width:42px;height:42px;object-fit:cover;border-radius:10px;flex:none}',
      '.cb-history-meta{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}',
      '.cb-history-caption{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cb-history-sub{font-size:10.5px;color:var(--cb-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cb-history-score{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums}',
      '.cb-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;color:var(--cb-secondary);padding:30px}',
      '.cb-empty-glyph{display:inline-flex;color:var(--cb-blue);opacity:.9;padding:16px;border-radius:26px;background:var(--cb-fill)}',
      '.cb-empty-glyph-warn{color:var(--cb-orange)}',
      '.cb-empty h2{font-size:22px;font-weight:700;margin:2px 0 0;color:var(--cb-label);letter-spacing:-.3px}',
      '.cb-empty p{margin:0;max-width:420px;font-size:13px}',
      '.cb-steps{margin:4px 0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:5px;font-size:13px}',
      '.cb-steps li::before{content:"› ";color:var(--cb-blue);font-weight:700}',
      '.cb-tip{font-size:11.5px!important;color:var(--cb-tertiary)!important}',
      '.cb-loading{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--cb-secondary);text-align:center;padding:30px}',
      '.cb-loading strong{font-size:17px;font-weight:600;color:var(--cb-label)}',
      '.cb-loading span{font-size:12.5px;max-width:360px}',
      '.cb-loading-cat{color:var(--cb-blue);animation:cb-pulse 1.4s ease-in-out infinite}',
      '@keyframes cb-pulse{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.12);opacity:1}}',
      '.cb-result{display:flex;flex-direction:column;gap:16px;max-width:1080px;margin:0 auto}',
      '.cb-result-top{display:flex;gap:18px;align-items:stretch;padding:20px;border-radius:18px;background:var(--cb-card);border:none;box-shadow:0 8px 28px rgba(0,0,0,.08)}',
      '.cb-kicker{font-size:10px;letter-spacing:2.5px;color:var(--cb-secondary);text-transform:uppercase}',
      '.cb-meta-row{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:10.5px;color:var(--cb-tertiary);padding:0 6px}',
      '.cb-result-photo{width:150px;height:150px;flex:none;border-radius:16px;overflow:hidden;background:var(--cb-fill)}',
      '.cb-result-photo img{width:100%;height:100%;object-fit:cover;display:block}',
      '.cb-result-photo-fallback{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--cb-tertiary)}',
      '.cb-result-summary{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px;justify-content:center}',
      '.cb-caption{font-size:27px;font-weight:800;letter-spacing:-.5px;line-height:1.2}',
      '.cb-caption-row{display:flex;align-items:center;gap:8px}',
      '.cb-name-btn{border:none;background:var(--cb-fill);color:var(--cb-secondary);border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:13px;flex:none;line-height:1}',
      '.cb-name-edit{display:flex;gap:8px;align-items:center}',
      '.cb-name-input{flex:1;min-width:0;box-sizing:border-box;padding:8px 10px;border-radius:10px;border:none;background:var(--cb-fill);color:var(--cb-label);font-size:18px;font-weight:700;outline:none}',
      '.cb-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px}',
      '.cb-chip{font-size:11px;padding:2px 9px;border-radius:999px;background:var(--cb-fill);color:var(--cb-secondary)}',
      '.cb-chip-ghost{background:transparent;border:.5px solid var(--cb-sep)}',
      '.cb-grade{font-size:11.5px;font-weight:700;padding:2px 10px;border-radius:999px;border:1px solid}',
      '.cb-grade-note{margin:0;font-size:12px;color:var(--cb-secondary)}',
      '.cb-grade-info{margin:0;font-size:11.5px;color:var(--cb-secondary);background:var(--cb-fill);padding:6px 10px;border-radius:10px}',
      '.cb-rank-badge{font-size:11px;padding:2px 9px;border-radius:999px;background:rgba(255,149,0,.12);color:#c77700;border:.5px solid rgba(255,149,0,.3)}',
      '.cb-match{display:flex;align-items:center;gap:8px;margin-top:2px}',
      '.cb-match>span{font-size:11.5px;color:var(--cb-secondary);flex:none;width:66px}',
      '.cb-match>strong{font-size:13px;font-variant-numeric:tabular-nums;flex:none;width:28px;text-align:right}',
      '.cb-match .cb-bar{flex:1}',
      '.cb-match-note{margin:0;font-size:11.5px;color:var(--cb-secondary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.cb-ring{position:relative;flex:none;display:flex;align-items:center;justify-content:center}',
      '.cb-ring-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}',
      '.cb-ring-label strong{font-size:40px;line-height:1;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-1px}',
      '.cb-ring-label span{font-size:11px;color:var(--cb-secondary);letter-spacing:1px}',
      '.cb-result-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:14px}',
      '.cb-card{padding:16px;border-radius:16px;border:none;background:var(--cb-card);box-shadow:0 1px 3px rgba(0,0,0,.05)}',
      '.cb-card h3{margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:var(--cb-secondary)}',
      '.cb-sec-no{display:inline-block;margin-right:8px;font-size:10px;letter-spacing:1px;color:var(--cb-blue);font-weight:800}',
      '.cb-card-judge{grid-column:1 / -1}',
      '.cb-card-radar{display:flex;flex-direction:column}',
      '.cb-radar{width:100%;height:auto;max-height:330px}',
      '.cb-radar-label{font-size:10.5px;fill:var(--cb-secondary)}',
      '.cb-radar-label-active{fill:var(--cb-orange);font-weight:700}',
      '.cb-radar-tip{margin:4px 0 0;font-size:10.5px;color:var(--cb-tertiary);text-align:center}',
      '.cb-dims{display:flex;flex-direction:column;gap:4px}',
      '.cb-dim{cursor:pointer;border-radius:12px;padding:8px 10px;margin:0 -10px;transition:background .15s}',
      '.cb-dim:hover,.cb-dim-hover{background:var(--cb-fill)}',
      '.cb-dim-open{background:var(--cb-fill)}',
      '.cb-dim-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}',
      '.cb-dim-label{font-size:13px;font-weight:600}',
      '.cb-dim-score{font-size:11px;color:var(--cb-secondary)}',
      '.cb-dim-score strong{font-size:14px;font-variant-numeric:tabular-nums;font-weight:800}',
      '.cb-dim-score em{font-style:normal;font-size:10px;opacity:.75}',
      '.cb-dim-comment{margin:0;font-size:11.5px;color:var(--cb-secondary)}',
      '.cb-dim-detail{margin-top:8px;padding:10px 12px;border-radius:12px;background:var(--cb-bg);font-size:12px;color:var(--cb-secondary);display:flex;flex-direction:column;gap:3px}',
      '.cb-dim-detail p{margin:0}',
      '.cb-dim-math{font-weight:600;color:var(--cb-label)}',
      '.cb-sum{margin:10px 0 0;font-size:11px;color:var(--cb-tertiary);text-align:right}',
      '.cb-bar{height:6px;border-radius:3px;background:var(--cb-fill);overflow:hidden}',
      '.cb-bar span{display:block;height:100%;border-radius:3px;transition:width .5s ease}',
      '.cb-list{margin:0 0 2px;padding:0 0 0 18px;display:flex;flex-direction:column;gap:3px;font-size:13px}',
      '.cb-list-good li::marker{color:var(--cb-green)}',
      '.cb-list-warn li::marker{color:var(--cb-orange)}',
      '.cb-list-gap{margin-top:14px!important}',
      '.cb-judge{margin:0;font-size:14px;line-height:1.8;text-align:justify}',
      '.cb-sign{display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:10px;border-top:.5px dashed var(--cb-sep);font-size:11px;color:var(--cb-secondary)}',
      '.cb-result-foot{display:flex;flex-wrap:wrap;gap:8px;padding-bottom:8px}',
      '.cb-price{display:flex;flex-direction:column;gap:6px}',
      '.cb-price p{margin:0}',
      '.cb-price-value{font-size:28px;font-weight:800;letter-spacing:-.5px}',
      '.cb-price-note{font-size:10.5px;color:var(--cb-tertiary)}',
      '.cb-publish{display:flex;flex-direction:column;gap:8px}',
      '.cb-publish-label{font-size:11px;font-weight:600;color:var(--cb-secondary)}',
      '.cb-publish-input{box-sizing:border-box;width:100%;padding:10px 12px;border-radius:10px;border:none;background:var(--cb-fill);color:var(--cb-label);font-size:14px;outline:none}',
      '.cb-publish-input:focus{box-shadow:0 0 0 3px rgba(0,122,255,.25)}',
      '.cb-publish-preview{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--cb-secondary)}',
      '.cb-publish-preview img{width:48px;height:48px;border-radius:10px;object-fit:cover}',
      '.cb-publish-actions{display:flex;gap:8px}',
      '.cb-publish-note{margin:0;font-size:10.5px;color:var(--cb-tertiary)}',
      '.cb-share-panel{display:flex;flex-direction:column;gap:10px}',
      '.cb-share-tabs{display:flex;gap:2px;padding:2px;border-radius:10px;background:var(--cb-fill)}',
      '.cb-tab{flex:1;border:0;background:transparent;color:var(--cb-label);border-radius:8px;padding:7px 0;font-size:12px;font-weight:600;cursor:pointer}',
      '.cb-tab-active{background:var(--cb-card);box-shadow:0 1px 3px rgba(0,0,0,.12)}',
      '.cb-share-text{width:100%;box-sizing:border-box;min-height:140px;resize:vertical;border:none;border-radius:12px;background:var(--cb-fill);color:inherit;padding:12px;font-size:12.5px;line-height:1.75;font-family:inherit}',
      '.cb-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 18px;border-top:.5px solid var(--cb-sep);font-size:10.5px;color:var(--cb-tertiary);flex:none}',
      '@media (max-width:900px){.cb-body{flex-direction:column}.cb-left{width:auto;border-right:none;border-bottom:.5px solid var(--cb-sep);max-height:46%}.cb-result-grid{grid-template-columns:minmax(0,1fr)}.cb-result-top{flex-wrap:wrap}.cb-result-photo{width:110px;height:110px}.cb-ring{margin-left:auto}}',
    ].join('\n')

    /** @param {object} ctx - the client context. */
    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 25,
                label: '喵星大道',
              },
              function CatPanelGlyph(props) {
                return h(CatIcon, { size: props && props.size ? props.size : 18 })
              },
            ),
          ),
        'dsh-cat-beauty: sidebar entry',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('main', () =>
            ctx.slots.register(
              { name: 'main', key: PANEL_ID },
              CatPage,
            ),
          ),
        'dsh-cat-beauty: main panel',
      )
    }

    module.exports = { inject: ['slots', 'layout'], apply: apply }
    return module.exports
  },
})
