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
