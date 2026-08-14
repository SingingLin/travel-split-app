from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.auth import require_trip_access
from app.database import get_db
from app.services.settlement import compute_settlement

router = APIRouter(tags=["settlement"])

UNCATEGORIZED_COLOR = "#94a3b8"  # slate-400 — matches Chip.tsx's neutral/uncategorized styling
UNCATEGORIZED_LABEL = "未分類"


def _build_category_breakdown(
    expense_only_rows: list[tuple[int | None, float]],
    categories: list[models.Category],
    total_for_percentage: float,
) -> list[schemas.CategoryBreakdownItem]:
    """`expense_only_rows` is a list of (category_id, amount) for every
    type="expense" row ONLY — per the "依分類的花費比例" pie chart spec,
    income rows are excluded entirely here (not just netted), unlike
    trip_total_spend below. Groups by category_id, using each Category's own
    `color` so the pie chart always matches the category chips used
    elsewhere (never re-derives colors on the frontend)."""
    category_by_id = {c.id: c for c in categories}
    totals: dict[int | None, float] = defaultdict(float)
    for category_id, amount in expense_only_rows:
        totals[category_id] += amount

    items = []
    for category_id, amount in totals.items():
        category = category_by_id.get(category_id) if category_id is not None else None
        name = category.name if category else UNCATEGORIZED_LABEL
        color = category.color if category else UNCATEGORIZED_COLOR
        percentage = round((amount / total_for_percentage) * 100, 2) if total_for_percentage > 0 else 0.0
        items.append(
            schemas.CategoryBreakdownItem(
                category_id=category_id,
                name=name,
                color=color,
                amount=round(amount, 2),
                percentage=percentage,
            )
        )
    items.sort(key=lambda item: -item.amount)
    return items


def _build_settlement_out(
    currency_code: str,
    members: list[models.Member],
    expenses: list[models.Expense],
    categories: list[models.Category],
    amount_of: callable,
) -> schemas.SettlementOut:
    """Shared by both endpoints below — `amount_of(expense)` returns this
    expense's amount already converted into whatever currency this
    SettlementOut is denominated in (base-currency-converted for the single-
    currency endpoint, or the expense's own native amount for the
    by-currency endpoint's per-currency native amounts), and likewise for
    each share via `amount_of` applied per-share (see call sites)."""
    plain_members = [{"id": m.id, "name": m.name, "color": m.color} for m in members]
    plain_expenses = []
    # Two different sums, per two different specs:
    #   trip_total_spend: income NETS AGAINST the total (signed_amount, same
    #     convention as routers/trips.py's list-card total and
    #     ExpensesPageClient's "合計") — this is what makes it equal
    #     sum(member.total_owed), used as the correctness check.
    #   category_breakdown: income rows are excluded ENTIRELY (not netted) —
    #     "只計算 type=expense 的支出，收入不算進花費比例".
    signed_total = 0.0
    expense_only_rows: list[tuple[int | None, float]] = []
    for e in expenses:
        amount = amount_of(e)
        signed_amount = -amount if e.type == "income" else amount
        signed_total += signed_amount
        plain_expenses.append(
            {
                "payer_id": e.payer_id,
                "amount": amount,
                "needs_split": e.needs_split,
                "type": e.type,
                "shares": [{"member_id": s.member_id, "amount": amount_of(s)} for s in e.shares],
            }
        )
        if e.type != "income":
            expense_only_rows.append((e.category_id, amount))

    result = compute_settlement(plain_members, plain_expenses)

    member_by_id = {m.id: m for m in members}
    member_summaries = [
        schemas.MemberSettlementOut(
            member_id=ms["member_id"],
            name=member_by_id[ms["member_id"]].name,
            color=member_by_id[ms["member_id"]].color,
            total_owed=ms["total_owed"],
            total_paid=ms["total_paid"],
            net=ms["net"],
        )
        for ms in result["members"]
    ]

    trip_total_spend = round(signed_total, 2)
    expense_only_total = round(sum(amount for _cat, amount in expense_only_rows), 2)
    category_breakdown = _build_category_breakdown(expense_only_rows, categories, expense_only_total)

    return schemas.SettlementOut(
        currency_code=currency_code,
        members=member_summaries,
        matrix=[schemas.DebtCell(**c) for c in result["matrix"]],
        raw_relationship_count=result["raw_relationship_count"],
        suggested_transfers=[schemas.TransferSuggestion(**t) for t in result["suggested_transfers"]],
        trip_total_spend=trip_total_spend,
        category_breakdown=category_breakdown,
    )


@router.get("/api/trips/{trip_id}/settlement", response_model=schemas.SettlementOut)
def get_settlement(
    trip_id: int,
    currency: str | None = None,
    access: models.TripAccess = Depends(require_trip_access),
    db: Session = Depends(get_db),
):
    """統一換算 mode: every expense/share converted into a single target
    display currency (defaults to the trip's base currency) before summing —
    see get_settlement_by_currency below for the 依原幣別分開 alternative."""
    trip = db.get(models.Trip, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    members = db.query(models.Member).filter(models.Member.trip_id == trip_id).order_by(models.Member.order_index).all()
    currencies = db.query(models.Currency).filter(models.Currency.trip_id == trip_id).all()
    categories = db.query(models.Category).filter(models.Category.trip_id == trip_id).all()
    expenses = (
        db.query(models.Expense)
        .options(selectinload(models.Expense.shares))
        .filter(models.Expense.trip_id == trip_id)
        .all()
    )

    target_code = (currency or trip.base_currency_code).upper()
    target_currency = next((c for c in currencies if c.code == target_code), None)
    if not target_currency:
        raise HTTPException(status_code=400, detail=f"Unknown currency '{target_code}' for this trip")

    # base_amount (snapshotted, in trip base currency) -> target display currency.
    # rate_to_base means "1 unit of `currency` = rate_to_base units of base",
    # so converting FROM base TO target divides by target's rate_to_base.
    def to_display(base_amount: float) -> float:
        return round(base_amount / target_currency.rate_to_base, 2)

    return _build_settlement_out(
        currency_code=target_code,
        members=members,
        expenses=expenses,
        categories=categories,
        amount_of=lambda row: to_display(row.base_amount),
    )


@router.get("/api/trips/{trip_id}/settlement/by-currency", response_model=schemas.NativeSettlementOut)
def get_settlement_by_currency(
    trip_id: int,
    access: models.TripAccess = Depends(require_trip_access),
    db: Session = Depends(get_db),
):
    """依原幣別分開結算 mode: group this trip's expenses by their own native
    currency (no conversion at all — uses each expense/share's raw
    amount/effective_amount, not base_amount) and compute one independent
    SettlementOut per currency actually used by at least one expense. A trip
    that mixes a TWD credit-card expense and an IDR cash expense gets back
    two separate, non-combined settlements here instead of one merged number
    — see schemas.NativeSettlementOut."""
    trip = db.get(models.Trip, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    members = db.query(models.Member).filter(models.Member.trip_id == trip_id).order_by(models.Member.order_index).all()
    currencies = {
        c.id: c for c in db.query(models.Currency).filter(models.Currency.trip_id == trip_id).all()
    }
    categories = db.query(models.Category).filter(models.Category.trip_id == trip_id).all()
    expenses = (
        db.query(models.Expense)
        .options(selectinload(models.Expense.shares))
        .filter(models.Expense.trip_id == trip_id)
        .all()
    )

    expenses_by_currency: dict[int, list[models.Expense]] = defaultdict(list)
    for e in expenses:
        expenses_by_currency[e.currency_id].append(e)

    # Native amount, no conversion: Expense.amount/foreign_fee and
    # ExpenseShare.amount are already denominated in the expense's own
    # currency_id (see models.py) — effective_amount folds in the foreign
    # transaction fee for the top-level expense row, matching how
    # routers/expenses.py computes what shares must sum to; ExpenseShare has
    # no separate fee field, so its `amount` is used as-is.
    def native_amount(row) -> float:
        if isinstance(row, models.Expense):
            return round(row.amount + (row.foreign_fee or 0.0), 2)
        return round(row.amount, 2)

    results = []
    # Sorted for stable, deterministic ordering across requests (dict
    # iteration order would otherwise just be "first expense seen").
    for currency_id in sorted(expenses_by_currency, key=lambda cid: currencies[cid].code):
        currency = currencies[currency_id]
        results.append(
            _build_settlement_out(
                currency_code=currency.code,
                members=members,
                expenses=expenses_by_currency[currency_id],
                categories=categories,
                amount_of=native_amount,
            )
        )

    return schemas.NativeSettlementOut(results=results)
