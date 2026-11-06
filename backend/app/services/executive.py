"""Business metrics for the CMO view (/executive). Pure functions, no I/O.

Input is a daily series per client built from the GA4 Data API (see
ga4_reports.py). Everything is computed over *complete* days only: `end` is
yesterday in the client's timezone, because today's GA4 data is partial.

Sessions are used as the traffic measure (they add up across days; daily
active users do not). The conversion measure is `purchases` when the property
reports ecommerce purchases, otherwise GA4 key events (`conversions`).
"""

from datetime import date, timedelta

METRICS = ("sessions", "conversions", "purchases", "revenue")

BASELINE_DAYS = 14       # clean days before a promo used as its baseline
BASELINE_LOOKBACK = 42   # how far back we search for those clean days
BASELINE_MIN_DAYS = 5    # below this, a lift number would be noise
PROMO_LOOKBACK = 30      # report promos active in the last N days


def empty_day(d: date) -> dict:
    return {"date": d.isoformat(), **{m: 0 for m in METRICS}}


def fill_series(rows: dict[date, dict], end: date, days: int) -> list[dict]:
    """Dense series of `days` days ending on `end` (inclusive); missing days are zero."""
    out = []
    for i in range(days - 1, -1, -1):
        d = end - timedelta(days=i)
        row = empty_day(d)
        row.update({m: rows.get(d, {}).get(m, 0) for m in METRICS})
        out.append(row)
    return out


def window_sum(series: list[dict], end: date, days: int, offset: int = 0) -> dict:
    """Sum of metrics over the `days` days ending `offset` days before `end`."""
    last = end - timedelta(days=offset)
    first = last - timedelta(days=days - 1)
    totals = {m: 0.0 for m in METRICS}
    for row in series:
        d = date.fromisoformat(row["date"])
        if first <= d <= last:
            for m in METRICS:
                totals[m] += row[m]
    return totals


def conversion_key(series: list[dict]) -> str:
    return "purchases" if any(r["purchases"] > 0 for r in series) else "conversions"


def rate(num: float, den: float) -> float | None:
    return num / den if den > 0 else None


def promo_dates(start: date, end: date) -> set[date]:
    return {start + timedelta(days=i) for i in range((end - start).days + 1)}


def promo_lift(
    series: list[dict],
    start: date,
    finish: date,
    end: date,
    busy: set[date],
    conv_key: str,
) -> dict | None:
    """Average daily performance during a promo vs. clean days just before it.

    `busy` holds every date on which the client had any promo; those days are
    excluded from the baseline so one promo isn't measured against another.
    Returns None when the promo hasn't started yet or there is no usable baseline.
    """
    by_date = {date.fromisoformat(r["date"]): r for r in series}
    promo_days = [d for d in promo_dates(start, min(finish, end)) if d in by_date]
    if not promo_days:
        return None

    baseline: list[date] = []
    d = start - timedelta(days=1)
    while len(baseline) < BASELINE_DAYS and (start - d).days <= BASELINE_LOOKBACK:
        if d in by_date and d not in busy:
            baseline.append(d)
        d -= timedelta(days=1)
    if len(baseline) < BASELINE_MIN_DAYS:
        return None

    def avg(days: list[date], m: str) -> float:
        return sum(by_date[x][m] for x in days) / len(days)

    out: dict = {"days_measured": len(promo_days), "baseline_days": len(baseline)}
    for label, m in (("sessions", "sessions"), ("conversions", conv_key), ("revenue", "revenue")):
        during, base = avg(promo_days, m), avg(baseline, m)
        out[label] = {"during": round(during, 2), "baseline": round(base, 2),
                      "lift": round(during / base - 1, 4) if base > 0 else None}
    return out


def client_kpis(series: list[dict], end: date, window: int = 7) -> dict:
    """Current window vs. the previous one, plus conversion rate."""
    key = conversion_key(series)
    cur = window_sum(series, end, window)
    prev = window_sum(series, end, window, offset=window)
    has_revenue = any(r["revenue"] > 0 for r in series)
    return {
        "conversion_key": key,
        "has_revenue": has_revenue,
        "sessions": {"cur": cur["sessions"], "prev": prev["sessions"]},
        "conversions": {"cur": cur[key], "prev": prev[key]},
        "revenue": {"cur": cur["revenue"], "prev": prev["revenue"]} if has_revenue else None,
        "conversion_rate": {"cur": rate(cur[key], cur["sessions"]), "prev": rate(prev[key], prev["sessions"])},
        "avg_order_value": {
            "cur": rate(cur["revenue"], cur["purchases"]),
            "prev": rate(prev["revenue"], prev["purchases"]),
        } if has_revenue and key == "purchases" else None,
        "revenue_per_session": {
            "cur": rate(cur["revenue"], cur["sessions"]),
            "prev": rate(prev["revenue"], prev["sessions"]),
        } if has_revenue else None,
    }


def ecosystem_kpis(clients: list[dict]) -> dict:
    """Roll-up over clients that returned data.

    Revenue is grouped by currency (clients sell in ARS, MXN, ... and there is
    no FX source). Purchases and purchase rate only count ecommerce clients,
    so a client that reports key events instead doesn't dilute the rate.
    """
    ok = [c for c in clients if c.get("kpis")]
    ecom = [c for c in ok if c["kpis"]["conversion_key"] == "purchases"]

    def total(group: list[dict], field: str, period: str) -> float:
        return sum(c["kpis"][field][period] for c in group)

    revenue: dict[str, dict] = {}
    for c in ok:
        r = c["kpis"]["revenue"]
        if r:
            cur = revenue.setdefault(c.get("currency") or "?", {
                "cur": 0.0, "prev": 0.0, "clients": 0,
                "sessions": {"cur": 0.0, "prev": 0.0}, "orders": {"cur": 0.0, "prev": 0.0},
            })
            cur["cur"] += r["cur"]
            cur["prev"] += r["prev"]
            cur["clients"] += 1
            for p in ("cur", "prev"):
                cur["sessions"][p] += c["kpis"]["sessions"][p]
                if c["kpis"]["conversion_key"] == "purchases":
                    cur["orders"][p] += c["kpis"]["conversions"][p]
    for g in revenue.values():
        # Ticket and revenue per session per currency — never mixed across currencies
        g["avg_order_value"] = {p: rate(g[p], g["orders"][p]) for p in ("cur", "prev")}
        g["revenue_per_session"] = {p: rate(g[p], g["sessions"][p]) for p in ("cur", "prev")}
        del g["sessions"], g["orders"]

    return {
        "clients_with_data": len(ok),
        "ecommerce_clients": len(ecom),
        "sessions": {p: total(ok, "sessions", p) for p in ("cur", "prev")},
        "purchases": {p: total(ecom, "conversions", p) for p in ("cur", "prev")},
        "purchase_rate": {
            p: rate(total(ecom, "conversions", p), total(ecom, "sessions", p)) for p in ("cur", "prev")
        },
        "revenue": [{"currency": k, **v} for k, v in sorted(revenue.items(), key=lambda kv: -kv[1]["cur"])],
    }


# ── Month to date + projection ────────────────────────────────────────────────

def _days_in_month(y: int, m: int) -> int:
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - timedelta(days=1)).day


def month_to_date(series: list[dict], end: date) -> dict:
    """Month of `end` from day 1 to `end`, vs. the same days of the previous month.

    The projection is a straight run-rate (MTD / days elapsed × days in month):
    simple and explainable; it doesn't know about promos still to come.
    When `end` is the last day of the month the projection equals the actual.
    """
    first = end.replace(day=1)
    elapsed = end.day
    total_days = _days_in_month(end.year, end.month)
    prev_last = first - timedelta(days=1)
    prev_first = prev_last.replace(day=1)
    prev_end = prev_first.replace(day=min(elapsed, prev_last.day))

    cur = window_sum(series, end, elapsed)
    prev = window_sum(series, prev_end, (prev_end - prev_first).days + 1)
    factor = total_days / elapsed
    return {
        "month": first.isoformat()[:7],
        "days_elapsed": elapsed,
        "days_in_month": total_days,
        "cur": cur,
        "prev": prev,
        "prev_full": window_sum(series, prev_last, prev_last.day),
        "projection": {m: round(cur[m] * factor, 2) for m in METRICS},
    }


def ecosystem_mtd(clients: list[dict]) -> dict | None:
    """Month to date summed over clients; revenue grouped per currency."""
    ok = [c for c in clients if c.get("mtd") and c.get("kpis")]
    if not ok:
        return None
    ecom = [c for c in ok if c["kpis"]["conversion_key"] == "purchases"]
    periods = ("cur", "prev", "projection", "prev_full")

    def total(group: list[dict], period: str, m: str) -> float:
        return sum(c["mtd"][period][m] for c in group)

    revenue: dict[str, dict] = {}
    for c in ok:
        if not c["kpis"]["has_revenue"]:
            continue
        g = revenue.setdefault(c.get("currency") or "?", {p: 0.0 for p in periods})
        for p in periods:
            g[p] += c["mtd"][p]["revenue"]
    first = ok[0]["mtd"]
    return {
        "month": first["month"],
        "days_elapsed": first["days_elapsed"],
        "days_in_month": first["days_in_month"],
        "sessions": {p: total(ok, p, "sessions") for p in periods},
        "purchases": {p: total(ecom, p, "purchases") for p in periods},
        "revenue": [{"currency": k, **v} for k, v in sorted(revenue.items(), key=lambda kv: -kv[1]["cur"])],
    }


def ecosystem_daily(clients: list[dict], days: int) -> list[dict]:
    """Daily totals over clients for the last `days` days of each client's series.

    `clients` items carry `daily` (the filled daily series), `kpis` and `currency`.
    Purchases only count clients that report ecommerce, like `ecosystem_kpis`;
    revenue is kept per currency (no FX conversion).
    """
    out: dict[str, dict] = {}
    for c in clients:
        if not c.get("kpis") or not c.get("daily"):
            continue
        ecom = c["kpis"]["conversion_key"] == "purchases"
        cur = c.get("currency") or "?"
        for d in c["daily"][-days:]:
            row = out.setdefault(d["date"], {"date": d["date"], "sessions": 0.0, "purchases": 0.0, "revenue": {}})
            row["sessions"] += d["sessions"]
            if ecom:
                row["purchases"] += d["purchases"]
            if c["kpis"]["has_revenue"]:
                row["revenue"][cur] = row["revenue"].get(cur, 0.0) + d["revenue"]
    return [out[k] for k in sorted(out)]


# ── Promo ranking ─────────────────────────────────────────────────────────────

def promo_ranking(results: list[dict]) -> list[dict]:
    """Summary per promo type over measured promos.

    avg_* is the plain mean of per-promo lifts; win_rate is the share of promos
    whose conversions went up vs. their baseline.
    """
    groups: dict[str, list[dict]] = {}
    for r in results:
        groups.setdefault(r["promo_type"], []).append(r)
    out = []
    for ptype, rows in groups.items():
        conv = [r["conversions"]["lift"] for r in rows if r["conversions"]["lift"] is not None]
        rev = [r["revenue"]["lift"] for r in rows if r["revenue"]["lift"] is not None]
        out.append({
            "promo_type": ptype,
            "count": len(rows),
            "avg_conversion_lift": round(sum(conv) / len(conv), 4) if conv else None,
            "avg_revenue_lift": round(sum(rev) / len(rev), 4) if rev else None,
            "win_rate": round(sum(1 for x in conv if x > 0) / len(conv), 4) if conv else None,
        })
    out.sort(key=lambda g: -(g["avg_conversion_lift"] if g["avg_conversion_lift"] is not None else -1e9))
    return out


# ── Traffic quality per campaign ──────────────────────────────────────────────

QUALITY_MIN_SESSIONS = 100     # below this a campaign is too small to judge
LOW_ENGAGEMENT_RATE = 0.20     # GA4 engagement rate; healthy sites are usually 50–70%
VERY_LOW_ENGAGEMENT_RATE = 0.08
LOW_SECONDS_PER_SESSION = 5.0


def traffic_quality(row: dict, conv_key: str) -> dict:
    """Heuristic over GA4 engagement: a low engaged-session share, almost no time
    on site and no conversions on a sizeable campaign are what bot or junk
    traffic looks like. Score ≥4 → likely, ≥2 → possible (same scale as bot_detection)."""
    sessions = row.get("sessions", 0)
    er = rate(row.get("engaged_sessions", 0), sessions)
    secs = rate(row.get("engagement_seconds", 0), sessions)
    out = {"engagement_rate": er, "seconds_per_session": secs, "score": 0, "level": "ok", "reasons": []}
    if sessions < QUALITY_MIN_SESSIONS or er is None:
        out["level"] = "insufficient"
        return out
    score, reasons = 0, []
    if er < VERY_LOW_ENGAGEMENT_RATE:
        score += 3
        reasons.append(f"solo {er:.0%} de sesiones con interacción")
    elif er < LOW_ENGAGEMENT_RATE:
        score += 2
        reasons.append(f"{er:.0%} de sesiones con interacción")
    if secs is not None and secs < LOW_SECONDS_PER_SESSION:
        score += 2
        reasons.append(f"{secs:.1f} s de interacción por sesión")
    if row.get(conv_key, 0) == 0 and sessions >= 3 * QUALITY_MIN_SESSIONS:
        score += 1
        reasons.append("ninguna conversión")
    out.update(score=score, reasons=reasons,
               level="likely" if score >= 4 else "possible" if score >= 2 else "ok")
    return out


# ── Ecommerce funnel and segments ─────────────────────────────────────────────

FUNNEL_LABELS = (
    ("view_item", "Vio producto"),
    ("add_to_cart", "Agregó al carrito"),
    ("begin_checkout", "Inició checkout"),
    ("purchase", "Compró"),
)


def funnel_steps(events: dict[str, float] | None) -> dict | None:
    """Event-count funnel. `from_prev` is each step vs. the previous non-zero one
    (can exceed 100% when a site fires add_to_cart without view_item, so the UI
    caps bars). cart_abandonment = 1 − purchases / add_to_cart."""
    if not events or not events.get("purchase"):
        return None
    steps, prev = [], None
    for key, label in FUNNEL_LABELS:
        n = events.get(key, 0)
        steps.append({"event": key, "label": label, "count": n,
                      "from_prev": rate(n, prev) if prev else None})
        prev = n or prev
    carts = events.get("add_to_cart", 0)
    return {
        "steps": steps,
        "cart_abandonment": round(max(0.0, 1 - events["purchase"] / carts), 4) if carts else None,
        "view_to_purchase": rate(events["purchase"], events.get("view_item", 0)),
    }


def segment_rows(rows: list[dict], conv_key: str) -> list[dict]:
    """Device / new-vs-returning rows with share of sessions and conversion rate."""
    total = sum(r["sessions"] for r in rows)
    return [{
        **r,
        "share": rate(r["sessions"], total),
        "conversion_rate": rate(r.get(conv_key, 0), r["sessions"]),
        "engagement_rate": rate(r.get("engaged_sessions", 0), r["sessions"]),
    } for r in rows]


# ── Deploy calendar load ──────────────────────────────────────────────────────

def calendar_load(day_status: dict[date, str], today: date) -> dict:
    """Counts of BLOQUEADO / RESTRINGIDO days in the month, split into already
    elapsed (through today) and still scheduled (after today)."""
    out = {"blocked_past": 0, "blocked_ahead": 0, "restricted_past": 0, "restricted_ahead": 0,
           "days_in_month": len(day_status)}
    for d, status in day_status.items():
        when = "past" if d <= today else "ahead"
        if status == "BLOQUEADO":
            out[f"blocked_{when}"] += 1
        elif status == "RESTRINGIDO":
            out[f"restricted_{when}"] += 1
    return out


# ── Alerts and weekly digest ──────────────────────────────────────────────────

ALERT_DROP = 0.20
ALERT_MIN_SESSIONS = 500
ALERT_MIN_CONVERSIONS = 10


def pct_change(cur: float | None, prev: float | None) -> float | None:
    return cur / prev - 1 if cur is not None and prev else None


def alerts(clients: list[dict]) -> list[dict]:
    """Week-over-week drops of ALERT_DROP or more on clients big enough to matter."""
    out = []
    for c in clients:
        k = c.get("kpis")
        if not k or k["sessions"]["prev"] < ALERT_MIN_SESSIONS:
            continue
        checks = [("sessions", "Sesiones", k["sessions"])]
        if k["conversions"]["prev"] >= ALERT_MIN_CONVERSIONS:
            label = "Compras" if k["conversion_key"] == "purchases" else "Conversiones"
            checks.append(("conversions", label, k["conversions"]))
        if k["revenue"]:
            checks.append(("revenue", "Ingresos", k["revenue"]))
        for metric, label, pair in checks:
            d = pct_change(pair["cur"], pair["prev"])
            if d is not None and d <= -ALERT_DROP:
                out.append({"client_id": c["client_id"], "client_name": c["client_name"],
                            "metric": metric, "label": label, "change": round(d, 4)})
    out.sort(key=lambda a: a["change"])
    return out


def _pct(v: float | None) -> str:
    return "—" if v is None else f"{'+' if v > 0 else ''}{v * 100:.0f}%"


def _int(v: float) -> str:
    return f"{v:,.0f}".replace(",", ".")


def _money(v: float, currency: str) -> str:
    return f"{currency} {_int(v)}"


def digest_text(overview: dict, base_url: str | None = None) -> str:
    """Google Chat message (plain text with *bold*) summarising the CMO view."""
    eco = overview["ecosystem"]
    lines = ["📈 *Resumen semanal de negocio*", "_Últimos 7 días completos vs. los 7 anteriores_", ""]

    for r in eco["revenue"]:
        lines.append(f"💰 Ingresos {r['currency']}: *{_money(r['cur'], r['currency'])}* "
                     f"({_pct(pct_change(r['cur'], r['prev']))})")
    if eco["ecommerce_clients"]:
        p = eco["purchases"]
        lines.append(f"🛒 Compras: *{_int(p['cur'])}* ({_pct(pct_change(p['cur'], p['prev']))})")
    s = eco["sessions"]
    lines.append(f"👥 Sesiones: *{_int(s['cur'])}* ({_pct(pct_change(s['cur'], s['prev']))})")

    mtd = overview.get("mtd")
    if mtd and mtd["revenue"]:
        lines += ["", f"📅 *Mes en curso* (día {mtd['days_elapsed']} de {mtd['days_in_month']})"]
        for r in mtd["revenue"]:
            lines.append(f"• {r['currency']}: {_money(r['cur'], r['currency'])} "
                         f"({_pct(pct_change(r['cur'], r['prev']))} vs. mismo período del mes anterior) "
                         f"· proyección {_money(r['projection'], r['currency'])}")

    promos = [p for c in overview["clients"] for p in c.get("promo_results", [])
              if p["conversions"]["lift"] is not None]
    if promos:
        promos.sort(key=lambda p: p["conversions"]["lift"], reverse=True)
        best, worst = promos[0], promos[-1]
        lines += ["", "🎯 *Promociones (últimos 30 días)*",
                  f"• Mejor: {best.get('description') or 'promo'} ({best['client_name']}) "
                  f"{_pct(best['conversions']['lift'])} conversiones/día"]
        if worst is not best and worst["conversions"]["lift"] < 0:
            lines.append(f"• Peor: {worst.get('description') or 'promo'} ({worst['client_name']}) "
                         f"{_pct(worst['conversions']['lift'])} conversiones/día")

    al = overview.get("alerts") or []
    if al:
        lines += ["", f"⚠️ *Alertas (caídas de {ALERT_DROP:.0%} o más)*"]
        lines += [f"• {a['client_name']}: {a['label'].lower()} {_pct(a['change'])}" for a in al[:8]]

    suspicious = overview.get("suspicious_campaigns") or []
    if suspicious:
        lines += ["", "🤖 *Campañas con tráfico de baja calidad*"]
        lines += [f"• {s['client_name']}: {s['campaign']} ({_int(s['sessions'])} sesiones)" for s in suspicious[:5]]

    upcoming = overview.get("upcoming") or []
    if upcoming:
        lines += ["", f"🗓️ {len(upcoming)} promo{'s' if len(upcoming) > 1 else ''} en los próximos 14 días"]

    if base_url:
        lines += ["", f"Ver detalle: {base_url.rstrip('/')}/executive"]
    return "\n".join(lines)
