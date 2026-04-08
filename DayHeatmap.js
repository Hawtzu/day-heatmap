// DayHeatmap v3 — 2026-04-08
// 一日の評価(1〜5)をヒートマップで表示
// 月ビューと年ビューを交互に表示
// Scriptable (iOS) Medium ウィジェット用

// ── 設定 ──
const DATA_FILE = "day_heatmap.json"

const COLORS = {
  bg: "#0d1117",
  empty: "#161b22",
  level1: "#0e4429",
  level2: "#006d32",
  level3: "#26a641",
  level4: "#39d353",
  level5: "#ffd700",
  text: "#8b949e",
  textBright: "#c9d1d9",
  today: "#58a6ff",
}

const WIDGET_PADDING = 20 // ウィジェット角丸対策

function getColor(score) {
  if (!score || score === 0) return COLORS.empty
  return {1: COLORS.level1, 2: COLORS.level2, 3: COLORS.level3, 4: COLORS.level4, 5: COLORS.level5}[score] || COLORS.empty
}

// ── データ読み書き ──
function loadData() {
  const fm = FileManager.iCloud()
  const path = fm.joinPath(fm.documentsDirectory(), DATA_FILE)
  if (!fm.fileExists(path)) return {}
  fm.downloadFileFromiCloud(path)
  return JSON.parse(fm.readString(path))
}

function saveData(data) {
  const fm = FileManager.iCloud()
  const path = fm.joinPath(fm.documentsDirectory(), DATA_FILE)
  fm.writeString(path, JSON.stringify(data, null, 2))
}

// ── 日付ユーティリティ ──
function fmt(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function todayStr() { return fmt(new Date()) }

// 月の1日の曜日（日=0, 月=1, ..., 土=6 ← Googleカレンダー式）
function startDow(year, month) {
  return new Date(year, month, 1).getDay()
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

// ── アプリ起動時：スコア入力 ──
async function promptScore() {
  const data = loadData()
  const today = todayStr()
  const existing = data[today]

  const alert = new Alert()
  alert.title = "今日の評価"
  alert.message = existing
    ? `今日(${today})は${existing}点です。変更しますか？`
    : `今日(${today})を評価してください`

  alert.addAction("1 - ダメだった")
  alert.addAction("2 - いまいち")
  alert.addAction("3 - ふつう")
  alert.addAction("4 - よかった")
  alert.addAction("5 - 最高！")
  alert.addCancelAction("キャンセル")

  const choice = await alert.presentAlert()
  if (choice === -1) return

  data[today] = choice + 1
  saveData(data)

  const done = new Alert()
  done.title = "記録しました"
  done.message = `${today}: ${choice + 1}点`
  done.addAction("OK")
  await done.presentAlert()
}

// ── ストリーク計算 ──
function calcStreak(data) {
  let streak = 0
  const d = new Date()
  while (data[fmt(d)] > 0) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
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

  // キャンバスをMediumウィジェットの縦横比（約2.1:1）に固定
  const canvasW = 540
  const canvasH = 260
  const gap = 3
  // セルサイズをキャンバス高さから逆算して収める
  const gridH = canvasH - pad * 2 - headerH - dowLabelH
  const cellSize = Math.floor((gridH - (totalWeeks - 1) * gap) / totalWeeks)
  const step = cellSize + gap

  const ctx = new DrawContext()
  ctx.size = new Size(canvasW, canvasH)
  ctx.opaque = false
  ctx.respectScreenScale = true

  // 背景
  ctx.setFillColor(new Color(COLORS.bg))
  ctx.fillRect(new Rect(0, 0, canvasW, canvasH))

  // ヘッダー: 年月
  const gridW = canvasW - pad * 2
  const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"]
  ctx.setFont(Font.boldSystemFont(15))
  ctx.setTextColor(new Color(COLORS.textBright))
  ctx.drawTextInRect(
    `${year}年 ${monthNames[month]}`,
    new Rect(pad, pad, gridW, headerH)
  )

  // ストリーク
  const streak = calcStreak(data)
  ctx.setFont(Font.systemFont(11))
  ctx.setTextColor(new Color(COLORS.text))
  ctx.drawTextInRect(
    `${streak}日連続`,
    new Rect(canvasW - pad - 70, pad + 4, 70, 18)
  )

  // 曜日ラベル
  const dowLabels = ["日","月","火","水","木","金","土"]
  ctx.setFont(Font.systemFont(11))
  ctx.setTextColor(new Color(COLORS.text))
  const gridStartY = pad + headerH + dowLabelH
  for (let c = 0; c < 7; c++) {
    const x = pad + c * step + cellSize / 2 - 6
    ctx.drawTextInRect(
      dowLabels[c],
      new Rect(x, pad + headerH, 16, dowLabelH)
    )
  }

  // カレンダーセル描画
  for (let day = 1; day <= days; day++) {
    const idx = firstDow + day - 1
    const col = idx % 7
    const row = Math.floor(idx / 7)

    const x = pad + col * step
    const y = gridStartY + row * step

    const key = fmt(new Date(year, month, day))
    const score = data[key] || 0
    const color = getColor(score)

    ctx.setFillColor(new Color(color))
    ctx.fillRect(new Rect(x, y, cellSize, cellSize))

    // 日付番号を表示
    ctx.setFont(Font.systemFont(10))
    ctx.setTextColor(new Color(score >= 3 ? "#000000" : COLORS.text))
    ctx.drawTextInRect(
      String(day),
      new Rect(x + 2, y + 2, cellSize - 4, 14)
    )

    // 今日のハイライト枠
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
  const canvasH = 340

  const gridAreaW = canvasW - pad * 2
  const gridAreaH = canvasH - pad * 2 - headerH
  const monthW = Math.floor(gridAreaW / monthCols)
  const monthH = Math.floor(gridAreaH / monthRows)

  // 各月のミニカレンダー: 7列 × 最大6行
  const miniCellSize = Math.floor(Math.min((monthW - 8) / 7, (monthH - 18) / 6))
  const miniGap = 1
  const miniStep = miniCellSize + miniGap

  const ctx = new DrawContext()
  ctx.size = new Size(canvasW, canvasH)
  ctx.opaque = false
  ctx.respectScreenScale = true

  // 背景
  ctx.setFillColor(new Color(COLORS.bg))
  ctx.fillRect(new Rect(0, 0, canvasW, canvasH))

  // ヘッダー: 年
  ctx.setFont(Font.boldSystemFont(16))
  ctx.setTextColor(new Color(COLORS.textBright))
  ctx.drawTextInRect(`${year}年`, new Rect(pad, pad, gridAreaW, headerH))

  // ストリーク
  const streak = calcStreak(data)
  ctx.setFont(Font.systemFont(12))
  ctx.setTextColor(new Color(COLORS.text))
  ctx.drawTextInRect(
    `${streak}日連続`,
    new Rect(canvasW - pad - 70, pad + 2, 70, 18)
  )

  const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"]

  for (let m = 0; m < 12; m++) {
    const mc = m % monthCols
    const mr = Math.floor(m / monthCols)

    const mx = pad + mc * monthW
    const my = pad + headerH + mr * monthH

    // 月名
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

      // 未来はスキップ
      if (new Date(year, m, day) > now) {
        ctx.setFillColor(new Color(COLORS.bg))
      } else {
        ctx.setFillColor(new Color(getColor(score)))
      }
      ctx.fillRect(new Rect(x, y, miniCellSize, miniCellSize))

      // 今日のハイライト
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
  // 15秒ごとに切り替え（ウィジェット更新タイミングで交互に見える）
  const sec = Math.floor(Date.now() / 15000)
  return sec % 2 === 0 ? "month" : "year"
}

// ── メイン ──
const data = loadData()

if (config.runsInWidget) {
  const widget = new ListWidget()
  const view = chooseView()
  widget.backgroundImage = view === "month"
    ? drawMonthView(data)
    : drawYearView(data)
  widget.setPadding(0, 0, 0, 0)
  Script.setWidget(widget)
} else {
  await promptScore()
  const updated = loadData()

  // プレビュー: 両方見せる
  const w1 = new ListWidget()
  w1.backgroundImage = drawMonthView(updated)
  w1.setPadding(0, 0, 0, 0)
  await w1.presentMedium()

  const w2 = new ListWidget()
  w2.backgroundImage = drawYearView(updated)
  w2.setPadding(0, 0, 0, 0)
  await w2.presentMedium()
}

Script.complete()
