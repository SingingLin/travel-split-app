# TravelSplit — 旅行分帳網站

多人旅行分帳/記帳工具。可建立多趟獨立行程，每趟行程各自管理成員、幣別匯率、分類、
逐筆記帳、分帳設定，並提供結算總覽（誰欠誰矩陣 + 最少轉帳次數的結算建議）。

視覺與版面規格依據 `../travel-split-app-design/design-spec.md` 與其 4 個 mockup 實作。

## 技術棧

- **前端**：Next.js 16（App Router）+ TypeScript + Tailwind CSS v4，位於 `frontend/`
- **後端**：Python + FastAPI + SQLAlchemy ORM，位於 `backend/`。本機開發預設連本機 SQLite
  檔案；設定 `DATABASE_URL` 環境變數可改連 Postgres（例如部署到雲端時接 Neon），見下方
  「資料庫設定」。
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

#### 排查：專案資料夾改名/搬移後 `.venv` 指令失效

`backend/.venv` 是用**建立當下**這個專案資料夾的絕對路徑建出來的——`.venv/bin/activate`、
`.venv/bin/pip`、`.venv/bin/python` 等腳本的 shebang（檔案開頭那行 `#!/path/to/...`）內部都
寫死了那個絕對路徑。如果之後把這個專案資料夾**改名或搬移**到別的路徑，這個虛擬環境內的
指令就會找不到自己原本的直譯器，典型錯誤訊息長得像：

```
bad interpreter: /原本的/舊路徑/backend/.venv/bin/python3.11: no such file or directory
```

**這不是符號連結不穩定的問題**，單純是虛擬環境內部腳本的路徑寫死在建立當下的資料夾位置
——虛擬環境本來就沒有「跟著資料夾一起搬」這種機制。解法是刪除重建，不需要也不建議嘗試修
內部路徑：

```bash
rm -rf backend/.venv
~/.local/bin/python3.11 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
```

（`~/.local/bin/python3.11` 請視你機器上實際可用的 3.11+ 直譯器路徑調整，跟上面「需要
Python 3.11+」那段的說明一致。）

- SQLite 資料庫檔案 `backend/travel_split.db` 會在**第一次啟動時自動建立**（`app/main.py`
  啟動時呼叫 `Base.metadata.create_all`），不需要另外跑 migration 指令。
- 若要重置資料，直接刪除 `backend/travel_split.db`（連同 `-journal` 檔，如果有的話）再重啟
  即可，下次啟動會產生全新的空資料庫。
- 健康檢查：`curl http://localhost:8000/api/health` 應回傳 `{"status":"ok"}`。
- API 文件（FastAPI 自動產生）：啟動後開啟 http://localhost:8000/docs。

#### 資料庫設定：本機 SQLite（預設）vs 雲端 Postgres

`backend/app/database.py` 依 `DATABASE_URL` 環境變數決定要連哪個資料庫：

- **本機開發（預設，不用做任何事）**：沒有設定 `DATABASE_URL` 時，自動連本機檔案
  `backend/travel_split.db`（SQLite），行為與過去完全一樣。
- **接雲端 Postgres（例如 Neon，部署到 Render 時用）**：在 `backend/.env`（gitignored，
  不會進版控）加一行 `DATABASE_URL=postgresql://<user>:<password>@<host>/<db>?sslmode=require`，
  重啟後端即會改連 Postgres；`Base.metadata.create_all()`（見 `app/main.py` 啟動流程）
  會在空的 Postgres 資料庫上自動建出完整資料表結構，不需要另外跑 migration 指令。
  `backend/.env` 不存在或該行被註解掉時，一樣 fallback 回本機 SQLite。
- 兩種資料庫都靠 `app/database.py` 的 `ensure_columns()` 處理「舊表補欄位」（依
  `engine.dialect.name` 分流：SQLite 用 `PRAGMA table_info` + `ALTER TABLE ADD COLUMN`，
  Postgres 用 `ALTER TABLE ADD COLUMN IF NOT EXISTS`），兩邊都是冪等、可重複執行。
- 測試套件（`pytest`）固定用記憶體內 SQLite（`sqlite:///:memory:`），不受 `DATABASE_URL`
  或 `.env` 影響，不需要連得到 Postgres 才能跑測試。

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

## 部署到 Render + Vercel

正式部署採「後端 Render + 前端 Vercel」分開部署。兩邊互相需要對方的網址才能設定完整，
所以**順序很重要**，請照下面步驟走一次：

> 🔒 標示「機密／環境相關資訊」的欄位，一律只在 Render／Vercel 後台的網頁表單填入，
> **絕對不要**寫進程式碼、`render.yaml`、`README.md`，或任何會 `git commit`／`git push`
> 的檔案。這份 repo 裡看得到的都只會是「變數名稱」，不會是實際的值。

### 步驟 1：部署後端到 Render，拿到後端網址

1. 到 [Render](https://render.com) 後台，選擇用這個 repo 建立新的 **Web Service**。
   - 若用「Blueprint」方式匯入：New + → Blueprint → 選這個 repo，Render 會讀取專案根目錄
     的 [`render.yaml`](./render.yaml) 自動帶入下方設定（見該檔案，`sync: false` 的兩個
     環境變數會另外跳出來要你手動填）。
   - 若手動建立 Web Service，請照 `render.yaml` 裡的設定手動填：
     - **Root Directory**：`backend`
     - **Build Command**：`pip install -r requirements.txt`
     - **Start Command**：`uvicorn app.main:app --host 0.0.0.0 --port $PORT`
2. 在 Render 後台的「Environment」分頁，手動新增以下環境變數（**機密／環境相關資訊，
   只在這裡填，不要寫進 git**）：
   - `DATABASE_URL` — 你的 Postgres（例如 Neon）連線字串，格式為
     `postgresql://<user>:<password>@<host>/<dbname>?sslmode=require`。沒設這個變數會
     fallback 用本機檔案型 SQLite，在 Render 上**不會**在重新部署後保留資料，正式環境務必設定。
   - `ALLOWED_ORIGINS` — 先留空或暫填 `http://localhost:3000` 佔位即可，等步驟 3 拿到
     Vercel 網址後回頭在步驟 4 補上真正的值。
   - `APP_JWT_SECRET` 🔒🔴 —（`render.yaml` 沒有預先列出這個變數，需自己手動新增）
     這個服務簽發／驗證登入 JWT 用的密鑰（見 `backend/app/auth.py`）。**必須跟步驟 2
     要填在 Vercel 的 `APP_JWT_SECRET` 完全一模一樣**，兩邊只要有一個字元不同，前端登入
     看起來會成功，但每個 API 請求都會被這個後端擋 401——建議在這裡先產生一組隨機值
     （例如 `openssl rand -base64 32`），記下來，等一下原封不動貼到 Vercel 那邊。
3. 部署完成後，Render 會給一個網址，例如 `https://travel-split-backend.onrender.com`。
   用瀏覽器打開 `<這個網址>/api/health` 確認回傳 `{"status":"ok"}`，代表後端部署成功。
   **記下這個網址**，下一步會用到。

### 步驟 2：把後端網址設進 Vercel 環境變數，部署前端

1. 到 [Vercel](https://vercel.com) 後台，用這個 repo 建立新的 Project。
   - **Root Directory** 設定為 `frontend`（Vercel 對 Next.js 專案通常會自動偵測
     build/start 指令，即 `frontend/package.json` 裡的 `next build`／`next start`，
     不需要額外設定檔）。
2. 在 Vercel 後台的「Environment Variables」設定以下變數（**環境相關資訊，只在這裡填，
   不要寫進 git**）：
   - `NEXT_PUBLIC_API_BASE_URL` — 填步驟 1 拿到的 Render 後端網址（例如
     `https://travel-split-backend.onrender.com`，注意不要有結尾斜線）。
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google 登入用的 OAuth 用戶端憑證。到
     [Google Cloud Console](https://console.cloud.google.com/apis/credentials) 建立一組
     「網頁應用程式」類型的 OAuth 用戶端，**已授權的重新導向 URI**填
     `https://<你的 Vercel 網址>/api/auth/callback/google`（NextAuth 固定格式）。
   - `AUTH_SECRET` — NextAuth（Auth.js）自己內部用來加密 session cookie 的密鑰，跟下面的
     `APP_JWT_SECRET`是完全不同用途、不同值的東西，不要搞混。用
     `openssl rand -base64 32` 產生一組隨機值即可。
   - `APP_JWT_SECRET` 🔒🔴 **一定要跟步驟 1 幫 Render 後端設定的 `APP_JWT_SECRET` 完全
     一模一樣**——這是前端簽發、後端驗證的共用密鑰（見 `backend/app/auth.py` 與
     `frontend/auth.ts`），兩邊只要有一個字元不同，前端登入看起來會成功，但**每一個 API
     請求都會被後端擋 401**，行為會很像「登入卻進不去」，很容易誤以為是別的問題。把步驟
     1 在 Render 那邊填的同一個值，原封不動複製貼到這裡。
3. 部署完成後，Vercel 會給一個網址，例如 `https://travel-split-app.vercel.app`（或你設定
   的自訂網域）。**記下這個網址**，下一步會用到。

### 步驟 3：回頭把前端網址加進後端的 ALLOWED_ORIGINS，重新部署後端

1. 回到 Render 後台，把步驟 1 的 `ALLOWED_ORIGINS` 環境變數改成步驟 2 拿到的 Vercel 網址
   （見 `backend/app/main.py`，逗號分隔可填多個來源，例如同時保留自訂網域跟
   `*.vercel.app` 網址）：
   ```
   https://travel-split-app.vercel.app
   ```
   若之後又加了自訂網域，用逗號串接多個網址即可，例如：
   ```
   https://travel-split-app.vercel.app,https://travelsplit.example.com
   ```
2. 儲存後 Render 會自動重新部署後端（或手動觸發 Manual Deploy）。重新部署完成後，
   從正式的 Vercel 前端網址實際操作一次（例如建立行程、新增支出），確認能正常呼叫到
   後端 API、沒有瀏覽器主控台的 CORS 錯誤，代表兩邊部署設定完整串接成功。

### 小結：哪些是機密／環境相關資訊

| 變數 | 設定位置 | 說明 |
|---|---|---|
| `DATABASE_URL` | Render 後台「Environment」 | 🔒 機密，含資料庫密碼，絕不寫進 git |
| `ALLOWED_ORIGINS` | Render 後台「Environment」 | 環境相關（依 Vercel 網址而定），不寫進 git |
| `APP_JWT_SECRET` | Render **與** Vercel 後台都要設 | 🔒🔴 機密，且**兩邊必須填完全相同的值**——前端簽發、後端驗證登入 JWT 用的共用密鑰，見上方步驟 1、2 的說明，這是最容易漏看導致「前後端對不上」的一項 |
| `NEXT_PUBLIC_API_BASE_URL` | Vercel 後台「Environment Variables」 | 環境相關（依 Render 網址而定），不寫進 git |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Vercel 後台「Environment Variables」 | 🔒 機密，Google 登入用的 OAuth 用戶端憑證 |
| `AUTH_SECRET` | Vercel 後台「Environment Variables」 | 🔒 機密，NextAuth 自己內部的 session 加密密鑰，跟 `APP_JWT_SECRET` 是不同東西，不要搞混 |

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
