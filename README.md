# 喵星大道 · dsh-cat-star

给猫的颜值打分——一个 DSH Web GUI 插件。上传猫片或视频（品种可以留空），AI 自动识别品种，按 **CFA 品种标准**逐项评分，输出总分、等级、雷达图、逐项点评、**国内市场参考价**和分享卡片，可选发布到公开榜单。

> 娱乐向评分：评分点结构参考 CFA（Cat Fanciers' Association）品种标准的 Point Score，点评与估价由 AI 生成，不是 CFA 官方评审，也不构成交易建议。

## 功能

- **侧边栏「喵星大道」入口**：点开即用，不占用会话。
- **图片 / 视频都能评**：1–4 张多角度照片，或一段视频自动抽 4 帧；原视频不上传。
- **品种可选**：不选品种直接评分，AI 自动识别概率最高的品种；手动选则跳过识别。
- **CFA 评分报告**：34 个 CFA 品种，评分点与权重来自 CFA 官网 Point Score；加权总分、等级、能力雷达、逐项点评、亮点/扣分、下次拍摄建议。
- **国内市场参考价**：结合品种行情区间（宠物级）与品相评分估算人民币区间，随评分一起生成。
- **名字可编辑**：左侧输入框预填（可选，默认用裁判标题），结果页标题旁 ✎ 可随时改；分享图、分享文案、发布榜单同步使用。
- **分享传播**：1080×1440 分享图（含猫图、总分、雷达、参考价）+ 小红书/微博风格文案，一键复制。
- **发布到公开榜单（可选）**：点按钮先弹命名框确认，只上传 160px 缩略图 + 名字/品种/分数/评语，不传原图。
- **本地历史**：最近 10 次评分，支持按分数排行。
- **iOS 风格界面**：系统字体、分组卡片、Large Title、分段控件、深浅色自动适配。

## 安装

```sh
# 从 GitHub 安装（当前推荐，npm 包发布前）
dsh plugin --profile web add github:zengchunhua-boost/dsh-cat-star

# npm 发布后
dsh plugin --profile web add dsh-cat-star

# 本地开发（link 安装）
dsh plugin --profile web add link:/path/to/dsh-cat-star
```

安装后重启一次 `dsh web`（新增 Host 路由需要重启；之后只改 `client.js` 刷新页面即可）。

## 使用

1. 侧边栏点「喵星大道」。
2. 上传猫片或视频；名字可填可不填；品种留空会自动识别。
3. 点「开始评分」，等 5–40 秒。
4. 看分数和参考价；可以生成分享图、复制文案、保存历史，或发布到公开榜单。

## 公开榜单（可选）

配套服务在 `leaderboard/`（Cloudflare Worker + Netlify 反代）：

- 公开页（国内直连可达）：<https://dsh-cat-beauty-leaderboard.netlify.app>
- 数据后端：Cloudflare Worker + KV（`dsh-cat-beauty-leaderboard.vrchunsir-catbeauty.workers.dev`）
- 部署方式见 `leaderboard/README.md`

插件默认发布到上述实例。想用自己的榜单：部署 Worker 后，把 `client.js` 顶部 `LEADERBOARD_URL` 改掉，并设置 Host 环境变量 `DSH_CAT_LEADERBOARD_URL` 指向你的 Netlify 入口。

## 配置

| 项 | 位置 | 默认 |
| --- | --- | --- |
| 裁判模型 | 环境变量 `DSH_CAT_JUDGE_PROVIDER` / `DSH_CAT_JUDGE_MODEL` | `deepseek-official` / `deepseek-flash`（需图像能力） |
| 榜单入口 | `client.js` 的 `LEADERBOARD_URL` | 内置公开实例 |
| 榜单转发目标 | Host 环境变量 `DSH_CAT_LEADERBOARD_URL` | 内置 Netlify 入口 |

## 开发

```sh
node test/cat-star.test.mjs        # 插件测试（22 项）
node leaderboard/test/worker.test.mjs  # 榜单 Worker 测试（6 项）
```

## 已知边界

- **评分是 AI 主观判断**：同一只猫换角度/光线/品种选择，分数会变；不要拿它当购猫或繁育依据。
- **参考价是区间估价**：受血统、证书、地区、年龄影响；仅供娱乐参考，不构成交易建议。
- **模型偶尔输出格式漂移的 JSON**：Host 端做了截断修复、尾随逗号处理、自动重试；仍失败时错误卡片可展开「查看模型原始输出」。
- **视频只支持浏览器能解码的容器/编码**（MP4/H.264 最稳，WebM 次之），单个 ≤50MB。
- 上传的图片会经 `ctx.attachments` 存进本机附件存储（DSH 不做自动清理），敏感照片不要上传；视频本身不离开浏览器。
- 榜单 KV 有 ~60 秒最终一致性延迟，发布后榜单页最多 1 分钟可见。
- 非 CFA 官方产品，与 CFA 无关联。

## 数据来源

`src/breeds.js` 中各品种的评分点与满分，转录自 CFA 官网品种页的 "Point Score" 表（`https://cfa.org/breed/<slug>/`，2026-11-04 抓取）；`priceHint` 为国内宠物市场常见行情估算区间。`hint` 为对标准描述的中文压缩，不是原文。

## 发布前检查（维护者）

- [ ] `package.json` 补 `repository` / `author`（发布到 GitHub 前）
- [ ] `npm pack --dry-run` 确认只带必要文件
- [ ] 用打出的 tgz 在干净 profile 安装验证一次
- [ ] 到 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 开 PR 收录到插件市场
