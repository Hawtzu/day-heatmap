// DayHeatmap v6 — 2026-04-08
// 一日の評価(1〜4)をヒートマップで表示
// 左:月カレンダー + 右:年ミニカレンダー 統合表示
// Scriptable (iOS) Medium ウィジェット用

// ── 設定 ──
const DATA_FILE = "day_heatmap.json"
const CONFIG_FILE = "day_heatmap_config.json"

// config.jsonからNotion設定を読み込み
function loadConfig() {
  const fm = FileManager.iCloud()
  const path = fm.joinPath(fm.documentsDirectory(), CONFIG_FILE)
  if (!fm.fileExists(path)) return null
  fm.downloadFileFromiCloud(path)
  return JSON.parse(fm.readString(path))
}

const CONFIG = loadConfig()

const COLORS = {
  bg: "#0d1117",
  empty: "#161b22",
  level1: "#0e4429",
  level2: "#006d32",
  level3: "#26a641",
  level4: "#39d353",
  text: "#8b949e",
  textBright: "#c9d1d9",
  today: "#58a6ff",
}

const WIDGET_PADDING = 20

function getColor(score) {
  if (!score || score === 0) return COLORS.empty
  return {1: COLORS.level1, 2: COLORS.level2, 3: COLORS.level3, 4: COLORS.level4}[score] || COLORS.empty
}

// ── ローカルキャッシュ読み書き ──
function loadCache() {
  const fm = FileManager.iCloud()
  const path = fm.joinPath(fm.documentsDirectory(), DATA_FILE)
  if (!fm.fileExists(path)) return {}
  fm.downloadFileFromiCloud(path)
  return JSON.parse(fm.readString(path))
}

function saveCache(data) {
  const fm = FileManager.iCloud()
  const path = fm.joinPath(fm.documentsDirectory(), DATA_FILE)
  fm.writeString(path, JSON.stringify(data, null, 2))
}

// ── Notion API ──
async function notionRequest(endpoint, method, body) {
  if (!CONFIG) return null
  const req = new Request(`https://api.notion.com/v1/${endpoint}`)
  req.method = method
  req.headers = {
    "Authorization": `Bearer ${CONFIG.NOTION_TOKEN}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  }
  if (body) req.body = JSON.stringify(body)
  try {
    return await req.loadJSON()
  } catch (e) {
    console.error(`Notion API error: ${e}`)
    return null
  }
}

// Notionから全スコアを取得
async function loadFromNotion() {
  if (!CONFIG) return null
  const result = await notionRequest(
    `databases/${CONFIG.DIARY_DB_ID}/query`,
    "POST",
    { page_size: 100 }
  )
  if (!result || !result.results) return null

  const data = {}
  for (const page of result.results) {
    const props = page.properties
    // タイトル（日付文字列）を取得
    const titleArr = props["名前"]?.title
    if (!titleArr || titleArr.length === 0) continue
    const dateKey = titleArr[0].plain_text

    // スコアを取得
    const scoreSelect = props["スコア"]?.select
    if (scoreSelect) {
      data[dateKey] = parseInt(scoreSelect.name, 10)
    }
  }
  return data
}

// Notionで今日のページを検索
async function findTodayPage(today) {
  if (!CONFIG) return null
  const result = await notionRequest(
    `databases/${CONFIG.DIARY_DB_ID}/query`,
    "POST",
    {
      filter: {
        property: "名前",
        title: { equals: today }
      }
    }
  )
  if (result && result.results && result.results.length > 0) {
    return result.results[0].id
  }
  return null
}

// Notionにスコアを保存（ページ作成 or 更新）
async function saveToNotion(today, score) {
  if (!CONFIG) return false

  const existingId = await findTodayPage(today)

  if (existingId) {
    // 既存ページを更新
    await notionRequest(`pages/${existingId}`, "PATCH", {
      properties: {
        "スコア": { select: { name: String(score) } }
      }
    })
  } else {
    // 新規ページ作成
    await notionRequest("pages", "POST", {
      parent: { database_id: CONFIG.DIARY_DB_ID },
      properties: {
        "名前": { title: [{ text: { content: today } }] },
        "スコア": { select: { name: String(score) } },
        "日付": { date: { start: today } }
      }
    })
  }
  return true
}

// ── データ読み込み（Notion優先、フォールバックでキャッシュ）──
async function loadData() {
  // Notion から取得を試みる
  const notionData = await loadFromNotion()
  if (notionData) {
    // キャッシュを更新
    saveCache(notionData)
    return notionData
  }
  // フォールバック: ローカルキャッシュ
  return loadCache()
}

// ── データ保存（Notion + ローカルキャッシュ）──
async function saveData(today, score) {
  // Notion に保存
  await saveToNotion(today, score)

  // ローカルキャッシュも更新
  const cache = loadCache()
  cache[today] = score
  saveCache(cache)
}

// ── 日付ユーティリティ ──
function fmt(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function todayStr() { return fmt(new Date()) }

function startDow(year, month) {
  return new Date(year, month, 1).getDay()
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

// ── アプリ起動時：スコア入力 ──
async function promptScore() {
  const today = todayStr()
  const cache = loadCache()
  const existing = cache[today]

  const alert = new Alert()
  alert.title = "今日の評価"
  alert.message = existing
    ? `今日(${today})は${existing}点です。変更しますか？`
    : `今日(${today})を評価してください`

  alert.addAction("1 - ダメだった")
  alert.addAction("2 - いまいち")
  alert.addAction("3 - まあまあ")
  alert.addAction("4 - よかった")
  alert.addCancelAction("キャンセル")

  const choice = await alert.presentAlert()
  if (choice === -1) return

  const score = choice + 1
  await saveData(today, score)

  const done = new Alert()
  done.title = CONFIG ? "Notionに記録しました" : "ローカルに記録しました"
  done.message = `${today}: ${score}点`
  done.addAction("OK")
  await done.presentAlert()
}

// ══════════════════════════════
//  統合ビュー（左:月 + 右:年）
// ══════════════════════════════
function drawWidget(data) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const todayKey = todayStr()

  const canvasW = 540
  const canvasH = 260
  const pad = WIDGET_PADDING
  const headerH = 24
  const dowLabelH = 14
  const dividerX = 290 // 左右の分割位置

  const ctx = new DrawContext()
  ctx.size = new Size(canvasW, canvasH)
  ctx.opaque = false
  ctx.respectScreenScale = true

  // 背景
  ctx.setFillColor(new Color(COLORS.bg))
  ctx.fillRect(new Rect(0, 0, canvasW, canvasH))

  // ────────────────────────
  //  左半分: 月カレンダー
  // ────────────────────────
  const days = daysInMonth(year, month)
  const firstDow = startDow(year, month)
  const totalWeeks = Math.ceil((days + firstDow) / 7)

  const monthGridW = dividerX - pad - 8
  const mGap = 3
  const mCellH = Math.floor((canvasH - pad * 2 - headerH - dowLabelH - (totalWeeks - 1) * mGap) / totalWeeks)
  const mCellW = Math.floor((monthGridW - 6 * mGap) / 7)
  const mCell = Math.min(mCellW, mCellH)
  const mStepX = mCell + mGap
  const mStepY = mCell + mGap

  // ヘッダー
  const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"]
  ctx.setFont(Font.boldSystemFont(14))
  ctx.setTextColor(new Color(COLORS.textBright))
  ctx.drawTextInRect(`${year}年 ${monthNames[month]}`, new Rect(pad, pad, monthGridW, headerH))

  // 曜日ラベル
  const dowLabels = ["日","月","火","水","木","金","土"]
  ctx.setFont(Font.systemFont(9))
  ctx.setTextColor(new Color(COLORS.text))
  const mGridStartY = pad + headerH + dowLabelH
  for (let c = 0; c < 7; c++) {
    const x = pad + c * mStepX + mCell / 2 - 5
    ctx.drawTextInRect(dowLabels[c], new Rect(x, pad + headerH, 14, dowLabelH))
  }

  // 日付セル
  for (let day = 1; day <= days; day++) {
    const idx = firstDow + day - 1
    const col = idx % 7
    const row = Math.floor(idx / 7)
    const x = pad + col * mStepX
    const y = mGridStartY + row * mStepY
    const key = fmt(new Date(year, month, day))
    const score = data[key] || 0

    ctx.setFillColor(new Color(getColor(score)))
    ctx.fillRect(new Rect(x, y, mCell, mCell))

    ctx.setFont(Font.systemFont(9))
    ctx.setTextColor(new Color(score >= 3 ? "#000000" : COLORS.text))
    ctx.drawTextInRect(String(day), new Rect(x + 1, y + 1, mCell - 2, 12))

    if (key === todayKey) {
      ctx.setStrokeColor(new Color(COLORS.today))
      ctx.setLineWidth(2)
      ctx.strokeRect(new Rect(x, y, mCell, mCell))
    }
  }

  // ────────────────────────
  //  右半分: 年ミニカレンダー
  // ────────────────────────
  const rightX = dividerX
  const rightW = canvasW - pad - rightX
  const rightH = canvasH - pad * 2

  const yCols = 3 // 3列
  const yRows = 4 // 4行
  const blockGap = 2 // 月ブロック間の隙間（最小限）

  // 各月ブロックのサイズ計算
  const blockW = Math.floor((rightW - (yCols - 1) * blockGap) / yCols)
  const blockH = Math.floor((rightH - (yRows - 1) * blockGap) / yRows)

  // ミニセルサイズ（7列 × 最大6行をブロック内に収める）
  const miniGap = 1
  const miniCell = Math.floor(Math.min((blockW - 6 * miniGap) / 7, (blockH - 5 * miniGap) / 6))
  const miniStep = miniCell + miniGap

  for (let m = 0; m < 12; m++) {
    const mc = m % yCols
    const mr = Math.floor(m / yCols)

    const bx = rightX + mc * (blockW + blockGap)
    const by = pad + mr * (blockH + blockGap)

    const mDays = daysInMonth(year, m)
    const mFirstDow = startDow(year, m)

    for (let day = 1; day <= mDays; day++) {
      const idx = mFirstDow + day - 1
      const col = idx % 7
      const row = Math.floor(idx / 7)

      const x = bx + col * miniStep
      const y = by + row * miniStep

      const key = fmt(new Date(year, m, day))
      const score = data[key] || 0

      if (new Date(year, m, day) > now) {
        ctx.setFillColor(new Color(COLORS.bg))
      } else {
        ctx.setFillColor(new Color(getColor(score)))
      }
      ctx.fillRect(new Rect(x, y, miniCell, miniCell))

      if (key === todayKey) {
        ctx.setStrokeColor(new Color(COLORS.today))
        ctx.setLineWidth(1)
        ctx.strokeRect(new Rect(x, y, miniCell, miniCell))
      }
    }
  }

  return ctx.getImage()
}

// ── メイン ──
if (config.runsInWidget) {
  const data = loadCache()
  const widget = new ListWidget()
  widget.backgroundImage = drawWidget(data)
  widget.setPadding(0, 0, 0, 0)
  Script.setWidget(widget)
} else {
  await promptScore()
  const data = await loadData()
  const w = new ListWidget()
  w.backgroundImage = drawWidget(data)
  w.setPadding(0, 0, 0, 0)
  await w.presentMedium()
}

Script.complete()
