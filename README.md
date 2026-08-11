# TravelSplit — 旅行分帳網站

多人旅行分帳/記帳工具。可建立多趟獨立行程，每趟行程各自管理成員、幣別匯率、分類、
逐筆記帳、分帳設定，並提供結算總覽（誰欠誰矩陣 + 最少轉帳次數的結算建議）。

視覺與版面規格依據 `../travel-split-app-design/design-spec.md` 與其 4 個 mockup 實作。

## 技術棧

- **前端**：Next.js 16（App Router）+ TypeScript + Tailwind CSS v4，位於 `frontend/`
- **後端**：Python + FastAPI + SQLite（`sqlite3` 檔案資料庫，透過 SQLAlchemy ORM），位於 `backend/`
- 前後端透過 REST API（JSON）串接，前端用 `fetch` 呼叫後端

## 預設埠號

| 服務 | 埠號 | URL |
|---|---|---|
| 後端 API（FastAPI/uvicorn） | 8000 | http://localhost:8000 |
| 前端（Next.js dev server） | 3000 | http://localhost:3000 |

前端透過 `frontend/.env.local` 的 `NEXT_PUBLIC_API_BASE_URL`（預設 `http://localhost:8000`）
呼叫後端；若要換埠號，兩邊設定都要同步調整。

## 安裝與啟動

### 1. 後端（FastAPI + SQLite）

需要 Python 3.11+（macOS 內建的系統 Python 版本較舊，此專案在開發時使用
`~/.local/bin/python3.11` 建立虛擬環境，請視你機器上實際可用的 3.11+ 直譯器調整路徑）。

```bash
cd backend
python3.11 -m venv .venv          # 建立虛擬環境（第一次執行才需要）
source .venv/bin/activate         # macOS/Linux；Windows 用 .venv\Scripts\activate
pip install -r requirements.txt

# 啟動 API server（含自動 reload，開發用）
uvicorn app.main:app --reload --port 8000
```

- SQLite 資料庫檔案 `backend/travel_split.db` 會在**第一次啟動時自動建立**（`app/main.py`
  啟動時呼叫 `Base.metadata.create_all`），不需要另外跑 migration 指令。
- 若要重置資料，直接刪除 `backend/travel_split.db`（連同 `-journal` 檔，如果有的話）再重啟
  即可，下次啟動會產生全新的空資料庫。
- 健康檢查：`curl http://localhost:8000/api/health` 應回傳 `{"status":"ok"}`。
- API 文件（FastAPI 自動產生）：啟動後開啟 http://localhost:8000/docs。

#### 跑後端單元測試

分帳金額四捨五入與結算演算法（誰欠誰矩陣 / 最少轉帳建議）都有對應的 pytest 測試，
驗證「分帳加總必須等於支出總額」「淨支付必須零和」「建議轉帳金額必須等於淨欠款」等
正確性規則：

```bash
cd backend
source .venv/bin/activate
python -m pytest app/tests -v
```

### 2. 前端（Next.js）

需要 Node.js 18.18+（開發時使用 Node v22）。

```bash
cd frontend
npm install
npm run dev      # 開發模式，預設 http://localhost:3000
# 或
npm run build && npm run start   # production build 後啟動
```

啟動前端前，請先確認後端已在 http://localhost:8000 跑起來（前端所有資料都來自後端 API，
沒有本地假資料）。

## 專案結構

```
travel-split-app/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app、CORS、路由掛載、啟動時建表
│   │   ├── database.py        # SQLite 連線設定（SQLAlchemy engine/session）
│   │   ├── models.py          # ORM 模型：Trip / Member / Currency / Category /
│   │   │                        PaymentMethod / Expense / ExpenseShare
│   │   ├── schemas.py         # Pydantic 請求/回應 schema
│   │   ├── routers/           # 依資源拆分的 REST 端點（trips / members / currencies /
│   │   │                        categories / payment_methods / expenses / settlement）
│   │   ├── services/
│   │   │   ├── split.py       # 分帳金額四捨五入與餘數分配（equal_split 等）
│   │   │   └── settlement.py  # 誰欠誰矩陣 + 債務簡化（最少轉帳次數）純函式
│   │   └── tests/             # pytest：test_split.py / test_settlement.py
│   └── requirements.txt
└── frontend/
    ├── app/
    │   ├── page.tsx                        # 首頁：行程列表
    │   └── trips/[tripId]/
    │       ├── layout.tsx                  # 行程內共用 Nav（Top Nav / Bottom Tab Bar）
    │       ├── page.tsx                    # 記帳列表（行程內預設頁）
    │       ├── settlement/page.tsx         # 結算總覽
    │       └── settings/page.tsx           # 行程設定
    ├── components/                         # UI 元件（含 settings/ 子目錄的 5 個設定區塊）
    └── lib/                                 # api.ts（fetch 封裝）/ types.ts / format.ts /
                                                TripContext.tsx（行程資料的 React context）
```

## 功能對應

- **行程管理**：首頁列出所有行程（含總花費、成員頭像、進行中/已結算狀態），可建立新行程
  或點卡片進入。
- **行程設定**：行程資訊（含變更基準幣別）、成員、幣別匯率、分類、付款方式，皆可新增/
  編輯/刪除。桌面版左側錨點導覽 + 右側區塊卡；手機版 Accordion。
- **支出記帳**：逐筆記錄日期/分類/項目/金額/幣別/付款人/付款方式/備註/是否分帳，
  金額即時依當下匯率換算成基準幣顯示。桌面版密集表格 + Modal 表單；手機版卡片流 + FAB +
  Bottom Sheet 表單，並支援篩選（日期/分類/付款人/關鍵字）。
- **分帳設定**：需要分帳時可自由勾選任意成員子集合，預設均分（含餘數分配，見下方
  「設計取捨」），可手動調整為不均分，並可逐人標記是否已結清。
- **結算總覽**：成員應分攤總額 vs 實際支付總額 vs 淨支付、誰欠誰矩陣、最終結算建議
  （debt simplification，盡量減少轉帳筆數），可切換行程內任一幣別視角顯示。桌面版三段式
  一次呈現；手機版 Tab 切換（總覽/明細/建議轉帳）。

## 設計取捨（Design Decisions）

1. **分帳金額加總 = 支出總額**：`backend/app/services/split.py` 的 `equal_split` 用
   「先分整數分（cents）、餘數依序分給前幾位成員」的方式（largest-remainder method），
   確保均分後加總永遠等於原始金額，不會因為除不盡而兜不攏。手動調整分帳金額時，
   後端 (`routers/expenses.py`) 一律驗證「所有分帳金額加總」必須等於「支出總額」
   （容許 0.005 的浮點誤差），否則拒絕寫入（回傳 400）。

2. **匯率修改不回溯影響歷史紀錄**：`Expense.rate_snapshot` / `Expense.base_amount` 與
   `ExpenseShare.base_amount` 在**建立當下**就把換算結果凍結存進資料庫（`routers/expenses.py`
   的 `create_expense`/`update_expense`），之後就算在「行程設定 → 幣別匯率」把某幣別的匯率
   改掉，過去已建立的支出換算金額也不會被回溯重算——這比較符合記帳工具的直覺（「這筆錢
   我當初換算多少就是多少」），也避免使用者事後修正匯率誤植時，意外讓所有歷史紀錄的
   基準幣金額全部跳動。若之後要改成即時重算，需要把 `base_amount` 欄位改成用
   當下匯率動態計算，而不是寫死存欄位。

3. **變更基準幣別**：`PUT /api/trips/{id}/base-currency` 會把行程內所有幣別的
   `rate_to_base` 依新基準幣重新換算（因為匯率規則是「所有幣別對*目前*基準幣的比率」），
   但同樣**不會**回溯修改既有支出的 `base_amount` 快照，理由同上。

4. **誰欠誰矩陣 vs 最終結算建議 是兩層不同的簡化**：矩陣（`compute_settlement` 裡的
   `matrix`）是「兩兩成員間」的淨額（A、B 互相有欠款時先互抵，只留單一方向），對應
   「原始 M 組欠款關係」；最終結算建議（`suggested_transfers`）則是對**全體成員的淨餘額**
   做貪婪演算法（每次配對目前最大債權人與最大債務人），把全體帳目簡化成最少的實際
   轉帳筆數 N。這是 Splitwise 類工具常用的近似最少轉帳演算法，不保證所有病態案例下都是
   數學上絕對最少，但保證帳目一定能配平、且交易數最多為「成員數 − 1」。
   `backend/app/tests/test_settlement.py` 有針對這個演算法的正確性測試（含用
   `mockups/04-settlement.html` 裡的範例數字回歸驗證）。

5. **個人（不分帳）支出如何計入結算**：一筆不分帳的支出，在結算計算裡視為「付款人自己
   應分攤全額」，也就是同時計入該付款人的「實際支付」與「應分攤總額」，兩者互相抵銷、
   淨支付貢獻為 0——這樣不用在 UI 特別排除個人支出，公式（淨支付 = 實際支付 − 應分攤）
   對所有支出都一致成立。

## 已完成的手動驗證

- 後端：`python -m pytest app/tests -v`（12 個測試全數通過，涵蓋分帳餘數分配與結算矩陣/
  轉帳建議正確性，其中一個測試直接對照 `mockups/04-settlement.html` 上的範例金額）。
- 後端：實際啟動 `uvicorn` 後用 `curl` 走過完整流程——建立行程 → 新增幣別/成員 →
  新增分帳支出（含驗證「分帳金額加總不符會被拒絕」）→ 新增不分帳支出 →
  查詢多幣別（TWD/USD）結算結果，數字互相對得上（淨額加總為 0、建議轉帳金額等於
  淨欠款）。
- 前端：`npx tsc --noEmit`、`npm run lint`、`npm run build` 均無錯誤；另外實際啟動
  `npm run dev`，在後端已有測試資料的情況下用 `curl` 確認首頁、記帳列表、結算總覽、
  行程設定四個路由皆回傳 200 且 server log 無 runtime error；並確認後端 CORS 設定允許
  `http://localhost:3000` 呼叫 API。
