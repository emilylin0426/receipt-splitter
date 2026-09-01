# 收據記帳 / 分帳系統

純靜態網頁，不需要任何後端或 API key。日文收據辨識靠人工把照片貼給 Claude 對話，
請它輸出固定格式的 JSON，再貼進網站或直接寫進資料檔。

## 專案結構

```
receipt-splitter/
├── index.html          網站主頁（查詢 / 新增紀錄 / 分帳結算 三個頁籤）
├── css/style.css        樣式
├── js/split.js           分帳計算邏輯（純函式，可獨立測試）
├── js/app.js             主程式：讀資料、篩選、圖表、新增流程
└── data/expenses.json    資料檔（範例資料，之後由你手動更新）
```

## 本機測試

因為有用 `fetch()` 讀取 `data/expenses.json`，用瀏覽器直接打開 `index.html`
在部分瀏覽器會因為 CORS 擋掉本機檔案讀取，建議用簡單的本機伺服器跑：

```bash
cd receipt-splitter
python3 -m http.server 8000
# 打開 http://localhost:8000
```

## 部署到 GitHub Pages

1. 建立一個新的 GitHub repo，把這個資料夾內容全部 push 上去
2. 到 repo 的 **Settings → Pages**，Source 選擇 `Deploy from a branch`，
   branch 選 `main`、資料夾選 `/ (root)`
3. 等一兩分鐘，網址通常會是 `https://<你的帳號>.github.io/<repo名稱>/`

之後每次資料更新，只要 commit + push，網站會自動重新部署。

## 日常使用流程

1. **拍照**：把收據拍清楚，避免反光、歪斜
2. **請 AI 辨識**：把照片貼給 Claude，附上下面的固定 prompt
3. **預覽**：把 AI 回傳的 JSON 貼到網站「新增紀錄」頁籤，按「預覽這筆紀錄」確認內容正確
4. **暫存**：按「加入清單（本機）」，這筆資料會先存在你瀏覽器的 localStorage，
   其他人還看不到，但你自己可以立刻在「查詢」「分帳結算」頁籤看到效果
5. **正式寫入**：確認一批資料都沒問題後，按「匯出完整資料檔」下載新的
   `expenses.json`，用它取代 repo 裡的 `data/expenses.json`，
   `git add / git commit / git push`，這樣其他人打開網站才會看到

> 本機暫存（localStorage）只存在你自己的瀏覽器裡，換裝置或清瀏覽器資料就會不見，
> 記得養成「累積幾筆就匯出一次」的習慣。

## 請 AI 辨識收據時使用的固定 prompt

把下面這段連同收據照片一起貼給 Claude，就能得到可以直接貼進網站的 JSON：

```
請幫我辨識這張日文收據，並「只」回傳一個 JSON 物件，不要有其他文字或說明，格式如下：

{
  "date": "YYYY-MM-DD",
  "store": "店家名稱（可翻成中文或保留日文）",
  "payer": "先幫我留白，我會自己填",
  "currency": "JPY",
  "items": [
    { "name": "品項名稱", "price": 數字（不含逗號、不含日圓符號）, "sharedBy": [] }
  ]
}

規則：
- items 裡每一項的 price 加總要等於收據上的總金額，如果有折扣或稅務調整，
  請合理分攤或另外列一項處理
- sharedBy 先留空陣列，我自己填是哪些人要分攤這筆
- 日期如果收據上是日本年號（例如令和），請幫我換算成西元年
```

拿到 JSON 後，記得手動補上 `payer`（誰付的錢）和每個 item 的 `sharedBy`
（哪些人要分攤這個品項，留空代表全員均分），再貼進網站。

## 資料格式說明

```json
{
  "people": ["小明", "小華", "小美"],
  "records": [
    {
      "id": "2026-08-29-001",
      "date": "2026-08-29",
      "store": "唐吉訶德 新宿店",
      "payer": "小明",
      "currency": "JPY",
      "items": [
        { "name": "抹茶餅乾", "price": 680, "sharedBy": ["小明", "小華"] }
      ]
    }
  ]
}
```

- `payer`：這筆消費實際付錢的人
- `sharedBy`：這個品項由誰均分，留空或省略代表由 `people` 全員均分
- `id` 沒填的話，網站會自動用日期加隨機碼產生一個
- `note`（選填）：品項的中文註解。可直接寫進 JSON，或在「查詢」頁點該品項的品名，
  就地打字、點別處即收起。留白就不顯示。編輯後會先存在瀏覽器，記得「匯出完整資料檔」
  再 push，其他人才看得到

## 分帳邏輯

- 每人「應付」= 他在每個品項 `sharedBy` 裡分攤到的金額加總
- 每人「已付」= 他當 `payer` 時，那幾筆消費的總金額加總
- 淨額 = 已付 − 應付（正的代表別人欠他，負的代表他欠別人）
- 「分帳結算」頁籤會用債務簡化演算法，算出最少轉帳次數的還款方式

## 之後可以擴充的方向

- 把「匯出並取代 data/expenses.json」這一步改成透過 GitHub Actions
  或 GitHub API 自動 commit（需要額外設定 token，注意不要外洩在前端）
- 加上「編輯 / 刪除已存在紀錄」的功能
- 加上依店家分類、依月份統計的圖表
