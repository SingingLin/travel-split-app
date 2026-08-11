from app.services.settlement import compute_settlement, simplify_debts

MEMBERS = [
    {"id": 1, "name": "Singing", "color": "#14b8a6"},
    {"id": 2, "name": "Singwell", "color": "#f59e0b"},
    {"id": 3, "name": "Lia", "color": "#8b5cf6"},
]


def test_mockup_scenario_matches_design_numbers():
    """Reproduces the numbers shown in mockups/04-settlement.html so the
    engine's output lines up with what Design already signed off on."""
    expenses = [
        # Singing paid 18,900 total across the trip, split evenly among all 3
        # in various expenses; Singwell paid 12,600; Lia paid 11,100.
        {
            "payer_id": 1,
            "amount": 18900.0,
            "needs_split": True,
            "shares": [
                {"member_id": 1, "amount": 13240.0},
                {"member_id": 2, "amount": 3180.0},
                {"member_id": 3, "amount": 2480.0},
            ],
        },
        {"payer_id": 2, "amount": 12600.0, "needs_split": False, "shares": []},
        {"payer_id": 3, "amount": 11100.0, "needs_split": False, "shares": []},
    ]
    result = compute_settlement(MEMBERS, expenses)
    by_id = {m["member_id"]: m for m in result["members"]}

    assert by_id[1]["total_owed"] == 13240.0
    assert by_id[1]["total_paid"] == 18900.0
    assert by_id[1]["net"] == 5660.0

    assert by_id[2]["total_owed"] == 12600.0 + 3180.0
    assert by_id[2]["total_paid"] == 12600.0
    assert by_id[2]["net"] == -3180.0

    assert by_id[3]["total_owed"] == 11100.0 + 2480.0
    assert by_id[3]["total_paid"] == 11100.0
    assert by_id[3]["net"] == -2480.0

    transfers = {(t["from_member_id"], t["to_member_id"]): t["amount"] for t in result["suggested_transfers"]}
    assert transfers[(2, 1)] == 3180.0
    assert transfers[(3, 1)] == 2480.0
    assert len(result["suggested_transfers"]) == 2


def test_net_balances_always_sum_to_zero():
    expenses = [
        {
            "payer_id": 1,
            "amount": 300.0,
            "needs_split": True,
            "shares": [
                {"member_id": 1, "amount": 100.0},
                {"member_id": 2, "amount": 100.0},
                {"member_id": 3, "amount": 100.0},
            ],
        },
        {
            "payer_id": 2,
            "amount": 50.0,
            "needs_split": True,
            "shares": [{"member_id": 1, "amount": 25.0}, {"member_id": 2, "amount": 25.0}],
        },
        {"payer_id": 3, "amount": 40.0, "needs_split": False, "shares": []},
    ]
    result = compute_settlement(MEMBERS, expenses)
    total_net = sum(m["net"] for m in result["members"])
    assert abs(total_net) < 0.01


def test_suggested_transfers_balance_matches_net_debts():
    expenses = [
        {
            "payer_id": 1,
            "amount": 100.0,
            "needs_split": True,
            "shares": [
                {"member_id": 1, "amount": 34.0},
                {"member_id": 2, "amount": 33.0},
                {"member_id": 3, "amount": 33.0},
            ],
        },
    ]
    result = compute_settlement(MEMBERS, expenses)
    # Singing net = +66, Singwell net = -33, Lia net = -33
    by_id = {m["member_id"]: m for m in result["members"]}
    assert by_id[1]["net"] == 66.0
    assert by_id[2]["net"] == -33.0
    assert by_id[3]["net"] == -33.0

    total_transferred = sum(t["amount"] for t in result["suggested_transfers"])
    total_creditor_net = sum(m["net"] for m in result["members"] if m["net"] > 0)
    assert abs(total_transferred - total_creditor_net) < 0.01


def test_matrix_uses_net_pairwise_amounts_not_raw():
    # A pays for B (50) and B separately pays for A (20) -> matrix should show
    # a single netted relationship: B owes A 30, not two raw entries.
    members = MEMBERS[:2]
    expenses = [
        {
            "payer_id": 1,
            "amount": 100.0,
            "needs_split": True,
            "shares": [{"member_id": 1, "amount": 50.0}, {"member_id": 2, "amount": 50.0}],
        },
        {
            "payer_id": 2,
            "amount": 40.0,
            "needs_split": True,
            "shares": [{"member_id": 1, "amount": 20.0}, {"member_id": 2, "amount": 20.0}],
        },
    ]
    result = compute_settlement(members, expenses)
    assert len(result["matrix"]) == 1
    cell = result["matrix"][0]
    assert cell["debtor_id"] == 2
    assert cell["creditor_id"] == 1
    assert cell["amount"] == 30.0
    assert result["raw_relationship_count"] == 1


def test_simplify_debts_zero_sum_never_leaves_residual():
    net = {1: 66.0, 2: -33.0, 3: -33.0, 4: 0.0}
    transfers = simplify_debts(net)
    assert len(transfers) <= 3
    incoming = sum(t["amount"] for t in transfers if t["to_member_id"] == 1)
    assert incoming == 66.0


def test_no_expenses_no_transfers():
    result = compute_settlement(MEMBERS, [])
    assert result["suggested_transfers"] == []
    assert result["matrix"] == []
    assert all(m["net"] == 0.0 for m in result["members"])


# ---------- type="income" ----------
# See the module docstring in services/settlement.py for the full design
# rationale (signed_amount/signed_share_amount). Summary: an income row's
# contribution to `paid`/`owed` is the exact negation of what the same
# numbers would contribute as an expense, applied uniformly to both the
# split-shares branch and the personal (non-split) branch — that symmetry is
# what guarantees sum(net) always stays exactly 0 for ANY mix of
# split/non-split expenses/incomes (every single transaction's own
# paid-delta/owed-delta cancel out on their own, so any combination of them
# does too). One consequence: a personal (non-split) income is net-neutral
# for its receiver, exactly like a personal (non-split) expense already is —
# both move `paid` and `owed` by the same signed amount, so `net` is
# unaffected. A *split* income, however, does shift `net` for the members
# it's shared with (see test_split_income_reduces_shared_members_owed_and_
# raises_their_net below) — that's the "大家共享的退款" case.
def test_personal_income_reduces_payer_total_paid_and_is_net_neutral():
    expenses = [
        {"payer_id": 1, "amount": 200.0, "needs_split": False, "type": "income", "shares": []},
    ]
    result = compute_settlement(MEMBERS, expenses)
    by_id = {m["member_id"]: m for m in result["members"]}
    assert by_id[1]["total_paid"] == -200.0
    # Symmetric with total_owed (see rationale above) -> net unaffected by a
    # purely personal income, same as a purely personal expense already is.
    assert by_id[1]["total_owed"] == -200.0
    assert by_id[1]["net"] == 0.0
    # Nobody else is touched by a personal (non-split) transaction.
    assert by_id[2]["net"] == 0.0
    assert by_id[3]["net"] == 0.0


def test_split_income_reduces_shared_members_owed_and_raises_their_net():
    # Singing collects a 300 refund (e.g. a deposit return) shared equally
    # among all 3 members ("大家共享的退款").
    expenses = [
        {
            "payer_id": 1,
            "amount": 300.0,
            "needs_split": True,
            "type": "income",
            "shares": [
                {"member_id": 1, "amount": 100.0},
                {"member_id": 2, "amount": 100.0},
                {"member_id": 3, "amount": 100.0},
            ],
        },
    ]
    result = compute_settlement(MEMBERS, expenses)
    by_id = {m["member_id"]: m for m in result["members"]}

    # total_owed drops for every member the income is split among, including
    # the receiver themselves (their own 100-unit share of it).
    assert by_id[1]["total_owed"] == -100.0
    assert by_id[2]["total_owed"] == -100.0
    assert by_id[3]["total_owed"] == -100.0

    # Members 2 and 3 didn't receive any money (total_paid unchanged at 0)
    # but now owe 100 less each -> their net rises accordingly (they're
    # better off: the group refund benefits them without them having
    # collected/held any of the cash personally).
    assert by_id[2]["total_paid"] == 0.0
    assert by_id[2]["net"] == 100.0
    assert by_id[3]["total_paid"] == 0.0
    assert by_id[3]["net"] == 100.0

    # The receiver (member 1) collected the full 300 (total_paid -300) but
    # only got owed-credit for their own 100 share, so their net ends up
    # -200: they're holding 200 that isn't theirs and still needs to reach
    # members 2 and 3.
    assert by_id[1]["total_paid"] == -300.0
    assert by_id[1]["net"] == -200.0


def test_mixed_expense_and_income_net_always_sums_to_zero():
    """The core invariant this app has always guaranteed (see
    test_net_balances_always_sum_to_zero above for the expense-only version)
    must keep holding once income rows are mixed in, in any combination of
    split/non-split expenses and incomes."""
    expenses = [
        # Singing pays for a shared dinner.
        {
            "payer_id": 1,
            "amount": 300.0,
            "needs_split": True,
            "type": "expense",
            "shares": [
                {"member_id": 1, "amount": 100.0},
                {"member_id": 2, "amount": 100.0},
                {"member_id": 3, "amount": 100.0},
            ],
        },
        # Singwell buys herself a personal souvenir.
        {"payer_id": 2, "amount": 50.0, "needs_split": False, "type": "expense", "shares": []},
        # Lia collects a personal cashback unrelated to the group.
        {"payer_id": 3, "amount": 20.0, "needs_split": False, "type": "income", "shares": []},
        # Singing collects a shared hotel-deposit refund, split with Lia only.
        {
            "payer_id": 1,
            "amount": 80.0,
            "needs_split": True,
            "type": "income",
            "shares": [{"member_id": 1, "amount": 40.0}, {"member_id": 3, "amount": 40.0}],
        },
    ]
    result = compute_settlement(MEMBERS, expenses)
    total_net = sum(m["net"] for m in result["members"])
    assert abs(total_net) < 0.01

    # Also sanity-check the transfer suggestions built from `net` stay
    # internally consistent (their total in = total out, same check the
    # expense-only test_suggested_transfers_balance_matches_net_debts does).
    total_transferred = sum(t["amount"] for t in result["suggested_transfers"])
    total_creditor_net = sum(m["net"] for m in result["members"] if m["net"] > 0)
    assert abs(total_transferred - total_creditor_net) < 0.01
