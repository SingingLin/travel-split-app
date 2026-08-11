"""Split-amount math shared by the expense router.

The one hard rule: the sum of shares must always equal the expense total,
to the cent. Naive `total / n` division loses cents to rounding (e.g.
100 / 3 = 33.33 * 3 = 99.99), so equal_split distributes the leftover cents
one-by-one to the first participants (largest-remainder method) instead of
just rounding each share independently.
"""

CENT = 0.01
EPSILON = 0.005  # tolerance when comparing money floats after rounding to cents


def to_cents(amount: float) -> int:
    return round(amount * 100)


def from_cents(cents: int) -> float:
    return cents / 100


def equal_split(total: float, member_ids: list[int]) -> dict[int, float]:
    """Split `total` equally across member_ids, returning member_id -> amount.

    Guarantees sum(result.values()) == round(total, 2) exactly (in cents).
    Extra cents (from the remainder of total_cents / n) go to the first
    members in `member_ids` order, so the split is deterministic.
    """
    if not member_ids:
        return {}
    n = len(member_ids)
    total_cents = to_cents(total)
    base_cents, remainder = divmod(total_cents, n)
    result: dict[int, float] = {}
    for i, member_id in enumerate(member_ids):
        cents = base_cents + (1 if i < remainder else 0)
        result[member_id] = from_cents(cents)
    return result


def shares_sum_matches_total(shares: dict[int, float], total: float) -> bool:
    """True if the manually-edited shares still add up to the expense total."""
    return abs(sum(shares.values()) - total) <= EPSILON


def rebalance_remainder(shares: dict[int, float], total: float) -> dict[int, float]:
    """Nudge the last share so the sum matches `total` exactly (fixes float drift)."""
    if not shares:
        return shares
    total_cents = to_cents(total)
    cents = {mid: to_cents(amt) for mid, amt in shares.items()}
    diff = total_cents - sum(cents.values())
    if diff != 0:
        last_key = list(cents.keys())[-1]
        cents[last_key] += diff
    return {mid: from_cents(c) for mid, c in cents.items()}
