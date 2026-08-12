"""One-time / re-runnable demo-data seeder for TravelSplit.

Wipes every existing trip (and everything that cascades from it: members,
currencies, categories, payment_methods, expenses, expense_shares) from
whichever database DATABASE_URL currently resolves to (see
app/database.py — unset/commented .env => local SQLite; DATABASE_URL set
=> whatever it points at, e.g. Neon Postgres), then writes one richly
detailed "looks like a real trip" demo trip through the real FastAPI app
(via fastapi.testclient.TestClient, not raw SQL), so every write passes the
same request validation / split-rounding / rate-snapshot logic a real
user's browser requests would.

Designed to be re-run any time (e.g. "the demo got messed up, reset it") —
it always starts by deleting every trip currently in the target database,
so re-running never piles up duplicate trips.

Usage (from backend/, with the venv active):
    .venv/bin/python scripts/seed_demo_data.py

Whichever DATABASE_URL is active when this runs (real env var, or
backend/.env) is the database that gets wiped + reseeded — same rule
app/database.py always uses everywhere else in this project. Double-check
which one is active before running against a shared/Postgres target (this
script deliberately never prints the DATABASE_URL value itself, only its
scheme, to avoid leaking a connection string into logs — see main()).
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402

from app.database import DATABASE_URL  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)

TRIP_NAME = "東京五日自由行"

MEMBER_NAMES = ["小明", "阿凱", "Ivy"]

# One demo trip designed to exercise most of the app's features in a single
# believable itinerary: 5 days in Tokyo, 3 members, base currency TWD with
# JPY as the on-the-ground spending currency, a mix of equal-split /
# weighted-split ("依份數分攤") / personal (no-split) expenses, one
# credit-card foreign-transaction-fee example, and one income (refund) row.
#
# Each entry:
#   date, category, name, amount, currency, payer, payment_method, type
#   needs_split: False (personal) | "equal" (equal_split among `participants`)
#                | "weighted" (weighted_split using `weights`)
#   foreign_fee: optional (only meaningful with 信用卡)
#   note: optional flavor text
EXPENSES = [
    # ---- Day 1 (2026-03-10): arrival ----
    {
        "date": "2026-03-10",
        "category": "機票",
        "name": "台北↔東京來回機票 x3",
        "amount": 27600,
        "currency": "TWD",
        "payer": "小明",
        "payment_method": "信用卡",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
        "note": "早鳥優惠含稅，出發前用台灣的卡刷的，非海外交易",
    },
    {
        "date": "2026-03-10",
        "category": "住宿",
        "name": "新宿東橫INN 4晚",
        "amount": 24000,
        "currency": "TWD",
        "payer": "阿凱",
        "payment_method": "信用卡",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
        "note": "訂房網站以台幣計價付款",
    },
    {
        "date": "2026-03-10",
        "category": "移動",
        "name": "成田特快 N'EX 來回票 x3",
        "amount": 9000,
        "currency": "JPY",
        "payer": "Ivy",
        "payment_method": "現金",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
    },
    {
        "date": "2026-03-10",
        "category": "吃喝",
        "name": "抵達當晚一蘭拉麵",
        "amount": 3600,
        "currency": "JPY",
        "payer": "小明",
        "payment_method": "現金",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
    },
    # ---- Day 2 (2026-03-11): 市區觀光 ----
    {
        "date": "2026-03-11",
        "category": "購物",
        "name": "超商零食飲料（個人）",
        "amount": 850,
        "currency": "JPY",
        "payer": "Ivy",
        "payment_method": "現金",
        "needs_split": False,
        "note": "Ivy 自己買的，不分帳",
    },
    {
        "date": "2026-03-11",
        "category": "票券",
        "name": "東京晴空塔展望台門票 x3",
        "amount": 9000,
        "foreign_fee": 135,
        "currency": "JPY",
        "payer": "阿凱",
        "payment_method": "信用卡",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
        "note": "海外刷卡，含約1.5%海外手續費",
    },
    {
        "date": "2026-03-11",
        "category": "吃喝",
        "name": "築地場外市場海鮮丼午餐",
        "amount": 4500,
        "currency": "JPY",
        "payer": "小明",
        "payment_method": "現金",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
    },
    {
        "date": "2026-03-11",
        "category": "移動",
        "name": "東京地下鐵24小時券 x3",
        "amount": 2700,
        "currency": "JPY",
        "payer": "Ivy",
        "payment_method": "現金",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
    },
    # ---- Day 3 (2026-03-12): 台場 ----
    {
        "date": "2026-03-12",
        "category": "娛樂",
        "name": "台場 teamLab 展覽門票 x3",
        "amount": 12000,
        "currency": "JPY",
        "payer": "阿凱",
        "payment_method": "信用卡",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
    },
    {
        "date": "2026-03-12",
        "category": "娛樂",
        "name": "台場摩天輪 x3",
        "amount": 2700,
        "currency": "JPY",
        "payer": "小明",
        "payment_method": "現金",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
    },
    {
        "date": "2026-03-12",
        "category": "吃喝",
        "name": "居酒屋晚餐（依食量分攤）",
        "amount": 9600,
        "currency": "JPY",
        "payer": "小明",
        "payment_method": "現金",
        "needs_split": "weighted",
        "weights": {"小明": 2, "阿凱": 2, "Ivy": 1},
        "note": "小明和阿凱點得比較多，Ivy 吃得少，依份數分攤",
    },
    {
        "date": "2026-03-12",
        "category": "購物",
        "name": "藥妝店戰利品（個人）",
        "amount": 6200,
        "foreign_fee": 93,
        "currency": "JPY",
        "payer": "阿凱",
        "payment_method": "信用卡",
        "needs_split": False,
        "note": "阿凱自己買的保養品，不分帳，海外刷卡含手續費",
    },
    # ---- Day 4 (2026-03-13): 箱根一日遊 ----
    {
        "date": "2026-03-13",
        "category": "移動",
        "name": "箱根周遊券 x3",
        "amount": 15000,
        "currency": "JPY",
        "payer": "Ivy",
        "payment_method": "現金",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
    },
    {
        "date": "2026-03-13",
        "category": "票券",
        "name": "箱根海賊船＋纜車套票 x3",
        "amount": 6000,
        "currency": "JPY",
        "payer": "小明",
        "payment_method": "現金",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
    },
    {
        "date": "2026-03-13",
        "category": "吃喝",
        "name": "溫泉旅館會席晚餐（依人數分攤）",
        "amount": 16800,
        "currency": "JPY",
        "payer": "阿凱",
        "payment_method": "信用卡",
        "needs_split": "weighted",
        "weights": {"小明": 3, "阿凱": 2, "Ivy": 2},
        "note": "小明加點了和牛升級套餐，份數比較高",
    },
    # ---- Day 5 (2026-03-14): 離境 ----
    {
        "date": "2026-03-14",
        "category": "購物",
        "name": "銀座百貨伴手禮 x3人份",
        "amount": 21000,
        "currency": "JPY",
        "payer": "Ivy",
        "payment_method": "信用卡",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
    },
    {
        "date": "2026-03-14",
        "category": "住宿",
        "name": "溫泉旅館退還多收訂金",
        "amount": 3000,
        "currency": "JPY",
        "payer": "阿凱",
        "payment_method": "現金",
        "needs_split": False,
        "type": "income",
        "note": "入住時櫃檯多收了訂金，退房時現金退還給阿凱",
    },
    {
        "date": "2026-03-14",
        "category": "吃喝",
        "name": "機場最後一餐拉麵",
        "amount": 2400,
        "currency": "JPY",
        "payer": "Ivy",
        "payment_method": "現金",
        "needs_split": "equal",
        "participants": MEMBER_NAMES,
    },
]

# "初始換匯" — the money physically carried while traveling: exchanged
# 30,000 TWD into 140,000 JPY before departure (actual booth rate, which
# legitimately differs a little from the trip's live JPY.rate_to_base below
# due to fees/rounding — see models.Trip's docstring).
INITIAL_EXCHANGE = {
    "initial_exchange_from_currency": "TWD",
    "initial_exchange_from_amount": 30000,
    "initial_exchange_to_currency": "JPY",
    "initial_exchange_to_amount": 140000,
    "initial_exchange_rate": 0.2143,  # TWD per 1 JPY, ~= 30000/140000
}

JPY_RATE_TO_BASE = 0.215  # 1 JPY ~= 0.215 TWD


def _ok(resp, expected=200):
    if resp.status_code != expected:
        raise RuntimeError(
            f"{resp.request.method} {resp.request.url} -> {resp.status_code}: {resp.text}"
        )
    return resp.json()


def clear_all_trips() -> int:
    """Delete every existing trip (cascades to all child rows). Makes this
    script safe to re-run without accumulating duplicate demo trips."""
    trips = _ok(client.get("/api/trips"))
    for t in trips:
        resp = client.delete(f"/api/trips/{t['id']}")
        if resp.status_code != 204:
            raise RuntimeError(f"Failed to delete trip {t['id']}: {resp.status_code} {resp.text}")
    print(f"Cleared {len(trips)} existing trip(s).")
    return len(trips)


def create_trip() -> dict:
    payload = {
        "name": TRIP_NAME,
        "base_currency_code": "TWD",
        "base_currency_name": "新台幣",
        "start_date": "2026-03-10",
        "end_date": "2026-03-14",
        **INITIAL_EXCHANGE,
    }
    trip = _ok(client.post("/api/trips", json=payload), 201)
    print(f"Created trip #{trip['id']}: {trip['name']} ({trip['start_date']} ~ {trip['end_date']})")
    return trip


def create_members(trip_id: int) -> dict:
    member_by_name = {}
    for name in MEMBER_NAMES:
        m = _ok(client.post(f"/api/trips/{trip_id}/members", json={"name": name}), 201)
        member_by_name[name] = m["id"]
    print(f"Created members: {', '.join(MEMBER_NAMES)}")
    return member_by_name


def create_jpy_currency(trip_id: int) -> None:
    _ok(
        client.post(
            f"/api/trips/{trip_id}/currencies",
            json={"code": "JPY", "name": "日圓", "rate_to_base": JPY_RATE_TO_BASE},
        ),
        201,
    )
    print(f"Added currency JPY (rate_to_base={JPY_RATE_TO_BASE})")


def _compute_shares(trip_id: int, item: dict, member_by_name: dict, effective_amount: float) -> list[dict]:
    mode = item["needs_split"]
    if mode == "equal":
        member_ids = [member_by_name[n] for n in item["participants"]]
        preview = _ok(
            client.post(
                f"/api/trips/{trip_id}/expenses/split-preview",
                json={"amount": effective_amount, "member_ids": member_ids},
            )
        )
    elif mode == "weighted":
        weights_by_id = {member_by_name[n]: w for n, w in item["weights"].items()}
        preview = _ok(
            client.post(
                f"/api/trips/{trip_id}/expenses/split-preview",
                json={
                    "amount": effective_amount,
                    "member_ids": list(weights_by_id.keys()),
                    "shares": weights_by_id,
                },
            )
        )
    else:
        raise ValueError(f"Unknown split mode: {mode!r}")
    return [{"member_id": int(mid), "amount": amt, "is_settled": False} for mid, amt in preview.items()]


def create_expenses(
    trip_id: int,
    member_by_name: dict,
    currency_by_code: dict,
    category_by_name: dict,
    payment_method_by_name: dict,
) -> int:
    for item in EXPENSES:
        amount = item["amount"]
        foreign_fee = item.get("foreign_fee")
        effective_amount = amount + (foreign_fee or 0.0)
        needs_split_mode = item["needs_split"]
        needs_split = bool(needs_split_mode)  # "equal"/"weighted" -> True, False -> False

        shares_payload = (
            _compute_shares(trip_id, item, member_by_name, effective_amount) if needs_split else []
        )

        payload = {
            "date": item["date"],
            "category_id": category_by_name[item["category"]],
            "name": item["name"],
            "amount": amount,
            "foreign_fee": foreign_fee,
            "currency_id": currency_by_code[item["currency"]],
            "payer_id": member_by_name[item["payer"]],
            "payment_method_id": payment_method_by_name[item["payment_method"]],
            "note": item.get("note"),
            "needs_split": needs_split,
            "shares": shares_payload,
            "type": item.get("type", "expense"),
        }
        _ok(client.post(f"/api/trips/{trip_id}/expenses", json=payload), 201)

    print(f"Seeded {len(EXPENSES)} expense/income row(s).")
    return len(EXPENSES)


def verify(trip_id: int) -> None:
    """Read the demo trip back exactly the way a real client would (GET
    trip detail / expenses / settlement) and sanity-check the settlement
    math actually balances — never trust hand-typed numbers."""
    detail = _ok(client.get(f"/api/trips/{trip_id}"))
    expenses = _ok(client.get(f"/api/trips/{trip_id}/expenses"))
    settlement = _ok(client.get(f"/api/trips/{trip_id}/settlement"))

    assert len(detail["members"]) == len(MEMBER_NAMES), "member count mismatch"
    assert len(expenses) == len(EXPENSES), "expense count mismatch"

    total_owed = round(sum(m["total_owed"] for m in settlement["members"]), 2)
    total_paid = round(sum(m["total_paid"] for m in settlement["members"]), 2)
    total_net = round(sum(m["net"] for m in settlement["members"]), 2)

    print(
        "Settlement check: trip_total_spend="
        f"{settlement['trip_total_spend']}, sum(total_owed)={total_owed}, "
        f"sum(total_paid)={total_paid}, sum(net)={total_net}"
    )

    if abs(total_net) > 0.01:
        raise RuntimeError(f"Settlement net does not sum to zero (got {total_net}) — data is inconsistent.")
    if abs(total_owed - settlement["trip_total_spend"]) > 0.01:
        raise RuntimeError(
            f"sum(total_owed)={total_owed} does not match trip_total_spend="
            f"{settlement['trip_total_spend']} — data is inconsistent."
        )
    for m in settlement["members"]:
        for key in ("total_owed", "total_paid", "net"):
            if m[key] != m[key]:  # NaN check
                raise RuntimeError(f"NaN found in settlement for member {m['member_id']}.{key}")

    print("Verification OK: trip/expenses/settlement all read back cleanly and balance to zero.")


def seed() -> int:
    scheme = DATABASE_URL.split("://", 1)[0]
    print(f"Target database scheme: {scheme}")  # never print the full DATABASE_URL (may contain credentials)

    clear_all_trips()
    trip = create_trip()
    trip_id = trip["id"]

    member_by_name = create_members(trip_id)
    create_jpy_currency(trip_id)

    detail = _ok(client.get(f"/api/trips/{trip_id}"))
    currency_by_code = {c["code"]: c["id"] for c in detail["currencies"]}
    category_by_name = {c["name"]: c["id"] for c in detail["categories"]}
    payment_method_by_name = {p["name"]: p["id"] for p in detail["payment_methods"]}

    create_expenses(trip_id, member_by_name, currency_by_code, category_by_name, payment_method_by_name)
    verify(trip_id)

    print(f"\nDone. Demo trip #{trip_id} ({TRIP_NAME}) seeded successfully.")
    return trip_id


if __name__ == "__main__":
    seed()
