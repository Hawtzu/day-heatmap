// DayHeatmap v5 — 2026-04-08
// 一日の評価(1〜4)をヒートマップで表示
// Notion日記DBと連携
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
//  月ビュー（当月カレンダー）
// ══════════════════════════════
function drawMonthView(data) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const todayKey = todayStr()

  const days = daysInMonth(year, month)
  const firstDow = startDow(year, month)
  const totalWeeks = Math.ceil((days + firstDow) / 7)

  const pad = WIDGET_PADDING
  const headerH = 28
  const dowLabelH = 16

  const canvasW = 540
  const canvasH = 260
  const gap = 3
  const gridH = canvasH - pad * 2 - headerH - dowLabelH
  const cellSize = Math.floor((gridH - (totalWeeks - 1) * gap) / totalWeeks)
  const step = cellSize + gap

  const ctx = new DrawContext()
  ctx.size = new Size(canvasW, canvasH)
  ctx.opaque = false
  ctx.respectScreenScale = true

  ctx.setFillColor(new Color(COLORS.bg))
  ctx.fillRect(new Rect(0, 0, canvasW, canvasH))

  const gridW = canvasW - pad * 2
  const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"]
  ctx.setFont(Font.boldSystemFont(15))
  ctx.setTextColor(new Color(COLORS.textBright))
  ctx.drawTextInRect(`${year}年 ${monthNames[month]}`, new Rect(pad, pad, gridW, headerH))

  const dowLabels = ["日","月","火","水","木","金","土"]
  ctx.setFont(Font.systemFont(11))
  ctx.setTextColor(new Color(COLORS.text))
  const gridStartY = pad + headerH + dowLabelH
  for (let c = 0; c < 7; c++) {
    const x = pad + c * step + cellSize / 2 - 6
    ctx.drawTextInRect(dowLabels[c], new Rect(x, pad + headerH, 16, dowLabelH))
  }

  for (let day = 1; day <= days; day++) {
    const idx = firstDow + day - 1
    const col = idx % 7
    const row = Math.floor(idx / 7)

    const x = pad + col * step
    const y = gridStartY + row * step

    const key = fmt(new Date(year, month, day))
    const score = data[key] || 0

    ctx.setFillColor(new Color(getColor(score)))
    ctx.fillRect(new Rect(x, y, cellSize, cellSize))

    ctx.setFont(Font.systemFont(10))
    ctx.setTextColor(new Color(score >= 3 ? "#000000" : COLORS.text))
    ctx.drawTextInRect(String(day), new Rect(x + 2, y + 2, cellSize - 4, 14))

    if (key === todayKey) {
      ctx.setStrokeColor(new Color(COLORS.today))
      ctx.setLineWidth(2)
      ctx.strokeRect(new Rect(x, y, cellSize, cellSize))
    }
  }

  return ctx.getImage()
}

// ══════════════════════════════
//  年ビュー（12ヶ月一覧）
// ══════════════════════════════
function drawYearView(data) {
  const now = new Date()
  const year = now.getFullYear()
  const todayKey = todayStr()

  const pad = WIDGET_PADDING
  const headerH = 28
  const monthCols = 4
  const monthRows = 3

  const canvasW = 540
  const canvasH = 260

  const gridAreaW = canvasW - pad * 2
  const gridAreaH = canvasH - pad * 2 - headerH
  const monthW = Math.floor(gridAreaW / monthCols)
  const monthH = Math.floor(gridAreaH / monthRows)

  const miniCellSize = Math.floor(Math.min((monthW - 8) / 7, (monthH - 18) / 6))
  const miniGap = 1
  const miniStep = miniCellSize + miniGap

  const ctx = new DrawContext()
  ctx.size = new Size(canvasW, canvasH)
  ctx.opaque = false
  ctx.respectScreenScale = true

  ctx.setFillColor(new Color(COLORS.bg))
  ctx.fillRect(new Rect(0, 0, canvasW, canvasH))

  ctx.setFont(Font.boldSystemFont(15))
  ctx.setTextColor(new Color(COLORS.textBright))
  ctx.drawTextInRect(`${year}年`, new Rect(pad, pad, gridAreaW, headerH))

  const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"]

  for (let m = 0; m < 12; m++) {
    const mc = m % monthCols
    const mr = Math.floor(m / monthCols)

    const mx = pad + mc * monthW
    const my = pad + headerH + mr * monthH

    ctx.setFont(Font.boldSystemFont(9))
    ctx.setTextColor(new Color(COLORS.text))
    ctx.drawTextInRect(monthNames[m], new Rect(mx + 2, my, monthW, 14))

    const days = daysInMonth(year, m)
    const firstDow = startDow(year, m)
    const miniStartY = my + 15

    for (let day = 1; day <= days; day++) {
      const idx = firstDow + day - 1
      const col = idx % 7
      const row = Math.floor(idx / 7)

      const x = mx + col * miniStep + 2
      const y = miniStartY + row * miniStep

      const key = fmt(new Date(year, m, day))
      const score = data[key] || 0

      if (new Date(year, m, day) > now) {
        ctx.setFillColor(new Color(COLORS.bg))
      } else {
        ctx.setFillColor(new Color(getColor(score)))
      }
      ctx.fillRect(new Rect(x, y, miniCellSize, miniCellSize))

      if (key === todayKey) {
        ctx.setStrokeColor(new Color(COLORS.today))
        ctx.setLineWidth(1.5)
        ctx.strokeRect(new Rect(x, y, miniCellSize, miniCellSize))
      }
    }
  }

  return ctx.getImage()
}

// ── どちらのビューを表示するか ──
function chooseView() {
  const sec = Math.floor(Date.now() / 15000)
  return sec % 2 === 0 ? "month" : "year"
}

// ── メイン ──
if (config.runsInWidget) {
  // ウィジェット: キャッシュから高速表示
  const data = loadCache()
  const widget = new ListWidget()
  const view = chooseView()
  widget.backgroundImage = view === "month"
    ? drawMonthView(data)
    : drawYearView(data)
  widget.setPadding(0, 0, 0, 0)
  Script.setWidget(widget)
} else {
  // アプリ内: スコア入力 → Notion保存
  await promptScore()
  const data = await loadData()

  const w1 = new ListWidget()
  w1.backgroundImage = drawMonthView(data)
  w1.setPadding(0, 0, 0, 0)
  await w1.presentMedium()

  const w2 = new ListWidget()
  w2.backgroundImage = drawYearView(data)
  w2.setPadding(0, 0, 0, 0)
  await w2.presentMedium()
}

Script.complete()
