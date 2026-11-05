"""Unit tests for GA4 access merging (no network)."""

from app.services.ga4_access import merge_access


def b(user, *roles):
    return {"user": user, "roles": [f"predefinedRoles/{r}" for r in roles]}


def test_property_only_user():
    out = merge_access([b("Ana@x.com", "viewer")], [])
    assert out == [{
        "email": "ana@x.com", "role": "Lector", "role_level": 1,
        "property_roles": ["Lector"], "account_roles": [], "restrictions": [], "source": "property",
    }]


def test_account_role_wins_when_higher():
    out = merge_access([b("a@x.com", "viewer")], [b("a@x.com", "admin")])
    assert out[0]["role"] == "Administrador"
    assert out[0]["source"] == "property+account"
    assert out[0]["property_roles"] == ["Lector"] and out[0]["account_roles"] == ["Administrador"]


def test_restrictions_are_separate_from_role():
    out = merge_access([b("a@x.com", "analyst", "no-revenue-data", "no-cost-data")], [])
    assert out[0]["role"] == "Analista"
    assert out[0]["restrictions"] == ["Sin datos de costos", "Sin datos de ingresos"]


def test_sorted_by_role_then_email_and_skips_non_user_bindings():
    out = merge_access(
        [b("z@x.com", "viewer"), b("b@x.com", "editor"), {"roles": ["predefinedRoles/admin"]}],
        [b("a@x.com", "viewer")],
    )
    assert [u["email"] for u in out] == ["b@x.com", "a@x.com", "z@x.com"]
    assert out[1]["source"] == "account"


def test_only_restriction_has_no_role():
    out = merge_access([b("a@x.com", "no-cost-data")], [])
    assert out[0]["role"] == "—" and out[0]["role_level"] == 0
