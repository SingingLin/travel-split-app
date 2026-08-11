"""Settlement math: member net balances, who-owes-whom matrix, and a
minimal-transfer-count payoff suggestion (debt simplification).

Pure functions only (no DB/ORM types) so they're trivial to unit test —
see app/tests/test_settlement.py. The router converts amounts into the
member-selected display currency *before* calling these, so everything
here is currency-agnostic (just "money units").

Expected input shapes (plain dicts, decoupled from SQLAlchemy models):

  members  = [{"id": 1, "name": "Singing", "color": "#14b8a6"}, ...]
  expenses = [
    {
      "payer_id": 1,
      "amount": 6000.0,          # already converted to display currency
      "needs_split": True,
      "shares": [{"member_id": 1, "amount": 2000.0}, ...],  # converted too
    },
    ...
  ]

Personal (needs_split=False) expenses count as "owed by the payer" in full
(they paid for themselves, so it nets to zero against their own "paid"
total) — this keeps the paid/owed/net bookkeeping internally consistent
without special-casing personal expenses in the UI layer.
"""
from collections import defaultdict

ZERO_EPSILON = 0.005  # amounts smaller than this (money units) are treated as settled/zero


def compute_settlement(members: list[dict], expenses: list[dict]) -> dict:
    member_ids = [m["id"] for m in members]
    paid: dict[int, float] = {mid: 0.0 for mid in member_ids}
    owed: dict[int, float] = {mid: 0.0 for mid in member_ids}
    raw_debt: dict[tuple[int, int], float] = defaultdict(float)  # (debtor, creditor) -> amount

    for exp in expenses:
        payer_id = exp["payer_id"]
        amount = exp["amount"]
        paid[payer_id] = paid.get(payer_id, 0.0) + amount

        if exp.get("needs_split") and exp.get("shares"):
            for share in exp["shares"]:
                mid = share["member_id"]
                amt = share["amount"]
                owed[mid] = owed.get(mid, 0.0) + amt
                if mid != payer_id:
                    raw_debt[(mid, payer_id)] += amt
        else:
            owed[payer_id] = owed.get(payer_id, 0.0) + amount

    net: dict[int, float] = {mid: round(paid.get(mid, 0.0) - owed.get(mid, 0.0), 2) for mid in member_ids}

    # Net the raw pairwise debts (a owes b X, b owes a Y -> single directional amount).
    pairs_seen: set[frozenset] = set()
    matrix: list[dict] = []
    for (a, b) in list(raw_debt.keys()):
        pair = frozenset((a, b))
        if pair in pairs_seen:
            continue
        pairs_seen.add(pair)
        amt_a_to_b = raw_debt.get((a, b), 0.0)
        amt_b_to_a = raw_debt.get((b, a), 0.0)
        net_amt = round(amt_a_to_b - amt_b_to_a, 2)
        if net_amt > ZERO_EPSILON:
            matrix.append({"debtor_id": a, "creditor_id": b, "amount": net_amt})
        elif net_amt < -ZERO_EPSILON:
            matrix.append({"debtor_id": b, "creditor_id": a, "amount": -net_amt})

    raw_relationship_count = len(matrix)

    suggested_transfers = simplify_debts(net)

    member_summaries = [
        {
            "member_id": mid,
            "total_owed": round(owed.get(mid, 0.0), 2),
            "total_paid": round(paid.get(mid, 0.0), 2),
            "net": net[mid],
        }
        for mid in member_ids
    ]

    return {
        "members": member_summaries,
        "matrix": matrix,
        "raw_relationship_count": raw_relationship_count,
        "suggested_transfers": suggested_transfers,
    }


def simplify_debts(net: dict[int, float]) -> list[dict]:
    """Greedy debt simplification: repeatedly match the biggest creditor with
    the biggest debtor. Minimizes transaction count in practice (the same
    approach Splitwise-style tools use); not guaranteed globally optimal for
    all pathological inputs, but always correct (balances always net to 0)
    and always at most len(members)-1 transfers.
    """
    creditors = [[mid, amt] for mid, amt in net.items() if amt > ZERO_EPSILON]
    debtors = [[mid, -amt] for mid, amt in net.items() if amt < -ZERO_EPSILON]
    creditors.sort(key=lambda x: -x[1])
    debtors.sort(key=lambda x: -x[1])

    transfers: list[dict] = []
    i, j = 0, 0
    while i < len(debtors) and j < len(creditors):
        debtor_id, debt_amt = debtors[i]
        creditor_id, credit_amt = creditors[j]
        pay = round(min(debt_amt, credit_amt), 2)
        if pay > ZERO_EPSILON:
            transfers.append({"from_member_id": debtor_id, "to_member_id": creditor_id, "amount": pay})
        debtors[i][1] = round(debt_amt - pay, 2)
        creditors[j][1] = round(credit_amt - pay, 2)
        if debtors[i][1] <= ZERO_EPSILON:
            i += 1
        if creditors[j][1] <= ZERO_EPSILON:
            j += 1
    return transfers
