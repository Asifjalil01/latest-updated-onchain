#!/usr/bin/env python3
"""
Multi-source new-launch sniper (PAPER & LIVE MODES).
Sources: GeckoTerminal new pools (ALL Solana DEXes), Jupiter recent, DexScreener
profiles (+optional boosted), PumpPortal new launches.
Rug screen: on-chain mint/freeze authority (Solana RPC) + Jupiter audit + RugCheck.
Entry: coins younger than max_age_minutes; coins younger than ultra_early_grace_sec
skip the liquidity/buy-volume floors (true "first seconds" entries).
"""
from concurrent.futures import ThreadPoolExecutor
import csv
import inspect
import io
import json
import math
import os
import re
import shutil
import signal
import sys
import threading
import time
from datetime import datetime
import requests

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass

CONFIG = {
    "mode": "paper",
    "start_balance_usd": 50.0, "trade_size_usd": 5.0, "max_open_positions": 3,
    "daily_loss_limit_usd": 10.0,
    "take_profit_pct": 25.0, "stop_loss_pct": 20.0, "trailing_stop_pct": 8.0, "max_hold_minutes": 60,
    "recover_principal_enabled": False,
    "recover_principal_sell_pct": 50.0,
    "scale_out_sell_pct": 25.0,
    "scale_out_step_gain_pct": 100.0,
    "auto_rug_exit": False,
    "rug_liq_drop_pct": 50.0,
    # sniper window: buy ONLY coins inside [min_age_minutes, max_age_minutes]
    "min_age_minutes": 0.0,
    "max_age_minutes": 2.0,
    # coins younger than this skip liquidity/volume floors (0 = strict anti-rug from second 0)
    "ultra_early_grace_sec": 0,
    # scan speed
    "scan_interval_sec": 1, "monitor_interval_sec": 1.0,
    # entry guards (applied after the grace window)
    "min_liquidity_usd": 5000.0, "min_volume_m5_usd": 2000.0,
    "min_buys_m5": 8, "min_buy_sell_ratio_m5": 1.5,
    "min_recent_buys_60s": 3,
    "max_price_change_m5_pct": 200.0,
    "min_holders": 0,
    # hard rug screen & owner/creator history
    "use_rugcheck": True, "strict_rugcheck": True, "require_lp_locked": False,
    "block_insider_bundles": True, "block_creator_dump": True, "max_dev_hold_pct": 5.0,
    "rugcheck_max_score": 55.0, "max_top10_holder_pct": 35.0, "rug_recheck_minutes": 15,
    "check_creator_history": True, "max_creator_launches": 5,
    "max_creator_rugged_coins": 0, "creator_fast_rug_window_min": 60.0,
    # candidate sources & website filters (empty = all websites)
    "use_gecko": True, "use_jupiter_recent": True, "use_dex_profiles": True,
    "use_pumpportal": True, "use_promoted_feeds": False,
    "enabled_platforms": [],
    # execution & speed
    "slippage_pct": 3.0, "fee_pct": 1.0,
    "priority_fee_tier": "fast", "jito_tip_sol": 0.0002,
    "custom_rpc_url": "",
    "fast_live_buy_enabled": True,
    "parallel_rug_screen_enabled": True,
    "jupiter_quota_guard_enabled": True,
    "direct_dex_fallback_enabled": True,
    "anti_rug_tight_score_enabled": False,
    "anti_rug_pool_depth_check_enabled": True,
    "anti_rug_sell_sim_enabled": False,
    "anti_rug_copycat_cooldown_enabled": True,
    "early_rug_shield_enabled": True,
    "axiom_pulse_migrated_only_enabled": False,
    # Pro Desk — Group 1: Deeper Wallet & Scam Intelligence
    "anti_sybil_enabled": True,
    "fresh_wallet_minutes": 30.0,
    "max_shared_funder_count": 3,
    "smart_money_enabled": True,
    "smart_wallets": [],
    "smart_money_min_confluence": 1,
    "smart_money_size_boost_pct": 35.0,
    "smart_money_auto_exit_on_sell": True,
    "smart_money_auto_discover": True,
    "smart_money_max_wallets": 50,
    "smart_money_refresh_interval_sec": 30,
    "smart_money_scan_mode": "both",
    "smart_money_follow_older_coins": True,
    "smart_money_max_coin_age_hours": 72,
    "smart_money_prioritize_entries": True,
    "reused_socials_enabled": True,
    "max_social_reuse_count": 2,
    # Pro Desk — Group 2: Zero-Lag Exits & MEV / Wallet Sweep
    "ws_exit_stream_enabled": True,
    "jito_dontfront_enabled": True,
    "orphan_sweep_enabled": True,
    # Pro Desk — Group 3: Market Structure & Entry Timing
    "post_migration_pullback_enabled": False,
    "migration_min_dip_pct": 15.0,
    "migration_wait_sec": 45.0,
    "pre_migration_curve_enabled": False,
    "pre_migration_curve_min_pct": 75.0,
    "pre_migration_curve_max_pct": 92.0,
    "wash_trade_filter_enabled": True,
    "min_unique_makers_ratio": 0.25,
    "min_unique_traders_5m": 6,
    "sol_regime_filter_enabled": True,
    "sol_regime_max_drop_pct": 2.0,
    "sol_regime_action": "pause",
    "anti_top_wick_enabled": True,
    "max_short_spike_pct": 60.0,
    # Pro Desk — Group 4: Dynamic Sizing & Capital Efficiency
    "conviction_sizing_enabled": True,
    "conviction_min_mult": 0.6,
    "conviction_max_mult": 1.5,
    "streak_throttle_enabled": True,
    "streak_loss_limit": 2,
    "streak_cooldown_minutes": 15.0,
    "streak_action": "half_size",
    "narrative_cap_enabled": True,
    "max_same_narrative_positions": 1,
    # Pro Desk — Group 5: Solana Rent Reclaim
    "auto_reclaim_rent_enabled": True,
    "state_file": "state.json", "trades_csv": "trades.csv",
    "log_rejects": False, "jupiter_api_key": "",
    # per-option enable/disable toggles (true = enforce, false = ignore)
    "option_enabled": {
        "min_age_minutes": False,
        "early_rug_shield_enabled": True,
        "anti_sybil_enabled": True,
        "smart_money_enabled": True,
        "smart_money_auto_exit_on_sell": True,
        "smart_money_auto_discover": True,
        "smart_money_follow_older_coins": True,
        "smart_money_prioritize_entries": True,
        "reused_socials_enabled": True,
        "ws_exit_stream_enabled": True,
        "jito_dontfront_enabled": True,
        "orphan_sweep_enabled": True,
        "post_migration_pullback_enabled": False,
        "pre_migration_curve_enabled": False,
        "wash_trade_filter_enabled": True,
        "sol_regime_filter_enabled": True,
        "anti_top_wick_enabled": True,
        "conviction_sizing_enabled": True,
        "streak_throttle_enabled": True,
        "narrative_cap_enabled": True,
        "auto_reclaim_rent_enabled": True,
    },
    # compatibility keys kept so old settings files still load
    "cooldown_minutes": 60, "min_volume_h1_usd": 0.0,
    "max_age_hours": 24, "min_buys_h1": 0, "min_buy_sell_ratio_h1": 0.0,
    "use_jupiter_price": True, "use_real_swap_quotes": True,
    "pool_keep_hours": 1, "pool_max_size": 500,
    "rescan_delay_after_sell_sec": 0,
}

_BOOL_OPTION_KEYS = {
    "use_real_swap_quotes", "use_rugcheck", "strict_rugcheck", "require_lp_locked",
    "block_insider_bundles", "block_creator_dump", "check_creator_history",
    "auto_rug_exit", "recover_principal_enabled", "use_gecko", "use_jupiter_recent",
    "use_dex_profiles", "use_pumpportal", "use_promoted_feeds", "use_jupiter_price",
    "fast_live_buy_enabled", "parallel_rug_screen_enabled", "jupiter_quota_guard_enabled",
    "direct_dex_fallback_enabled", "anti_rug_tight_score_enabled",
    "anti_rug_pool_depth_check_enabled", "anti_rug_sell_sim_enabled",
    "anti_rug_copycat_cooldown_enabled", "early_rug_shield_enabled", "axiom_pulse_migrated_only_enabled", "log_rejects",
    "anti_sybil_enabled", "smart_money_enabled", "smart_money_auto_exit_on_sell",
    "smart_money_auto_discover", "smart_money_follow_older_coins", "smart_money_prioritize_entries",
    "reused_socials_enabled", "ws_exit_stream_enabled", "jito_dontfront_enabled",
    "orphan_sweep_enabled", "post_migration_pullback_enabled", "pre_migration_curve_enabled",
    "wash_trade_filter_enabled", "sol_regime_filter_enabled", "anti_top_wick_enabled",
    "conviction_sizing_enabled", "streak_throttle_enabled", "narrative_cap_enabled",
    "auto_reclaim_rent_enabled",
}

def opt_on(cfg, key, default=True):
    """Return True if option `key` is checked/active in option_enabled (or bool field)."""
    c = cfg or CONFIG
    oe = c.get("option_enabled")
    has_oe = isinstance(oe, dict) and (key in oe)
    if key in _BOOL_OPTION_KEYS:
        base = bool(c.get(key, default))
        return (bool(oe[key]) and base) if has_oe else base
    if has_oe:
        return bool(oe[key])
    return bool(default)

_settings_mtime = 0.0
_settings_lock = threading.Lock()
_scan_wake = threading.Event()
_stop_event = threading.Event()
_run_id = ""
_last_pid_check = 0.0
_cached_pid_alive = True

def _base_dir():
    return os.path.dirname(os.path.abspath(__file__))

def _settings_path():
    return os.path.join(_base_dir(), "settings.json")

def _stop_flag_path():
    return os.path.join(_base_dir(), "stop.flag")

def _pid_file_path():
    return os.path.join(_base_dir(), "bot.pid")

def _resolve_arg_run_id():
    for arg in sys.argv[1:]:
        if arg.startswith("--run-id="):
            return arg.split("=", 1)[1].strip()
    return (os.environ.get("SNIPER_RUN_ID") or "").strip()

def _should_stop():
    global _last_pid_check, _cached_pid_alive
    if _stop_event.is_set():
        return True
    if os.path.exists(_stop_flag_path()):
        _stop_event.set()
        return True
    if _run_id:
        now_ts = time.time()
        if now_ts - _last_pid_check >= 0.2:
            _last_pid_check = now_ts
            pf = _pid_file_path()
            try:
                if os.path.exists(pf):
                    with open(pf, "r", encoding="utf-8") as f:
                        info = json.load(f)
                    if isinstance(info, dict) and info.get("run_id") and info.get("run_id") != _run_id:
                        _cached_pid_alive = False
                        _stop_event.set()
                        return True
            except Exception:
                pass
        if not _cached_pid_alive:
            return True
    return False

def _interruptible_wait(seconds, wake_event=None):
    deadline = time.time() + max(0.0, seconds)
    while not _should_stop():
        remaining = deadline - time.time()
        if remaining <= 0:
            break
        step = min(0.15, remaining)
        if wake_event is not None:
            if wake_event.wait(step):
                wake_event.clear()
                break
        else:
            time.sleep(step)

def load_settings():
    global _settings_mtime
    sf = _settings_path()
    if os.path.exists(sf):
        try:
            st = os.stat(sf)
            with open(sf, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    with _settings_lock:
                        CONFIG.update(data)
                        _settings_mtime = st.st_mtime
        except Exception:
            pass

def maybe_reload_settings():
    global _settings_mtime
    sf = _settings_path()
    if not os.path.exists(sf):
        return False
    try:
        mtime = os.stat(sf).st_mtime
        if mtime > _settings_mtime:
            load_settings()
            with _seen_lock:
                _seen.clear()
                _too_old_mints.clear()
                _pending_dex_retry.clear()
            return True
    except Exception:
        pass
    return False

load_settings()

WSOL_MINT = "So11111111111111111111111111111111111111112"
DEX = "https://api.dexscreener.com"
GECKO = "https://api.geckoterminal.com/api/v2/networks/solana/new_pools"
JUP = "https://api.jup.ag/tokens/v2"
JUP_PRICE = "https://api.jup.ag/price/v3"
JUP_PRICE_LITE = "https://lite-api.jup.ag/price/v3"
JUP_QUOTE = "https://api.jup.ag/swap/v1/quote"
JUP_QUOTE_LITE = "https://lite-api.jup.ag/swap/v1/quote"
RUGC = "https://api.rugcheck.xyz/v1/tokens"
PUMPP = "https://api.pumpportal.fun/api/data"
RPC_URLS = [
    "https://solana-rpc.publicnode.com",
    "https://api.zan.top/solana-mainnet",
    "https://api.mainnet-beta.solana.com",
]

def _get_rpc_urls(cfg=None):
    c = cfg or CONFIG
    custom = str(c.get("custom_rpc_url") or "").strip() if opt_on(c, "custom_rpc_url", True) else ""
    if custom.startswith("http://") or custom.startswith("https://"):
        return [custom] + [u for u in RPC_URLS if u != custom]
    return list(RPC_URLS)
KNOWN_POOL_OR_BURN_OWNERS = {
    "11111111111111111111111111111111",
    "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
    "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL",
    "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
    "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",
    "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC",
    "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
    "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg",
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
}
DISALLOWED_TOKEN2022_EXTENSIONS = {
    "transferFeeConfig",
    "nonTransferable",
    "permanentDelegate",
    "transferHook",
}
HEADERS = {"User-Agent": "solana-launch-sniper/2.0", "Accept": "application/json"}
_session = requests.Session()

SEEN_TTL_SEC = 10

def now(): return datetime.now().astimezone()
def fmt_price(x):
    if x is None: return "n/a"
    x = float(x)
    if abs(x) >= 1: return f"{x:,.4f}"
    decimals = min(10, max(2, -math.floor(math.log10(abs(x))) + 5))
    return f"{x:.{decimals}f}"

def _f(x):
    try: return float(x)
    except (TypeError, ValueError): return None

CONSOLE_OUTPUT = True
LOG_HOOK = None
_live_active = False
_print_lock = threading.Lock()

def log(msg):
    global _live_active
    with _print_lock:
        if _live_active:
            width = shutil.get_terminal_size((120, 20)).columns - 1
            print("\r" + " " * width + "\r", end="")
            _live_active = False
        line = f"[{now().strftime('%H:%M:%S')}] {msg}"
        if CONSOLE_OUTPUT:
            try: print(line, flush=True)
            except UnicodeEncodeError: print(line.encode('ascii', 'replace').decode('ascii'), flush=True)
        if LOG_HOOK:
            try: LOG_HOOK(line)
            except: pass

def get_json(url, params=None, timeout=6, headers=None):
    try:
        r = _session.get(url, params=params, headers={**HEADERS, **(headers or {})}, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None

def _bridge_headers():
    token = (os.environ.get("SNIPER_BRIDGE_TOKEN") or "").strip()
    h = {**HEADERS, "Content-Type": "application/json"}
    if token:
        h["x-api-token"] = token
    return h

def _bridge_base_url():
    return (os.environ.get("SNIPER_BRIDGE_URL") or "").strip().rstrip("/")

def bridge_get(path, timeout=8):
    base = _bridge_base_url()
    if not base:
        return {"ok": False, "error": "Live bridge URL not configured"}
    try:
        r = _session.get(f"{base}{path}", headers=_bridge_headers(), timeout=timeout)
        return r.json()
    except Exception as e:
        return {"ok": False, "error": f"Bridge request failed: {e}"}

def bridge_post(path, payload, timeout=45):
    base = _bridge_base_url()
    if not base:
        return {"ok": False, "error": "Live bridge URL not configured"}
    try:
        r = _session.post(f"{base}{path}", json=payload, headers=_bridge_headers(), timeout=timeout)
        return r.json()
    except Exception as e:
        return {"ok": False, "error": f"Bridge request failed: {e}"}

_sol_cache = {"price": None, "updated_at": 0.0}
_sol_lock = threading.Lock()
_sol_regime_samples = []  # list of (ts_sec, price_usd)

def _record_sol_regime_sample(price, ts_sec=None):
    if not price or price <= 0:
        return
    t = ts_sec if ts_sec is not None else time.time()
    with _sol_lock:
        _sol_regime_samples.append((t, float(price)))
        cutoff = t - 1200.0  # keep rolling 20 minutes
        while _sol_regime_samples and _sol_regime_samples[0][0] < cutoff:
            _sol_regime_samples.pop(0)
        if len(_sol_regime_samples) > 400:
            del _sol_regime_samples[:len(_sol_regime_samples) - 400]

def _evaluate_sol_regime(cfg, now_ts=None):
    """Evaluate 15-minute SOL drop % and return {action, size_mult, drop_pct, peak, current}."""
    t = now_ts if now_ts is not None else time.time()
    cutoff = t - 900.0
    with _sol_lock:
        recent = [px for ts, px in _sol_regime_samples if ts >= cutoff]
    drop_pct = 0.0
    peak = 0.0
    cur = 0.0
    if len(recent) >= 2:
        peak = max(recent)
        cur = recent[-1]
        if peak > 0:
            drop_pct = max(0.0, ((peak - cur) / peak) * 100.0)
    if not opt_on(cfg, "sol_regime_filter_enabled", True):
        return {"action": "allow", "size_mult": 1.0, "drop_pct": round(drop_pct, 3), "peak": peak, "current": cur}
    max_drop = max(0.1, float((cfg or {}).get("sol_regime_max_drop_pct", 2.0) or 2.0))
    if drop_pct >= max_drop:
        raw_act = str((cfg or {}).get("sol_regime_action") or "pause").strip().lower()
        is_half = (raw_act == "half_size")
        return {
            "action": "half_size" if is_half else "pause",
            "size_mult": 0.5 if is_half else 0.0,
            "drop_pct": round(drop_pct, 3),
            "peak": peak,
            "current": cur,
        }
    return {"action": "allow", "size_mult": 1.0, "drop_pct": round(drop_pct, 3), "peak": peak, "current": cur}

def get_sol_price_usd(cfg=None, force=False):
    """Fetch and cache live SOL/USD price every 12s via Jupiter / DexScreener."""
    now_ts = time.time()
    with _sol_lock:
        if not force and _sol_cache["price"] and now_ts - _sol_cache["updated_at"] < 12.0:
            return _sol_cache["price"], _sol_cache["updated_at"]

    cfg = cfg or CONFIG
    price = None
    has_key = bool(cfg.get("jupiter_api_key")) and opt_on(cfg, "jupiter_api_key", True)
    jup_url = JUP_PRICE if has_key else JUP_PRICE_LITE
    hdrs = {"x-api-key": cfg["jupiter_api_key"]} if has_key else None
    jdata = get_json(jup_url, params={"ids": WSOL_MINT}, timeout=4, headers=hdrs)
    if isinstance(jdata, dict):
        q = jdata.get(WSOL_MINT) or (jdata.get("data") or {}).get(WSOL_MINT)
        if isinstance(q, dict):
            price = _f(q.get("usdPrice") or q.get("price"))

    if not price or price <= 0:
        ddata = get_json(f"{DEX}/tokens/v1/solana/{WSOL_MINT}", timeout=4)
        if isinstance(ddata, list) and ddata:
            best_liq = -1.0
            for p in ddata:
                if not isinstance(p, dict): continue
                px = _f(p.get("priceUsd"))
                liq = _f((p.get("liquidity") or {}).get("usd")) or 0.0
                if px and px > 0 and liq > best_liq:
                    best_liq = liq
                    price = px

    if price and price > 0:
        with _sol_lock:
            _sol_cache["price"] = price
            _sol_cache["updated_at"] = now_ts
        _record_sol_regime_sample(price, now_ts)
        return price, now_ts

    with _sol_lock:
        return _sol_cache["price"], _sol_cache["updated_at"]

# ---------------------------------------------------------------- candidate sources
_src_last, _src_stats = {}, {}
_src_lock = threading.Lock()
_seen, _seen_lock = {}, threading.Lock()
_too_old_mints = {}
_pending_dex_retry = {}  # mint -> [first_seen_ts, last_retry_ts]
_src_of = {}
_gecko_pairs = {}
_pumpportal_pairs = {}
_gecko_backoff_until = 0.0

def _parse_iso_ms(iso_str):
    if not iso_str or not isinstance(iso_str, str):
        return 0
    try:
        s = iso_str.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return int(datetime.fromisoformat(s).timestamp() * 1000)
    except Exception:
        return 0

def _mark_seen(mints):
    t = time.time()
    with _seen_lock:
        for m in mints: _seen[m] = t
        if len(_seen) > 20000:
            for k in [k for k, v in _seen.items() if t - v > 600]: _seen.pop(k, None)
        if len(_too_old_mints) > 10000:
            for k in [k for k, v in _too_old_mints.items() if t - v > 1800]: _too_old_mints.pop(k, None)
        if len(_pending_dex_retry) > 200:
            for k in [k for k, v in _pending_dex_retry.items() if t - v[0] > 45.0]: _pending_dex_retry.pop(k, None)

def _fresh_only(mints):
    t = time.time()
    with _seen_lock:
        return [
            m for m in mints
            if (t - _seen.get(m, 0) > SEEN_TTL_SEC) and (m not in _too_old_mints)
        ]

def _get_due_pending_dex_mints(exclude_set, limit=30):
    t = time.time()
    due = []
    with _seen_lock:
        expired = [m for m, (first_ts, _) in _pending_dex_retry.items() if (t - first_ts > 45.0) or (m in _too_old_mints)]
        for m in expired:
            _pending_dex_retry.pop(m, None)
        for m, (first_ts, last_try) in list(_pending_dex_retry.items()):
            if m in exclude_set:
                continue
            if t - last_try >= 1.8:
                _pending_dex_retry[m] = (first_ts, t)
                due.append(m)
                if len(due) >= limit:
                    break
    return due

def _update_pending_dex_mints(fresh_mints, found_pairs):
    t = time.time()
    with _seen_lock:
        for m in found_pairs:
            _pending_dex_retry.pop(m, None)
        for m in fresh_mints:
            if m in found_pairs or m in _too_old_mints:
                continue
            if m not in _pending_dex_retry:
                if len(_pending_dex_retry) < 120:
                    _pending_dex_retry[m] = (t, t)

def _needs_older_age_discovery(cfg):
    c = cfg or CONFIG
    if not opt_on(c, "max_age_minutes", True):
        return True
    max_m = float(c.get("max_age_minutes", 2.0) or 0.0)
    min_m = float(c.get("min_age_minutes", 0.0) or 0.0) if opt_on(c, "min_age_minutes", False) else 0.0
    return max_m > 10.0 or min_m >= 3.0

def _extract_gecko_pools(data, out):
    if not (isinstance(data, dict) and isinstance(data.get("data"), list)):
        return
    for pool in data["data"]:
        try:
            rel = pool.get("relationships") or {}
            tid = ((rel.get("base_token") or {}).get("data") or {}).get("id", "")
            if not tid.startswith("solana_"):
                continue
            mint = tid[len("solana_"):]
            if not mint or len(mint) <= 20:
                continue
            if mint not in out:
                out.append(mint)
            attrs = pool.get("attributes") or {}
            created_ms = _parse_iso_ms(attrs.get("pool_created_at"))
            px = attrs.get("base_token_price_usd")
            if created_ms > 0 and px is not None:
                liq_val = _f(attrs.get("reserve_in_usd")) or 0.0
                txns = attrs.get("transactions") or {}
                m5 = txns.get("m5") or {}
                h1 = txns.get("h1") or {}
                vol = attrs.get("volume_usd") or {}
                pc = attrs.get("price_change_percentage") or {}
                sym = str(attrs.get("name") or "?").split("/")[0].strip() or "?"
                dex_id = ((rel.get("dex") or {}).get("data") or {}).get("id") or "geckoterminal"
                _gecko_pairs[mint] = {
                    "baseToken": {"address": mint, "symbol": sym},
                    "dexId": dex_id,
                    "pairCreatedAt": created_ms,
                    "priceUsd": px,
                    "liquidity": {"usd": liq_val},
                    "txns": {
                        "m5": {"buys": int(m5.get("buys") or 0), "sells": int(m5.get("sells") or 0)},
                        "h1": {"buys": int(h1.get("buys") or 0), "sells": int(h1.get("sells") or 0)},
                    },
                    "volume": {"m5": _f(vol.get("m5")) or 0.0},
                    "priceChange": {"m5": pc.get("m5")},
                    "url": f"https://dexscreener.com/solana/{mint}",
                    "_synthetic": True,
                }
        except Exception:
            continue

_gecko_age_page_idx = [0]

def _src_gecko(cfg):
    global _gecko_backoff_until
    if not opt_on(cfg, "use_gecko", True):
        return []
    now_ts = time.time()
    if now_ts < _gecko_backoff_until:
        return []
    endpoints = [GECKO]
    if _needs_older_age_discovery(cfg):
        extra = [
            "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools",
            "https://api.geckoterminal.com/api/v2/networks/solana/pools",
        ]
        pick = extra[_gecko_age_page_idx[0] % len(extra)]
        _gecko_age_page_idx[0] += 1
        endpoints.append(pick)
    out = []
    for url in endpoints:
        try:
            r = _session.get(url, params={"page": 1}, headers=HEADERS, timeout=6)
            if r.status_code == 429:
                _gecko_backoff_until = time.time() + 45.0
                break
            r.raise_for_status()
            _extract_gecko_pools(r.json(), out)
        except Exception:
            continue
    if len(_gecko_pairs) > 500:
        for k in list(_gecko_pairs.keys())[:250]:
            _gecko_pairs.pop(k, None)
    return out

_dex_age_search_idx = [0]

def _src_dex_age_gap(cfg):
    """Extra multi-hour discovery via DexScreener search when age window exceeds fresh launches."""
    if not _needs_older_age_discovery(cfg):
        return []
    queries = ("SOL", "pump", "raydium", "meteora")
    q = queries[_dex_age_search_idx[0] % len(queries)]
    _dex_age_search_idx[0] += 1
    data = get_json(f"{DEX}/latest/dex/search", params={"q": q}, timeout=5)
    if not isinstance(data, dict) or not isinstance(data.get("pairs"), list):
        return []
    now_ms = int(time.time() * 1000)
    min_s = (max(0.0, float(cfg.get("min_age_minutes", 0.0) or 0.0)) * 60.0) if opt_on(cfg, "min_age_minutes", False) else 0.0
    max_s = (float(cfg.get("max_age_minutes", 2.0) or 0.0) * 60.0) if opt_on(cfg, "max_age_minutes", True) else 0.0
    out = []
    for p in data["pairs"]:
        if not isinstance(p, dict) or p.get("chainId") != "solana":
            continue
        mint = (p.get("baseToken") or {}).get("address")
        if not mint or len(mint) <= 20:
            continue
        created = int(p.get("pairCreatedAt") or 0)
        if created > 0:
            age_s = (now_ms - created) / 1000.0
            if min_s > 0 and age_s < min_s * 0.8:
                continue
            if max_s > 0 and age_s > max_s * 1.1:
                continue
        if mint not in out:
            out.append(mint)
    return out

def _src_jup(cfg):
    if not opt_on(cfg, "use_jupiter_recent", True): return []
    has_key = bool(cfg.get("jupiter_api_key")) and opt_on(cfg, "jupiter_api_key", True)
    hdrs = {"x-api-key": cfg["jupiter_api_key"]} if has_key else None
    data = get_json(f"{JUP}/recent", headers=hdrs)
    if isinstance(data, list): items = data
    elif isinstance(data, dict): items = data.get("tokens") or data.get("data") or []
    else: return []
    return [t.get("id") for t in items if isinstance(t, dict) and t.get("id")]

def _src_profiles(cfg):
    if not opt_on(cfg, "use_dex_profiles", True): return []
    data = get_json(f"{DEX}/token-profiles/latest/v1")
    if not isinstance(data, list): return []
    return [d.get("tokenAddress") for d in data
            if isinstance(d, dict) and d.get("chainId") == "solana" and d.get("tokenAddress")]

def _src_boosts(cfg):
    if not opt_on(cfg, "use_promoted_feeds", False): return []
    data = get_json(f"{DEX}/token-boosts/latest/v1")
    if not isinstance(data, list): return []
    return [d.get("tokenAddress") for d in data
            if isinstance(d, dict) and d.get("chainId") == "solana" and d.get("tokenAddress")]

_ws_open_prices = {}
_ws_smart_sells = {}
_ws_smart_buys = {}           # mint -> set of tracked whale wallets
_smart_buy_pending_mints = {} # mint -> ts
_whale_held_eval_ts = {}      # mint -> last queued timestamp for passive whale holdings (60s cooldown)
_ws_feed_lock = threading.Lock()
_last_ws_poll_ts = [0.0]

def _ingest_ws_bridge_payload(resp):
    if not isinstance(resp, dict) or not resp.get("ok"):
        return
    now_ts = time.time()
    sb_added = 0
    wh_added = 0
    with _ws_feed_lock:
        op = resp.get("open_prices")
        if isinstance(op, dict):
            for k, v in op.items():
                if isinstance(v, dict) and (_f(v.get("priceUsd")) or 0.0) > 0:
                    _ws_open_prices[k] = v
        ss = resp.get("smart_sells")
        if isinstance(ss, dict):
            for k, v in ss.items():
                if isinstance(v, list) and v:
                    _ws_smart_sells[k] = v
        sb = resp.get("smart_buys")
        if isinstance(sb, list):
            for ev in sb:
                if not isinstance(ev, dict):
                    continue
                bmint = str(ev.get("mint") or "").strip()
                bwal = str(ev.get("wallet") or "").strip()
                if bmint and bwal:
                    wset = _ws_smart_buys.setdefault(bmint, set())
                    wset.add(bwal)
                    _smart_buy_pending_mints[bmint] = now_ts
                    sb_added += 1
        wh = resp.get("whale_held_mints")
        if isinstance(wh, list):
            for ev in wh:
                if not isinstance(ev, dict):
                    continue
                hmint = str(ev.get("mint") or "").strip()
                hwal = str(ev.get("wallet") or "").strip()
                if hmint and hwal:
                    wset = _ws_smart_buys.setdefault(hmint, set())
                    wset.add(hwal)
                    # Throttle passive portfolio holdings so they are re-evaluated every 60s (live buys remain instant)
                    if now_ts - _whale_held_eval_ts.get(hmint, 0.0) >= 60.0:
                        _whale_held_eval_ts[hmint] = now_ts
                        _smart_buy_pending_mints[hmint] = now_ts
                        wh_added += 1
        if len(_ws_smart_buys) > 1000:
            for k in list(_ws_smart_buys.keys())[:500]:
                _ws_smart_buys.pop(k, None)
        if len(_whale_held_eval_ts) > 1000:
            for k in list(_whale_held_eval_ts.keys())[:500]:
                _whale_held_eval_ts.pop(k, None)
        for k in [k for k, ts in _smart_buy_pending_mints.items() if now_ts - ts > 180.0]:
            _smart_buy_pending_mints.pop(k, None)
    if sb_added or wh_added:
        with _stats_lock:
            _stats["smart_buys"] = _stats.get("smart_buys", 0) + sb_added
            _stats["whale_held"] = _stats.get("whale_held", 0) + wh_added

def _poll_ws_monitor_feed(cfg, force=False):
    if not opt_on(cfg, "ws_exit_stream_enabled", True) or not _bridge_base_url():
        return {}, {}
    now_ts = time.time()
    if force or now_ts - _last_ws_poll_ts[0] >= 0.8:
        _last_ws_poll_ts[0] = now_ts
        resp = bridge_get("/api/sniper/pumpportal-mints", timeout=2.5)
        _ingest_ws_bridge_payload(resp)
    with _ws_feed_lock:
        return dict(_ws_open_prices), dict(_ws_smart_sells)

def _src_pumpportal(cfg):
    if not opt_on(cfg, "use_pumpportal", True) and _get_scan_mode(cfg) != "smart_money_only":
        return []
    if _bridge_base_url():
        resp = bridge_get("/api/sniper/pumpportal-mints", timeout=4)
        if isinstance(resp, dict) and resp.get("ok"):
            _ingest_ws_bridge_payload(resp)
            raw_pairs = resp.get("pairs")
            if isinstance(raw_pairs, list):
                for p in raw_pairs:
                    if not isinstance(p, dict): continue
                    pmint = (p.get("baseToken") or {}).get("address")
                    if pmint:
                        _pumpportal_pairs[pmint] = p
                if len(_pumpportal_pairs) > 500:
                    for k in list(_pumpportal_pairs.keys())[:250]:
                        _pumpportal_pairs.pop(k, None)
            if isinstance(resp.get("mints"), list):
                return [m for m in resp["mints"] if isinstance(m, str) and m]
    if _get_scan_mode(cfg) == "smart_money_only":
        return []
    data = get_json(f"{PUMPP}/coins/new")
    if not isinstance(data, list): return []
    return [c.get("mint") for c in data if isinstance(c, dict) and c.get("mint")]

def _get_scan_mode(cfg):
    raw = str((cfg or {}).get("smart_money_scan_mode") or "both").strip().lower()
    if raw in ("both", "smart_money_only", "sniper_only"):
        return raw
    return "both"

SOURCES = [
    ("pumpportal", 2.0, _src_pumpportal),
    ("gecko", 10.0, _src_gecko),
    ("dex_age_gap", 12.0, _src_dex_age_gap),
    ("jup", 6.0, _src_jup),
    ("profiles", 4.0, _src_profiles),
    ("boosts", 10.0, _src_boosts),
]

def fetch_candidate_mints(cfg, force=False):
    scan_mode = _get_scan_mode(cfg)
    active_sources = [("pumpportal", 1.5, _src_pumpportal)] if scan_mode == "smart_money_only" else SOURCES
    by_src = {}
    lock = threading.Lock()
    def run(name, cd, fn):
        t = time.time()
        with _src_lock:
            if not force and t - _src_last.get(name, 0) < cd: return
            _src_last[name] = t
        try:
            res = fn(cfg) or []
            _src_stats[name] = {"items": len(res), "ok_at": time.time()}
        except Exception:
            _src_stats[name] = {"items": -1, "ok_at": 0.0}
            res = []
        valid = []
        for m in res:
            if isinstance(m, str) and 39 <= len(m) <= 50:
                valid.append(m)
                if m not in _src_of: _src_of[m] = name
                if len(_src_of) > 20000: _src_of.clear()
        with lock:
            by_src[name] = valid
    ths = [threading.Thread(target=run, args=s, daemon=True) for s in active_sources]
    for t in ths: t.start()
    for t in ths: t.join(timeout=5)
    smart_priority = []
    with _ws_feed_lock:
        if _smart_buy_pending_mints:
            smart_priority = list(_smart_buy_pending_mints.keys())
            _smart_buy_pending_mints.clear()
    if scan_mode == "smart_money_only":
        ordered_mints = []
        for m in smart_priority:
            if isinstance(m, str) and 39 <= len(m) <= 50 and m not in ordered_mints:
                ordered_mints.append(m)
                _src_of[m] = "smart_money"
        _src_stats["smart_money"] = {"items": len(ordered_mints), "ok_at": time.time()}
        return ordered_mints
    # Prioritize real-time smart-wallet signals & launch streams ahead of older lists
    ordered_mints = []
    seen_batch = set()
    for m in smart_priority:
        if isinstance(m, str) and 39 <= len(m) <= 50 and m not in seen_batch:
            seen_batch.add(m)
            ordered_mints.append(m)
            if m not in _src_of:
                _src_of[m] = "smart_money"
    for src_name in ("pumpportal", "gecko", "dex_age_gap", "profiles", "jup", "boosts"):
        for m in by_src.get(src_name, []):
            if m not in seen_batch:
                seen_batch.add(m)
                ordered_mints.append(m)
    fresh = _fresh_only(ordered_mints)
    for m in smart_priority:
        if m in seen_batch and m not in fresh:
            fresh.insert(0, m)
    _mark_seen(ordered_mints)
    due_retries = _get_due_pending_dex_mints(set(fresh), limit=30)
    if due_retries:
        fresh = fresh + due_retries
    return fresh

# ---------------------------------------------------------------- website / launchpad filter & entry scoring
def _extract_pair_websites(pair):
    urls = []
    if not isinstance(pair, dict):
        return ""
    if not pair.get("_synthetic") and pair.get("url"):
        urls.append(str(pair.get("url")))
    info = pair.get("info") if isinstance(pair.get("info"), dict) else {}
    for w in (info.get("websites") or []):
        if isinstance(w, dict) and w.get("url"):
            urls.append(str(w.get("url")))
        elif isinstance(w, str):
            urls.append(w)
    for s in (info.get("socials") or []):
        if isinstance(s, dict) and s.get("url"):
            urls.append(str(s.get("url")))
    return " ".join(urls).lower()

def matches_enabled_platforms(pair, mint="", source="", cfg=None):
    """Check whether pair/mint/source matches user-checked websites in enabled_platforms ([] = all allowed)."""
    if opt_on(cfg, "axiom_pulse_migrated_only_enabled", False):
        mint_str = str(mint or (pair.get("baseToken") or {}).get("address") or "").strip()
        mint_low = mint_str.lower()
        dex_raw = str((pair or {}).get("dexId") or "").strip().lower()
        dex_norm = dex_raw.replace("-", "").replace("_", "").replace(" ", "")
        liq_pre = _f(((pair or {}).get("liquidity") or {}).get("usd")) or 0.0
        is_pumpswap = dex_norm in ("pumpswap", "pumpfunamm")
        is_raydium = "raydium" in dex_norm or "launchlab" in dex_norm
        is_meteora = "meteora" in dex_norm or "dlmm" in dex_norm
        is_migrated = (is_pumpswap or is_raydium or is_meteora) or (dex_norm not in ("pumpfun", "pump") and not mint_low.endswith("pump") and liq_pre >= 2000.0)
        if not is_migrated:
            return False, f"dex={dex_raw or '?'} not migrated AMM pool"
        return True, "axiom_pulse_migrated"

    if not opt_on(cfg, "enabled_platforms", True):
        return True, "all"
    selected_raw = (cfg or {}).get("enabled_platforms") if isinstance(cfg, dict) else None
    if not isinstance(selected_raw, list) or not selected_raw:
        return True, "all"
    selected = [str(x).strip().lower() for x in selected_raw if str(x).strip()]
    if not selected:
        return True, "all"

    mint_str = str(mint or (pair.get("baseToken") or {}).get("address") or "").strip()
    mint_low = mint_str.lower()
    dex_raw = str((pair or {}).get("dexId") or "").strip().lower()
    dex_norm = dex_raw.replace("-", "").replace("_", "").replace(" ", "")
    labels_blob = " ".join(str(x).lower() for x in ((pair or {}).get("labels") or []))
    websites_blob = _extract_pair_websites(pair)
    src_low = str(source or (pair or {}).get("_source") or "").strip().lower()

    is_pumpfun = dex_norm in ("pumpfun", "pump") or mint_low.endswith("pump") or "pump.fun" in websites_blob
    is_pumpswap = dex_norm in ("pumpswap", "pumpfunamm") or "swap.pump.fun" in websites_blob
    is_letsbonk = "bonk" in dex_norm or mint_low.endswith("bonk") or "letsbonk.fun" in websites_blob or "bonk.fun" in websites_blob
    is_raydium = "raydium" in dex_norm or "launchlab" in dex_norm or "launchlab" in labels_blob or "raydium.io" in websites_blob
    is_meteora = "meteora" in dex_norm or "dlmm" in labels_blob or "damm" in labels_blob or "meteora.ag" in websites_blob
    is_moonshot = "moonshot" in dex_norm or mint_low.endswith("moon") or "moonshot" in websites_blob
    is_bags = "bags" in dex_norm or mint_str.endswith("BAGS") or "bags.fm" in websites_blob
    is_believe = "believe" in dex_norm or "believe.app" in websites_blob or "launchcoin" in websites_blob
    is_boop = "boop" in dex_norm or mint_low.endswith("boop") or "boop.fun" in websites_blob
    is_orca = "orca" in dex_norm or "whirlpool" in dex_norm or "orca.so" in websites_blob
    is_jupiter = src_low == "jup" or "jupiter" in dex_norm or dex_norm == "jup" or mint_low.endswith("jup") or "jup.ag" in websites_blob
    is_dexscreener = src_low in ("profiles", "boosts") or (not (pair or {}).get("_synthetic") and "dexscreener.com" in websites_blob)
    is_gecko = src_low == "gecko" or "geckoterminal.com" in websites_blob

    checks = {
        "pumpfun": is_pumpfun and not is_pumpswap,
        "pumpswap": is_pumpswap,
        "axiom": (
            "axiom.trade" in websites_blob
            or is_pumpfun or is_pumpswap or is_letsbonk or is_raydium
            or is_meteora or is_moonshot or is_bags or is_believe or is_boop
        ),
        "letsbonk": is_letsbonk,
        "raydium": is_raydium,
        "meteora": is_meteora,
        "moonshot": is_moonshot,
        "bags": is_bags,
        "believe": is_believe,
        "boop": is_boop,
        "orca": is_orca,
        "jupiter": is_jupiter,
        "gmgn": (
            "gmgn.ai" in websites_blob
            or is_pumpfun or is_pumpswap or is_letsbonk or is_raydium or is_meteora or is_moonshot
        ),
        "photon": (
            "tinyastro" in websites_blob or "photon" in websites_blob
            or is_pumpfun or is_pumpswap or is_raydium or is_meteora or is_moonshot
        ),
        "bullx": (
            "bullx.io" in websites_blob
            or is_pumpfun or is_pumpswap or is_raydium or is_meteora or is_moonshot
        ),
        "dexscreener": is_dexscreener,
        "geckoterminal": is_gecko,
    }
    # If user explicitly selected pumpfun, allow migrated pumpswap coins whose mint ends in 'pump' only if pumpswap wasn't excluded, or treat *pump mints on pumpfun as matching pumpfun
    if "pumpfun" in selected and is_pumpfun:
        return True, "pumpfun"
    for plat in selected:
        if checks.get(plat):
            return True, plat
    return False, f"dex={dex_raw or '?'} src={src_low or '?'} not in [{','.join(selected)}]"

_rejected_symbol_cooldown = {}
_symbol_cd_lock = threading.Lock()

def _note_symbol_cooldown(symbol, cfg=None):
    sym = str(symbol or "").strip().upper()
    if not sym or sym in ("?", "UNKNOWN"):
        return
    if cfg is not None and not opt_on(cfg, "anti_rug_copycat_cooldown_enabled", True):
        return
    with _symbol_cd_lock:
        if len(_rejected_symbol_cooldown) > 500:
            now_ts = time.time()
            for k in [k for k, v in _rejected_symbol_cooldown.items() if v <= now_ts]:
                _rejected_symbol_cooldown.pop(k, None)
        _rejected_symbol_cooldown[sym] = time.time() + 600.0

def _is_symbol_on_cooldown(symbol, liq, cfg):
    if not opt_on(cfg, "anti_rug_copycat_cooldown_enabled", True):
        return False
    sym = str(symbol or "").strip().upper()
    if not sym or sym in ("?", "UNKNOWN"):
        return False
    with _symbol_cd_lock:
        exp = _rejected_symbol_cooldown.get(sym, 0.0)
    if exp > time.time():
        # Only allow same-symbol entry during 10-min cooldown if liquidity is strongly established ($15k+)
        return (liq or 0.0) < 15000.0
    return False

_short_px_window = {}
_migration_peaks = {}
_market_struct_lock = threading.Lock()

def _extract_ticker_stem(symbol):
    s = re.sub(r"[^A-Z0-9.]", "", str(symbol or "").upper())
    if not s:
        return "UNKNOWN"
    s = re.sub(r"\d+$", "", s)
    for _ in range(2):
        after_s = re.sub(r"(MINI|BABY|SUPER|MEGA|MICRO|TURBO|COIN|TOKEN|INU|WIF|SOL|AI|2\.0)$", "", s)
        if len(after_s) >= 2:
            s = after_s
        after_p = re.sub(r"^(MINI|BABY|SUPER|MEGA|MICRO|TURBO)", "", s)
        if len(after_p) >= 2:
            s = after_p
    return s or str(symbol or "").upper()

def passes_filters(pair, cfg, now_ms=None, source=None):
    """Returns (ok, short_reason_code, detail)."""
    mint_addr = (pair.get("baseToken") or {}).get("address") or ""
    src_hint = source if source is not None else _src_of.get(mint_addr, "")
    scan_mode = _get_scan_mode(cfg)
    sb_hits = pair.get("_smart_buyers") if isinstance(pair.get("_smart_buyers"), list) else _get_pair_smart_buyers(pair, pair.get("_rep"), cfg)
    if scan_mode == "smart_money_only" and not sb_hits:
        return False, "not whale buy", "smart_money_only requires tracked whale wallet"
    whale_older_ok = bool(sb_hits) and (
        opt_on(cfg, "smart_money_follow_older_coins", True) or scan_mode == "smart_money_only"
    )
    ok_plat, plat_detail = matches_enabled_platforms(pair, mint_addr, src_hint, cfg)
    if not ok_plat:
        return False, "wrong website", plat_detail
    liq_pre = _f((pair.get("liquidity") or {}).get("usd")) or 0.0
    sym_pre = (pair.get("baseToken") or {}).get("symbol") or ""
    if _is_symbol_on_cooldown(sym_pre, liq_pre, cfg):
        return False, "copycat cooldown", f"{sym_pre} cooled down 10m after rug reject"
    now_ms = now_ms or int(time.time() * 1000)
    created = int(pair.get("pairCreatedAt") or 0)
    if created <= 0: return False, "missing data", "no pairCreatedAt"
    age_s = (now_ms - created) / 1000.0
    if age_s < -10: return False, "clock skew", "sync your PC clock"
    if whale_older_ok:
        max_whale_h = max(0.0, float(cfg.get("smart_money_max_coin_age_hours", 72) or 0.0))
        if max_whale_h > 0.0 and age_s > max_whale_h * 3600.0:
            return False, "too old (whale cap)", f"{age_s / 3600:.1f}h > {max_whale_h:g}h whale cap"
    else:
        if opt_on(cfg, "min_age_minutes", False):
            min_age_m = max(0.0, float(cfg.get("min_age_minutes", 0.0) or 0.0))
            if min_age_m > 0.0 and age_s < min_age_m * 60.0:
                return False, "too young", f"{age_s / 60:.1f}m < {min_age_m:g}m min"
        if opt_on(cfg, "max_age_minutes", True):
            max_age_m = float(cfg.get("max_age_minutes", 2.0) or 0.0)
            if max_age_m > 0.0 and age_s > max_age_m * 60.0:
                return False, "too old", f"{age_s / 60:.1f}m > {max_age_m:g}m window"
    px = _f(pair.get("priceUsd"))
    if px is None or px <= 0: return False, "no price", "no price on DexScreener/curve yet"

    early_shield_on = opt_on(cfg, "early_rug_shield_enabled", True)
    m5 = (pair.get("txns") or {}).get("m5") or {}
    buys, sells = int(m5.get("buys") or 0), int(m5.get("sells") or 0)
    ratio = float(cfg.get("min_buy_sell_ratio_m5", 1.5) or 0) if opt_on(cfg, "min_buy_sell_ratio_m5", True) else 0.0
    if whale_older_ok and age_s > 600.0 and ratio > 0.6:
        ratio = 0.6
    if ratio > 0 and buys < sells * ratio:
        return False, "selling pressure", f"{buys}b/{sells}s in last 5m"
    if (early_shield_on and age_s >= 20 and buys >= 6 and sells == 0) or (age_s >= 30 and buys >= 12 and sells == 0):
        return False, "honeypot pattern", f"{buys} buys / 0 sells in 5m"

    dex_low = str(pair.get("dexId") or "").strip().lower()
    is_curve_dex = dex_low in ("pumpfun", "pump")
    is_migrated_dex = not is_curve_dex and (
        any(k in dex_low for k in ("pumpswap", "pumpfunamm", "raydium", "meteora", "dlmm", "orca"))
        or mint_addr.lower().endswith("pump")
    )

    grace_sec = max(0.0, float(cfg.get("ultra_early_grace_sec", 0) or 0)) if opt_on(cfg, "ultra_early_grace_sec", True) else 0.0
    pp = pair.get("_pumpportal") if isinstance(pair.get("_pumpportal"), dict) else None
    if pp and pp.get("has_trade_stream"):
        buys_60s = int(pp.get("buys_60s") or 0)
        sells_60s = int(pp.get("sells_60s") or 0)
        if buys_60s < sells_60s or (early_shield_on and age_s < 180 and sells_60s >= 3 and buys_60s <= sells_60s):
            return False, "selling pressure (60s)", f"{buys_60s}b/{sells_60s}s last 60s"
        if early_shield_on and pp.get("creator_sold") and opt_on(cfg, "block_creator_dump", True):
            return False, "creator dump", "creator/dev already sold during launch"
        if early_shield_on and pp.get("initial_buy_sol") is not None:
            init_buy = _f(pp.get("initial_buy_sol")) or 0.0
            if init_buy > 8.0:
                return False, "dev sniper bundle", f"initial dev buy {init_buy:.2f} SOL > 8.0 SOL"
        if early_shield_on and is_curve_dex and pp.get("real_sol") is not None and (_f(pp.get("v_sol")) or 0.0) > 0.0:
            real_sol_val = _f(pp.get("real_sol"))
            if real_sol_val is not None:
                if age_s >= 10.0 and real_sol_val < 2.5:
                    return False, "thin bonding curve", f"real SOL {real_sol_val:.2f} < 2.5 SOL"
                if age_s >= 8.0 and real_sol_val < 1.5:
                    return False, "thin bonding curve", f"real SOL {real_sol_val:.2f} < 1.5 SOL"
        if opt_on(cfg, "min_recent_buys_60s", True):
            min_60s = int(cfg.get("min_recent_buys_60s", 3) or 0)
            if age_s > grace_sec and min_60s > 0 and buys_60s < min_60s:
                return False, "low 60s velocity", f"{buys_60s} buys < {min_60s} in 60s"

    # Pro Desk Group 3A: Pre-Migration Bonding Curve Surge Filter
    if opt_on(cfg, "pre_migration_curve_enabled", False) and is_curve_dex:
        real_sol = _f((pp or {}).get("real_sol_in_curve")) if pp else None
        if real_sol is None:
            real_sol = _f(pair.get("_real_sol_in_curve"))
        if real_sol is not None:
            curve_pct = min(100.0, max(0.0, (real_sol / 85.0) * 100.0))
            c_min = float(cfg.get("pre_migration_curve_min_pct", 75.0) or 0.0)
            c_max = float(cfg.get("pre_migration_curve_max_pct", 92.0) or 100.0)
            if curve_pct < c_min or curve_pct > c_max:
                return False, "curve out of range", f"curve {curve_pct:.1f}% not in {c_min:g}-{c_max:g}%"

    # Pro Desk Group 3B: Post-Migration Pullback / Reclaim Entry
    m5c = _f((pair.get("priceChange") or {}).get("m5"))
    if opt_on(cfg, "post_migration_pullback_enabled", False) and is_migrated_dex:
        wait_s = max(5.0, float(cfg.get("migration_wait_sec", 45.0) or 45.0))
        min_dip = max(1.0, float(cfg.get("migration_min_dip_pct", 15.0) or 15.0))
        with _market_struct_lock:
            peak_rec = _migration_peaks.get(mint_addr)
            if peak_rec is None:
                peak_rec = px
                _migration_peaks[mint_addr] = px
                if len(_migration_peaks) > 500:
                    _migration_peaks.pop(next(iter(_migration_peaks)), None)
            elif px > peak_rec:
                peak_rec = px
                _migration_peaks[mint_addr] = px
        if age_s < wait_s:
            return False, "waiting migration settle", f"age {age_s:.0f}s < {wait_s:g}s"
        dip_pct = ((peak_rec - px) / peak_rec * 100.0) if peak_rec > 0 else 0.0
        m5_dip = -m5c if (m5c is not None and m5c < 0) else 0.0
        eff_dip = max(dip_pct, m5_dip)
        if eff_dip < min_dip:
            return False, "waiting post-migration dip", f"dip {eff_dip:.1f}% < {min_dip:g}%"

    # Pro Desk Group 3C: Wash-Trading / Fake Volume Guard
    if opt_on(cfg, "wash_trade_filter_enabled", True):
        min_ratio = max(0.05, min(1.0, float(cfg.get("min_unique_makers_ratio", 0.25) or 0.25)))
        min_uniq = max(1, int(cfg.get("min_unique_traders_5m", 6) or 6))
        total_m5 = buys + sells
        has_uniq_data = (
            (isinstance(pp, dict) and pp.get("unique_traders_5m") is not None)
            or (isinstance(m5, dict) and m5.get("makers") is not None)
            or (pair.get("_unique_traders_5m") is not None)
        )
        if total_m5 >= 6 and has_uniq_data:
            uniq_5m = int(
                ((pp or {}).get("unique_traders_5m") or 0)
                or (m5.get("makers") or 0)
                or (pair.get("_unique_traders_5m") or 0)
            )
            ratio_5m = uniq_5m / max(1, total_m5)
            if uniq_5m < min_uniq:
                return False, "wash trading", f"{uniq_5m} unique 5m traders < {min_uniq}"
            if ratio_5m < min_ratio:
                return False, "wash trading", f"unique ratio {ratio_5m*100:.0f}% < {min_ratio*100:.0f}% ({uniq_5m}/{total_m5})"

    # Pro Desk Group 3D: Anti-Top-Wick Guard (20s rolling window)
    now_t = now_ms / 1000.0
    with _market_struct_lock:
        win = _short_px_window.get(mint_addr, [])
        win = [(ts, val) for ts, val in win if now_t - ts <= 25.0]
        win.append((now_t, px))
        _short_px_window[mint_addr] = win[-20:]
        if len(_short_px_window) > 600:
            _short_px_window.pop(next(iter(_short_px_window)), None)
    if opt_on(cfg, "anti_top_wick_enabled", True):
        max_spike = max(5.0, float(cfg.get("max_short_spike_pct", 70.0) or 70.0))
        if len(win) >= 2:
            base_px = win[0][1]
            surge_pct = ((px - base_px) / base_px * 100.0) if base_px > 0 else 0.0
            if surge_pct > max_spike:
                return False, "top wick spike", f"+{surge_pct:.1f}% vertical spike > +{max_spike:g}% cap"
        pp_spike = _f((pp or {}).get("spike_15s_pct")) if pp else None
        if pp_spike is not None and pp_spike > max_spike:
            return False, "top wick spike", f"+{pp_spike:.1f}% 15s spike > +{max_spike:g}% cap"

    if opt_on(cfg, "max_price_change_m5_pct", True):
        max_m5c = float(cfg.get("max_price_change_m5_pct", 300) or 0)
        if m5c is not None and max_m5c > 0 and m5c > max_m5c:
            return False, "already pumped", f"+{m5c:.0f}% in 5m"

    liq = liq_pre
    fdv = _f(pair.get("fdv")) or _f(pair.get("marketCap")) or 0.0
    pool_depth_on = opt_on(cfg, "anti_rug_pool_depth_check_enabled", True)
    max_fdv_mult = 80.0 if pool_depth_on else 150.0
    if liq > 0 and fdv > 0 and fdv > liq * max_fdv_mult:
        return False, "inflated mcap/liq", f"MCap ${fdv:.0f} vs LP ${liq:.0f}"

    if age_s > grace_sec:
        min_liq = float(cfg.get("min_liquidity_usd", 5000) or 0) if opt_on(cfg, "min_liquidity_usd", True) else 0.0
        eff_min_liq = max(min_liq, 2500.0) if (pool_depth_on and min_liq > 0) else (2500.0 if pool_depth_on else min_liq)
        if whale_older_ok and eff_min_liq > 2500.0:
            eff_min_liq = 2500.0
        if eff_min_liq > 0 and liq < eff_min_liq:
            return False, "low liquidity", f"${liq:.0f} < ${eff_min_liq:.0f}"
        if not (whale_older_ok and age_s > 600.0):
            if opt_on(cfg, "min_buys_m5", True):
                min_bm5 = int(cfg.get("min_buys_m5", 8) or 0)
                if min_bm5 > 0 and buys < min_bm5:
                    return False, "few buys", f"{buys} buys in last 5m"
            if opt_on(cfg, "min_volume_m5_usd", True) and float(cfg.get("min_volume_m5_usd", 0) or 0) > 0:
                mv5 = _f((pair.get("volume") or {}).get("m5")) or 0.0
                if mv5 < cfg["min_volume_m5_usd"]: return False, "low m5 volume", f"${mv5:.0f}"
        if opt_on(cfg, "min_holders", True) and int(cfg.get("min_holders", 0) or 0) > 0:
            h1b = int(((pair.get("txns") or {}).get("h1") or {}).get("buys") or 0)
            if h1b < cfg["min_holders"]: return False, "too few h1 buys", f"{h1b}"
    return True, "ok", ""

def score_candidate(pair, cfg, now_ms=None):
    """Deterministic momentum + freshness + liquidity velocity score for ranking multiple passing coins."""
    now_ms = now_ms or int(time.time() * 1000)
    created = int(pair.get("pairCreatedAt") or 0)
    age_s = max(0.0, (now_ms - created) / 1000.0) if created > 0 else 120.0
    max_age_m = float(cfg.get("max_age_minutes", 2) or 2) if opt_on(cfg, "max_age_minutes", True) else 60.0
    max_age_s = max(10.0, max_age_m * 60.0)

    m5 = (pair.get("txns") or {}).get("m5") or {}
    buys = int(m5.get("buys") or 0)
    sells = int(m5.get("sells") or 0)
    ratio = min(10.0, buys / max(1.0, float(sells)))

    liq = max(1.0, _f((pair.get("liquidity") or {}).get("usd")) or 1.0)
    mv5 = _f((pair.get("volume") or {}).get("m5")) or 0.0
    turnover = min(10.0, mv5 / liq)

    pp = pair.get("_pumpportal") if isinstance(pair.get("_pumpportal"), dict) else {}
    buys_60s = int(pp.get("buys_60s") or 0)
    sol_vol_60s = float(pp.get("sol_vol_60s") or 0.0)
    vel_bonus = min(60.0, buys_60s * 3.5 + sol_vol_60s * 4.0)

    freshness = max(0.0, 1.0 - min(1.0, age_s / max_age_s)) * 20.0
    smart_bonus = 0.0
    if opt_on(cfg, "smart_money_prioritize_entries", True) and opt_on(cfg, "smart_money_enabled", True):
        sb = pair.get("_smart_buyers") if isinstance(pair.get("_smart_buyers"), list) else _get_pair_smart_buyers(pair, pair.get("_rep"), cfg)
        if sb:
            smart_bonus = 150.0 * len(sb)
    score = (ratio * 20.0) + (turnover * 15.0) + vel_bonus + freshness + min(15.0, buys * 0.25) + smart_bonus
    return round(score, 4)

def rank_candidates(items, cfg, now_ms=None):
    """Sort passing [(mint, pair), ...] strongest momentum first."""
    now_ms = now_ms or int(time.time() * 1000)
    return sorted(
        items,
        key=lambda item: score_candidate(item[1], cfg, now_ms),
        reverse=True,
    )

# ---------------------------------------------------------------- hard rug screen
_rug_cache, _creator_meta_cache, _rug_lock = {}, {}, threading.Lock()

def _rpc_mint_account_info(mint, cfg=None):
    """Direct on-chain check of SPL/Token-2022 mint. Returns dict or None if RPC failed."""
    body = {"jsonrpc": "2.0", "id": 1, "method": "getAccountInfo", "params": [mint, {"encoding": "jsonParsed"}]}
    for url in _get_rpc_urls(cfg):
        try:
            r = _session.post(url, json=body, timeout=6, headers={**HEADERS, "Content-Type": "application/json"})
            if r.status_code != 200: continue
            value = ((r.json().get("result") or {}).get("value") or {})
            parsed = ((value.get("data") or {}).get("parsed") or {})
            if parsed.get("type") == "mint":
                inf = parsed.get("info") or {}
                decimals = int(inf.get("decimals") if inf.get("decimals") is not None else 6)
                raw_supply = float(inf.get("supply") or 0)
                supply_ui = raw_supply / (10 ** decimals) if decimals >= 0 else raw_supply
                disallowed = []
                for ext in (inf.get("extensions") or []):
                    ext_name = str((ext or {}).get("extension") or "")
                    if ext_name in DISALLOWED_TOKEN2022_EXTENSIONS:
                        disallowed.append(ext_name)
                return {
                    "mint_auth": inf.get("mintAuthority"),
                    "freeze_auth": inf.get("freezeAuthority"),
                    "decimals": decimals,
                    "supply_ui": supply_ui,
                    "disallowed_extensions": disallowed,
                }
        except Exception:
            continue
    return None

def _rpc_mint_authorities(mint):
    """Direct on-chain check of the SPL mint account. Returns (rpc_ok, mint_auth, freeze_auth)."""
    info = _rpc_mint_account_info(mint)
    if info is None:
        return False, None, None
    return True, info.get("mint_auth"), info.get("freeze_auth")

_creator_addr_cache = {}
_creator_addr_lock = threading.Lock()

def _rpc_top_holders_list(mint, supply_ui, exclude_addrs=None, cfg=None):
    """Best-effort RPC largest non-pool holders list: [{address, owner, pct}, ...]."""
    if not supply_ui or supply_ui <= 0:
        return None
    excl = set(KNOWN_POOL_OR_BURN_OWNERS)
    if exclude_addrs:
        excl.update(exclude_addrs)
    for url in _get_rpc_urls(cfg):
        try:
            r = _session.post(
                url,
                json={"jsonrpc": "2.0", "id": 1, "method": "getTokenLargestAccounts", "params": [mint, {"commitment": "confirmed"}]},
                timeout=4,
                headers={**HEADERS, "Content-Type": "application/json"},
            )
            if r.status_code != 200:
                continue
            vals = ((r.json().get("result") or {}).get("value") or [])[:15]
            if not vals:
                continue
            addrs = [v.get("address") for v in vals if v.get("address")]
            owners_by_idx = {}
            if addrs:
                mr = _session.post(
                    url,
                    json={"jsonrpc": "2.0", "id": 2, "method": "getMultipleAccounts", "params": [addrs, {"encoding": "jsonParsed", "commitment": "confirmed"}]},
                    timeout=4,
                    headers={**HEADERS, "Content-Type": "application/json"},
                )
                if mr.status_code == 200:
                    mvals = ((mr.json().get("result") or {}).get("value") or [])
                    for idx, mv in enumerate(mvals):
                        owner = (((((mv or {}).get("data") or {}).get("parsed") or {}).get("info") or {}).get("owner") or "")
                        owners_by_idx[idx] = owner
            non_pool = []
            for idx, v in enumerate(vals):
                addr = v.get("address") or ""
                owner = owners_by_idx.get(idx, "")
                if addr in excl or owner in excl or "11111111111111111" in owner:
                    continue
                ui = _f(v.get("uiAmount")) or 0.0
                pct = (ui / supply_ui) * 100.0
                non_pool.append({"address": addr, "owner": owner or addr, "pct": pct})
            return non_pool
        except Exception:
            continue
    return None

def _rpc_top_holders(mint, supply_ui, exclude_addrs=None, cfg=None):
    """Best-effort RPC largest holder calculation excluding known pool/burn addresses."""
    rows = _rpc_top_holders_list(mint, supply_ui, exclude_addrs=exclude_addrs, cfg=cfg)
    if rows is None:
        return None, None
    non_pool = [float(r.get("pct") or 0.0) for r in rows]
    top10_pct = sum(non_pool[:10])
    single_max = max(non_pool) if non_pool else 0.0
    return top10_pct, single_max

def _resolve_creator_via_rpc(mint, cfg=None):
    """Best-effort creator/deployer resolution from oldest mint tx fee payer when RugCheck/PumpPortal omit it."""
    if not mint:
        return ""
    now_ts = time.time()
    with _creator_addr_lock:
        cached = _creator_addr_cache.get(mint)
        if cached and now_ts - cached[0] < 3600.0:
            return cached[1]
    for url in _get_rpc_urls(cfg):
        try:
            r = _session.post(
                url,
                json={"jsonrpc": "2.0", "id": 1, "method": "getSignaturesForAddress", "params": [mint, {"limit": 50}]},
                timeout=3,
                headers={**HEADERS, "Content-Type": "application/json"},
            )
            if r.status_code != 200:
                continue
            sigs = (r.json().get("result") or [])
            if not sigs:
                continue
            oldest_sig = sigs[-1].get("signature")
            if not oldest_sig:
                continue
            tr = _session.post(
                url,
                json={"jsonrpc": "2.0", "id": 2, "method": "getTransaction", "params": [oldest_sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}]},
                timeout=3,
                headers={**HEADERS, "Content-Type": "application/json"},
            )
            if tr.status_code != 200:
                continue
            keys = ((((tr.json().get("result") or {}).get("transaction") or {}).get("message") or {}).get("accountKeys") or [])
            for k in keys:
                pk = k.get("pubkey") if isinstance(k, dict) else k
                is_sig = k.get("signer", True) if isinstance(k, dict) else True
                if pk and is_sig and str(pk) != mint and str(pk) not in KNOWN_POOL_OR_BURN_OWNERS:
                    creator = str(pk)
                    with _creator_addr_lock:
                        if len(_creator_addr_cache) > 2000:
                            _creator_addr_cache.clear()
                        _creator_addr_cache[mint] = (now_ts, creator)
                    return creator
        except Exception:
            continue
    return ""

def _rpc_owner_token_pct(mint, owner_addr, supply_ui, cfg=None):
    """Best-effort on-chain token ownership % check for creator/deployer wallet."""
    if not mint or not owner_addr or not supply_ui or supply_ui <= 0:
        return None
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTokenAccountsByOwner",
        "params": [owner_addr, {"mint": mint}, {"encoding": "jsonParsed", "commitment": "confirmed"}],
    }
    for url in _get_rpc_urls(cfg):
        try:
            r = _session.post(url, json=body, timeout=3.5, headers={**HEADERS, "Content-Type": "application/json"})
            if r.status_code != 200:
                continue
            vals = ((r.json().get("result") or {}).get("value") or [])
            total_ui = 0.0
            for item in vals:
                t_amt = (((((item or {}).get("account") or {}).get("data") or {}).get("parsed") or {}).get("info") or {}).get("tokenAmount") or {}
                ui = _f(t_amt.get("uiAmount"))
                if ui is not None and ui > 0:
                    total_ui += ui
            return (total_ui / supply_ui) * 100.0
        except Exception:
            continue
    return None

_jup_quote_lock = threading.Lock()
_jup_quote_backoff_until = 0.0
_last_jup_quote_ts = 0.0
_sell_route_cache = {}
_last_mint_decimals = {}

def _check_sell_route(mint, decimals, price_usd, cfg, max_impact_pct=15.0, sol_px=None):
    """Verify Jupiter can quote an exit swap mint -> WSOL with sane price impact & no hidden sell tax."""
    global _jup_quote_backoff_until, _last_jup_quote_ts
    if not mint or not price_usd or price_usd <= 0:
        return True, "skip"
    now_ts = time.time()
    has_key = bool(cfg.get("jupiter_api_key")) and opt_on(cfg, "jupiter_api_key", True)
    impact_cap = float(max_impact_pct or 15.0)
    cache_key = f"{mint}:{impact_cap:g}"
    with _jup_quote_lock:
        cached = _sell_route_cache.get(cache_key)
        if cached and now_ts - cached[0] < 90.0:
            return cached[1]
        if now_ts < _jup_quote_backoff_until:
            return True, "jup_backoff_skip"
        if not has_key and now_ts - _last_jup_quote_ts < 1.5:
            return True, "jup_paced_skip"
        _last_jup_quote_ts = now_ts

    trade_usd = max(0.5, float(cfg.get("trade_size_usd", 5.0) or 5.0) if opt_on(cfg, "trade_size_usd", True) else 5.0)
    qty_ui = trade_usd / float(price_usd)
    dec = max(0, int(decimals if decimals is not None else 6))
    raw_units = max(1, int(qty_ui * (10 ** dec)))
    url = JUP_QUOTE if has_key else JUP_QUOTE_LITE
    hdrs = {"x-api-key": cfg["jupiter_api_key"]} if has_key else None
    try:
        r = _session.get(
            url,
            params={
                "inputMint": mint,
                "outputMint": WSOL_MINT,
                "amount": str(raw_units),
                "slippageBps": "1500",
                "swapMode": "ExactIn",
            },
            headers={**HEADERS, **(hdrs or {})},
            timeout=5,
        )
        if r.status_code == 429:
            with _jup_quote_lock:
                _jup_quote_backoff_until = time.time() + 12.0
            return True, "jup_429"
        if r.status_code == 400:
            res = (False, "no sell route back to SOL (honeypot / unroutable)")
            with _jup_quote_lock:
                if len(_sell_route_cache) > 1000: _sell_route_cache.clear()
                _sell_route_cache[cache_key] = (time.time(), res)
            return res
        if r.status_code != 200:
            return True, "jup_unavailable"
        q = r.json()
        out_amt = _f(q.get("outAmount")) or 0.0
        if out_amt <= 0:
            res = (False, "zero sell output on Jupiter (honeypot)")
            with _jup_quote_lock:
                _sell_route_cache[cache_key] = (time.time(), res)
            return res
        impact = abs(_f(q.get("priceImpactPct")) or 0.0) * 100.0
        if impact > impact_cap:
            res = (False, f"sell price impact too high ({impact:.1f}% > {impact_cap:g}%)")
            with _jup_quote_lock:
                _sell_route_cache[cache_key] = (time.time(), res)
            return res
        if opt_on(cfg, "early_rug_shield_enabled", True):
            eff_sol_px = _f(sol_px)
            if eff_sol_px is None or eff_sol_px <= 0:
                try:
                    eff_sol_px, _ = get_sol_price_usd(cfg)
                except Exception:
                    eff_sol_px = None
            if eff_sol_px and eff_sol_px > 0 and trade_usd > 0:
                out_usd = (out_amt / 1e9) * eff_sol_px
                loss_pct = ((trade_usd - out_usd) / trade_usd) * 100.0
                max_tax_loss = max(30.0, impact_cap + 15.0)
                if loss_pct > max_tax_loss:
                    res = (False, f"hidden sell tax / transfer fee (-{loss_pct:.0f}% exit value loss)")
                    with _jup_quote_lock:
                        _sell_route_cache[cache_key] = (time.time(), res)
                    return res
        res = (True, "ok")
        with _jup_quote_lock:
            if len(_sell_route_cache) > 1000: _sell_route_cache.clear()
            _sell_route_cache[cache_key] = (time.time(), res)
        return res
    except Exception:
        return True, "jup_timeout"

def _fetch_rugcheck_report(mint):
    rep = get_json(f"{RUGC}/{mint}/report", timeout=6)
    if not isinstance(rep, dict) or (rep.get("score") is None and not isinstance(rep.get("risks"), list)):
        rep = get_json(f"{RUGC}/{mint}/report/summary", timeout=5)
    return rep

# ---------------------------------------------------------------- owner / creator history & rugpull speed check
_creator_hist_lock = threading.Lock()
_creator_rpc_cache = {}

def _creator_history_path():
    return os.path.join(_base_dir(), "creator_history.json")

def _load_creator_history():
    p = _creator_history_path()
    if not os.path.exists(p):
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def _save_creator_history(hist):
    p = _creator_history_path()
    tmp = p + f".tmp.{os.getpid()}"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(hist, f, indent=2, ensure_ascii=False)
        try:
            os.replace(tmp, p)
        except Exception:
            with open(p, "w", encoding="utf-8") as f:
                json.dump(hist, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

def _parse_ts_ms(val):
    if val is None or val == "":
        return 0
    if isinstance(val, (int, float)):
        num = float(val)
        if num <= 0:
            return 0
        return int(num * 1000) if num < 1e12 else int(num)
    if isinstance(val, str):
        s = val.strip()
        try:
            num = float(s)
            return int(num * 1000) if num < 1e12 else int(num)
        except Exception:
            return _parse_iso_ms(s)
    return 0

def _record_creator_coin(creator, mint, symbol="", created_ms=0, rugged=False, rugged_at_ms=0, rug_reason=""):
    if not creator or not mint:
        return
    now_ms = int(time.time() * 1000)
    with _creator_hist_lock:
        hist = _load_creator_history()
        coins = hist.get(creator)
        if not isinstance(coins, dict):
            coins = {}
        entry = coins.get(mint) if isinstance(coins.get(mint), dict) else {}
        if not entry.get("first_seen_ms"):
            entry["first_seen_ms"] = now_ms
        if symbol and symbol != "?":
            entry["symbol"] = symbol
        if created_ms and created_ms > 0:
            prev_c = int(entry.get("pool_created_at_ms") or 0)
            entry["pool_created_at_ms"] = min(prev_c, int(created_ms)) if prev_c > 0 else int(created_ms)
        if rugged:
            entry["rugged"] = True
            if rugged_at_ms and rugged_at_ms > 0:
                entry["rugged_at_ms"] = int(entry.get("rugged_at_ms") or rugged_at_ms)
            elif not entry.get("rugged_at_ms"):
                entry["rugged_at_ms"] = now_ms
            if rug_reason:
                entry["rug_reason"] = str(rug_reason)[:180]
        entry.setdefault("rugged", False)
        coins[mint] = entry
        # Cap total tracked creators so disk footprint remains bounded
        if len(hist) > 2500:
            oldest_keys = list(hist.keys())[:len(hist) - 2500]
            for k in oldest_keys:
                hist.pop(k, None)
        hist[creator] = coins
        _save_creator_history(hist)

def _mark_creator_coin_rugged(mint, rug_reason="", rugged_at_ms=None, creator=None):
    if not mint:
        return
    now_ms = int(rugged_at_ms or time.time() * 1000)
    with _creator_hist_lock:
        hist = _load_creator_history()
        changed = False
        for c_addr, coins in hist.items():
            if isinstance(coins, dict) and mint in coins and isinstance(coins[mint], dict):
                coins[mint]["rugged"] = True
                if not coins[mint].get("rugged_at_ms"):
                    coins[mint]["rugged_at_ms"] = now_ms
                if rug_reason:
                    coins[mint]["rug_reason"] = str(rug_reason)[:180]
                changed = True
        if creator and (creator not in hist or mint not in (hist.get(creator) or {})):
            coins = hist.get(creator) if isinstance(hist.get(creator), dict) else {}
            coins[mint] = {
                "first_seen_ms": now_ms,
                "pool_created_at_ms": 0,
                "rugged": True,
                "rugged_at_ms": now_ms,
                "rug_reason": str(rug_reason or "rugged")[:180],
            }
            hist[creator] = coins
            changed = True
        if changed:
            _save_creator_history(hist)

def _rpc_earliest_tx_ms(address, cfg=None):
    if not address:
        return 0
    now_ts = time.time()
    cached = _creator_rpc_cache.get(address)
    if cached and now_ts - cached[0] < 180.0:
        return cached[1]
    body = {"jsonrpc": "2.0", "id": 1, "method": "getSignaturesForAddress", "params": [address, {"limit": 100}]}
    for url in _get_rpc_urls(cfg):
        try:
            r = _session.post(url, json=body, timeout=4, headers={**HEADERS, "Content-Type": "application/json"})
            if r.status_code != 200:
                continue
            sigs = (r.json().get("result") or [])
            times = [int(s["blockTime"]) * 1000 for s in sigs if isinstance(s, dict) and s.get("blockTime")]
            if times:
                earliest = min(times)
                _creator_rpc_cache[address] = (now_ts, earliest)
                if len(_creator_rpc_cache) > 1000:
                    _creator_rpc_cache.clear()
                return earliest
        except Exception:
            continue
    return 0

def _evaluate_creator_history(mint, creator_addr, rep, cfg, pair=None):
    """Inspect coin owner's prior launches, rugged coins, and rugpull speed (minutes after launch)."""
    now_ms = int(time.time() * 1000)
    cur_created = int((pair or {}).get("pairCreatedAt") or 0)
    cur_sym = str(((pair or {}).get("baseToken") or {}).get("symbol") or "?")

    prior_map = {}  # prior_mint -> {created_ms, rugged, rugged_at_ms}
    if creator_addr:
        with _creator_hist_lock:
            hist = _load_creator_history()
            local_coins = hist.get(creator_addr)
            if isinstance(local_coins, dict):
                for pmint, info in local_coins.items():
                    if not pmint or pmint == mint or not isinstance(info, dict):
                        continue
                    c_ms = int(info.get("pool_created_at_ms") or info.get("first_seen_ms") or 0)
                    prior_map[pmint] = {
                        "created_ms": c_ms,
                        "rugged": bool(info.get("rugged")),
                        "rugged_at_ms": int(info.get("rugged_at_ms") or 0),
                    }

    if isinstance(rep, dict):
        ct = rep.get("creatorTokens")
        if isinstance(ct, list):
            for item in ct:
                if not isinstance(item, dict):
                    continue
                pmint = str(item.get("mint") or item.get("address") or item.get("id") or "").strip()
                if not pmint or pmint == mint:
                    continue
                c_ms = _parse_ts_ms(item.get("createdAt") or item.get("created_at") or item.get("timestamp"))
                r_flag = bool(item.get("rugged") or item.get("isRugged") or item.get("rug"))
                r_ms = _parse_ts_ms(item.get("ruggedAt") or item.get("rugged_at"))
                if r_flag and r_ms <= 0 and c_ms > 0:
                    r_ms = c_ms
                cur = prior_map.get(pmint, {"created_ms": 0, "rugged": False, "rugged_at_ms": 0})
                if c_ms > 0 and (cur["created_ms"] <= 0 or c_ms < cur["created_ms"]):
                    cur["created_ms"] = c_ms
                if r_flag:
                    cur["rugged"] = True
                if r_ms > 0 and (cur["rugged_at_ms"] <= 0 or r_ms < cur["rugged_at_ms"]):
                    cur["rugged_at_ms"] = r_ms
                prior_map[pmint] = cur

    # Enrich unknown/unmarked prior mints via DexScreener batch lookup to detect LP drains on earlier launches
    unchecked_mints = [pm for pm, pinfo in list(prior_map.items())[:30] if not pinfo["rugged"]]
    if unchecked_mints:
        ds_list = get_json(f"{DEX}/tokens/v1/solana/{','.join(unchecked_mints)}", timeout=4)
        if isinstance(ds_list, list):
            by_pm = {}
            for dp in ds_list:
                if not isinstance(dp, dict):
                    continue
                dmint = (dp.get("baseToken") or {}).get("address")
                if not dmint or dmint not in prior_map:
                    continue
                liq = _f((dp.get("liquidity") or {}).get("usd")) or 0.0
                prev = by_pm.get(dmint)
                if prev is None or liq > (_f((prev.get("liquidity") or {}).get("usd")) or 0.0):
                    by_pm[dmint] = dp
            for dmint, dp in by_pm.items():
                pinfo = prior_map[dmint]
                pc_ms = int(dp.get("pairCreatedAt") or 0)
                if pc_ms > 0 and (pinfo["created_ms"] <= 0 or pc_ms < pinfo["created_ms"]):
                    pinfo["created_ms"] = pc_ms
                liq = _f((dp.get("liquidity") or {}).get("usd")) or 0.0
                h24 = _f((dp.get("priceChange") or {}).get("h24")) or 0.0
                if liq < 500.0 or (liq < 2000.0 and h24 <= -90.0):
                    pinfo["rugged"] = True
                    if pinfo["rugged_at_ms"] <= 0:
                        pinfo["rugged_at_ms"] = now_ms

    # Compute rugpull speed (minutes after launch) for rugged coins, checking RPC earliest tx if launch timestamp missing
    fast_rug_min = None
    rugged_count = 0
    for pm, pinfo in list(prior_map.items()):
        if pinfo["rugged"]:
            rugged_count += 1
            if pinfo["created_ms"] <= 0:
                pinfo["created_ms"] = _rpc_earliest_tx_ms(pm, cfg=cfg)
            if pinfo["created_ms"] > 0 and pinfo["rugged_at_ms"] >= pinfo["created_ms"]:
                delay_m = max(0.0, (pinfo["rugged_at_ms"] - pinfo["created_ms"]) / 60000.0)
                if fast_rug_min is None or delay_m < fast_rug_min:
                    fast_rug_min = delay_m
            if creator_addr:
                _record_creator_coin(creator_addr, pm, created_ms=pinfo["created_ms"], rugged=True, rugged_at_ms=pinfo["rugged_at_ms"])

    # Also detect ultra-rapid serial launches by same creator (re-launching within fast window)
    serial_launch_min = None
    if cur_created > 0 and prior_map:
        for pm, pinfo in prior_map.items():
            if pinfo["created_ms"] > 0 and pinfo["created_ms"] < cur_created:
                gap_m = (cur_created - pinfo["created_ms"]) / 60000.0
                if serial_launch_min is None or gap_m < serial_launch_min:
                    serial_launch_min = gap_m

    # Persist current coin observation for future creator checks
    if creator_addr:
        _record_creator_coin(creator_addr, mint, symbol=cur_sym, created_ms=cur_created)

    # Check RugCheck creator risks
    rc_creator_flag = False
    rc_creator_msg = ""
    if isinstance(rep, dict) and isinstance(rep.get("risks"), list):
        for rsk in rep["risks"]:
            if not isinstance(rsk, dict):
                continue
            rname = str(rsk.get("name") or "")
            if re.search(r"creator.*rug|rugged.*token|serial.*rug", rname, re.I):
                rc_creator_flag = True
                rc_creator_msg = rname
                break

    prior_launches = len(prior_map)
    total_launches = prior_launches + (1 if creator_addr else 0)
    if not opt_on(cfg, "check_creator_history", True):
        return {
            "ok": True, "reason": "disabled", "creator": creator_addr,
            "prior_launches": prior_launches, "total_launches": total_launches,
            "rugged_count": rugged_count, "fast_rug_min": fast_rug_min,
        }

    if rc_creator_flag:
        return {
            "ok": False, "reason": f"owner flagged in RugCheck ({rc_creator_msg})",
            "creator": creator_addr, "prior_launches": prior_launches, "total_launches": total_launches,
            "rugged_count": rugged_count, "fast_rug_min": fast_rug_min,
        }

    if opt_on(cfg, "max_creator_rugged_coins", True):
        max_rugs = max(0, int(cfg.get("max_creator_rugged_coins", 0) or 0))
        if rugged_count > max_rugs:
            speed_note = f" (fastest rug {fast_rug_min:.1f}m after launch)" if fast_rug_min is not None else ""
            return {
                "ok": False,
                "reason": f"owner rugged {rugged_count} prior coin(s) > {max_rugs} limit{speed_note}",
                "creator": creator_addr, "prior_launches": prior_launches, "total_launches": total_launches,
                "rugged_count": rugged_count, "fast_rug_min": fast_rug_min,
            }

    if opt_on(cfg, "creator_fast_rug_window_min", True):
        fast_win = max(0.0, float(cfg.get("creator_fast_rug_window_min", 60.0) or 0.0))
        if fast_win > 0.0 and fast_rug_min is not None and fast_rug_min <= fast_win:
            return {
                "ok": False,
                "reason": f"owner rugged prior coin in {fast_rug_min:.1f}m <= {fast_win:g}m fast-rug window",
                "creator": creator_addr, "prior_launches": prior_launches, "total_launches": total_launches,
                "rugged_count": rugged_count, "fast_rug_min": fast_rug_min,
            }

    if opt_on(cfg, "max_creator_launches", True):
        max_launches = max(0, int(cfg.get("max_creator_launches", 5) or 0))
        if prior_launches > max_launches:
            return {
                "ok": False,
                "reason": f"owner launched {prior_launches} prior coins > {max_launches} limit",
                "creator": creator_addr, "prior_launches": prior_launches, "total_launches": total_launches,
                "rugged_count": rugged_count, "fast_rug_min": fast_rug_min,
            }

    return {
        "ok": True, "reason": "ok", "creator": creator_addr,
        "prior_launches": prior_launches, "total_launches": total_launches,
        "rugged_count": rugged_count,
        "fast_rug_min": fast_rug_min, "serial_launch_min": serial_launch_min,
    }

# ---------------------------------------------------------------- Pro Desk: Reused Socials, Anti-Sybil, Smart Money, Sizing & Telemetry
_social_lock = threading.Lock()
_IGNORED_SOCIAL_HOSTS = {
    "dexscreener.com", "www.dexscreener.com", "pump.fun", "www.pump.fun",
    "solscan.io", "www.solscan.io", "birdeye.so", "www.birdeye.so",
    "gmgn.ai", "jup.ag", "raydium.io", "axiom.trade",
    "photon-sol.tinyastro.io", "rugcheck.xyz",
}

def _social_history_path():
    return os.path.join(_base_dir(), "social_history.json")

def _normalize_social_urls(urls):
    if not isinstance(urls, (list, tuple)):
        return []
    out = []
    seen = set()
    from urllib.parse import urlparse
    for raw in urls:
        s = str(raw or "").strip()
        if not s:
            continue
        try:
            u = urlparse(s if "://" in s else f"https://{s}")
            host = (u.hostname or "").lower()
            if host.startswith("www."):
                host = host[4:]
            if not host or host in _IGNORED_SOCIAL_HOSTS:
                continue
            if host == "twitter.com":
                host = "x.com"
            path = (u.path or "").rstrip("/").lower()
            if not path and host in ("x.com", "t.me"):
                continue
            norm = f"{host}{path}"
        except Exception:
            norm = s.lower().rstrip("/")
        if len(norm) >= 4 and norm not in seen:
            seen.add(norm)
            out.append(norm)
    return out

def _extract_pair_social_urls(pair):
    if not isinstance(pair, dict):
        return []
    raw = []
    info = pair.get("info") if isinstance(pair.get("info"), dict) else {}
    for w in (info.get("websites") or []):
        if isinstance(w, dict) and w.get("url"):
            raw.append(str(w.get("url")))
        elif isinstance(w, str):
            raw.append(w)
    for s in (info.get("socials") or []):
        if isinstance(s, dict) and s.get("url"):
            raw.append(str(s.get("url")))
        elif isinstance(s, dict) and s.get("handle"):
            t = str(s.get("type") or "").lower()
            h = str(s.get("handle") or "").lstrip("@")
            if h and ("twitter" in t or t == "x"):
                raw.append(f"https://x.com/{h}")
            elif h and "telegram" in t:
                raw.append(f"https://t.me/{h}")
    return _normalize_social_urls(raw)

def _load_social_history():
    p = _social_history_path()
    if not os.path.exists(p):
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except Exception:
        return {}

def _save_social_history(hist):
    p = _social_history_path()
    tmp = p + f".tmp.{os.getpid()}"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(hist, f, indent=2, ensure_ascii=False)
        os.replace(tmp, p)
    except Exception:
        pass

def _check_reused_socials(mint, symbol, urls, max_reuse=2):
    norm = _normalize_social_urls(urls)
    if not norm or not mint:
        return True, "ok", None
    now_ms = int(time.time() * 1000)
    with _social_lock:
        hist = _load_social_history()
        blocked = None
        for url in norm:
            rec = hist.get(url)
            if not isinstance(rec, dict):
                continue
            mints = rec.get("mints") if isinstance(rec.get("mints"), dict) else {}
            prior = {m: info for m, info in mints.items() if m != mint}
            rugged_cnt = sum(1 for info in prior.values() if isinstance(info, dict) and info.get("rugged"))
            if rugged_cnt > 0:
                blocked = (False, f"reused social linked to prior rugpull ({url} · {rugged_cnt} rug)", url)
                break
            if len(prior) >= max(1, int(max_reuse or 2)):
                blocked = (False, f"reused social recycled across {len(prior)} prior coins ({url})", url)
                break
        for url in norm:
            rec = hist.get(url) if isinstance(hist.get(url), dict) else {"mints": {}}
            mints = rec.setdefault("mints", {})
            if mint not in mints:
                mints[mint] = {"symbol": symbol, "seen_ms": now_ms, "rugged": False}
            if len(mints) > 50:
                for ok in list(mints.keys())[:-50]:
                    mints.pop(ok, None)
            hist[url] = rec
        if len(hist) > 2000:
            for hk in list(hist.keys())[:-2000]:
                hist.pop(hk, None)
        _save_social_history(hist)
    if blocked:
        return blocked
    return True, "ok", None

def _mark_social_rugged(mint):
    if not mint:
        return
    with _social_lock:
        hist = _load_social_history()
        changed = False
        for _url, rec in hist.items():
            if not isinstance(rec, dict):
                continue
            mints = rec.get("mints")
            if isinstance(mints, dict) and mint in mints and isinstance(mints[mint], dict):
                mints[mint]["rugged"] = True
                changed = True
        if changed:
            _save_social_history(hist)

def _analyze_sybil_details(mint, rep, cfg, creator_addr="", known_pools=None, supply_ui=0.0):
    """Inspect top non-pool holders & creator for shared fresh-wallet funders and coordinated sniper clusters."""
    excl = set(KNOWN_POOL_OR_BURN_OWNERS)
    if known_pools:
        excl.update(known_pools)
    holders = rep.get("topHolders") if isinstance(rep, dict) else None
    if (not isinstance(holders, list) or len(holders) < 2) and supply_ui and supply_ui > 0:
        rpc_rows = _rpc_top_holders_list(mint, supply_ui, exclude_addrs=excl, cfg=cfg)
        if isinstance(rpc_rows, list) and len(rpc_rows) >= 2:
            holders = rpc_rows
    if not isinstance(holders, list) or len(holders) < 2:
        return {"shared_cnt": 0, "shared_funder": None, "dev_shared_funder": None, "fresh_cnt": 0, "fresh_pct": 0.0}

    fresh_min = max(1.0, float((cfg or {}).get("fresh_wallet_minutes", 30.0) or 30.0))
    cutoff_sec = time.time() - (fresh_min * 60.0)
    rpc_urls = _get_rpc_urls(cfg)
    targets = []
    pct_by_owner = {}
    for h in holders[:14]:
        if not isinstance(h, dict):
            continue
        owner = str(h.get("owner") or "").strip()
        addr = str(h.get("address") or "").strip()
        pct = _f(h.get("pct")) or 0.0
        if not owner or owner in excl or addr in excl or "11111111111111111" in owner or pct < 0.3:
            continue
        if owner not in targets:
            targets.append(owner)
            pct_by_owner[owner] = pct
        else:
            pct_by_owner[owner] += pct
        if len(targets) >= 6:
            break
    creator_clean = str(creator_addr or "").strip()
    if len(targets) < 2 and not (creator_clean and creator_clean not in excl and len(targets) >= 1):
        return {"shared_cnt": 0, "shared_funder": None, "dev_shared_funder": None, "fresh_cnt": 0, "fresh_pct": 0.0}

    probe_list = list(targets)
    if creator_clean and creator_clean not in excl and creator_clean not in probe_list:
        probe_list.append(creator_clean)

    def _probe_owner(owner_addr):
        url = rpc_urls[0]
        try:
            r = _session.post(
                url,
                json={"jsonrpc": "2.0", "id": 1, "method": "getSignaturesForAddress", "params": [owner_addr, {"limit": 15}]},
                timeout=1.4,
                headers={**HEADERS, "Content-Type": "application/json"},
            )
            if r.status_code != 200:
                return None
            sigs = (r.json().get("result") or [])
            if not sigs or len(sigs) >= 15:
                return None
            oldest = sigs[-1]
            bt = oldest.get("blockTime")
            if bt and float(bt) < cutoff_sec:
                return None
            sig_str = oldest.get("signature")
            if not sig_str:
                return None
            tr = _session.post(
                url,
                json={"jsonrpc": "2.0", "id": 2, "method": "getTransaction", "params": [sig_str, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}]},
                timeout=1.4,
                headers={**HEADERS, "Content-Type": "application/json"},
            )
            if tr.status_code != 200:
                return None
            keys = ((((tr.json().get("result") or {}).get("transaction") or {}).get("message") or {}).get("accountKeys") or [])
            for k in keys:
                pk = k.get("pubkey") if isinstance(k, dict) else k
                is_sig = k.get("signer", True) if isinstance(k, dict) else True
                if pk and pk != owner_addr and is_sig:
                    return str(pk)
        except Exception:
            return None
        return None

    funder_counts = {}
    creator_funder = None
    fresh_owners = set()
    pool = ThreadPoolExecutor(max_workers=min(7, len(probe_list)))
    try:
        futs = [(o, pool.submit(_probe_owner, o)) for o in probe_list]
        deadline = time.time() + 2.5
        for o, f in futs:
            rem = max(0.05, deadline - time.time())
            try:
                funder = f.result(timeout=rem)
                if funder:
                    if o == creator_clean:
                        creator_funder = funder
                    if o in pct_by_owner:
                        fresh_owners.add(o)
                        funder_counts[funder] = funder_counts.get(funder, 0) + 1
            except Exception:
                pass
    finally:
        pool.shutdown(wait=False)

    fresh_cnt = len(fresh_owners)
    fresh_pct = sum(pct_by_owner.get(o, 0.0) for o in fresh_owners)
    dev_shared_funder = creator_funder if (creator_funder and funder_counts.get(creator_funder, 0) >= 1) else None
    if not funder_counts:
        return {"shared_cnt": 0, "shared_funder": None, "dev_shared_funder": dev_shared_funder, "fresh_cnt": fresh_cnt, "fresh_pct": fresh_pct}
    best_funder = max(funder_counts, key=funder_counts.get)
    return {
        "shared_cnt": funder_counts[best_funder],
        "shared_funder": best_funder,
        "dev_shared_funder": dev_shared_funder,
        "fresh_cnt": fresh_cnt,
        "fresh_pct": fresh_pct,
    }

def _analyze_sybil_funders(mint, rep, cfg):
    """Inspect top non-pool holders' earliest funding tx within tight 2.5s budget."""
    res = _analyze_sybil_details(mint, rep, cfg)
    return res["shared_cnt"], res["shared_funder"]

def _get_pair_smart_buyers(pair, rep, cfg):
    scan_mode = _get_scan_mode(cfg)
    if scan_mode == "sniper_only":
        return []
    if scan_mode != "smart_money_only" and not opt_on(cfg, "smart_money_enabled", True):
        return []
    raw_wallets = (cfg or {}).get("smart_wallets") or []
    smart_set = {str(w).strip() for w in raw_wallets if str(w).strip()}
    if not smart_set:
        return []
    hits = set()
    mint_addr = str(((pair or {}).get("baseToken") or {}).get("address") or "").strip()
    if mint_addr:
        with _ws_feed_lock:
            ws_buyers = set(_ws_smart_buys.get(mint_addr) or ())
        for w in ws_buyers:
            if w in smart_set:
                hits.add(w)
    for w in ((pair or {}).get("_smart_buyers") or []):
        ws = str(w or "").strip()
        if ws in smart_set:
            hits.add(ws)
    pp = (pair or {}).get("_pumpportal") if isinstance((pair or {}).get("_pumpportal"), dict) else {}
    for w in (list(pp.get("buyers") or []) + list(pp.get("recent_buyers") or [])):
        ws = str(w or "").strip()
        if ws in smart_set:
            hits.add(ws)
    holders = rep.get("topHolders") if isinstance(rep, dict) else []
    if isinstance(holders, list):
        for h in holders:
            if not isinstance(h, dict):
                continue
            own = str(h.get("owner") or "").strip()
            adr = str(h.get("address") or "").strip()
            if own in smart_set:
                hits.add(own)
            elif adr in smart_set:
                hits.add(adr)
    return list(hits)

def _evaluate_conviction_mult(pair, cfg, smart_count=0):
    mult = 1.0
    if opt_on(cfg, "conviction_sizing_enabled", True):
        min_m = max(0.1, float((cfg or {}).get("conviction_min_mult", 0.5) or 0.5))
        max_m = max(min_m, float((cfg or {}).get("conviction_max_mult", 1.5) or 1.5))
        score = 0.5
        liq = _f(((pair or {}).get("liquidity") or {}).get("usd")) or 0.0
        if liq >= 50000.0:
            score += 0.2
        elif liq >= 15000.0:
            score += 0.1
        elif liq < 5000.0:
            score -= 0.15
        m5 = ((pair or {}).get("txns") or {}).get("m5") or {}
        buys = int(m5.get("buys") or 0)
        sells = int(m5.get("sells") or 0)
        tot = buys + sells
        ratio = (buys / tot) if tot > 0 else 0.5
        if ratio >= 0.65:
            score += 0.15
        elif ratio < 0.45:
            score -= 0.15
        pp = (pair or {}).get("_pumpportal") if isinstance((pair or {}).get("_pumpportal"), dict) else {}
        if int(pp.get("unique_traders_5m") or 0) >= 15 or int(buys) >= 40:
            score += 0.15
        clamped = max(0.0, min(1.0, score))
        mult = min_m + clamped * (max_m - min_m)

    if opt_on(cfg, "smart_money_enabled", True):
        min_conf = max(1, int((cfg or {}).get("smart_money_min_confluence", 1) or 1))
        if smart_count >= min_conf:
            boost_pct = max(0.0, min(200.0, float((cfg or {}).get("smart_money_size_boost_pct", 35.0) or 0.0)))
            mult *= (1.0 + boost_pct / 100.0)
    return round(max(0.1, min(3.0, mult)), 3)

_py_tel_lock = threading.Lock()

def _append_py_telemetry(mode, side, mint, symbol, dex, platform, quoted_px, fill_px, latency_ms=50, jito_protected=False):
    fp = os.path.join(_base_dir(), "telemetry.json")
    try:
        slip_pct = 0.0
        if quoted_px and quoted_px > 0 and fill_px and fill_px > 0:
            slip_pct = ((fill_px - quoted_px) / quoted_px * 100.0) if side == "BUY" else ((quoted_px - fill_px) / quoted_px * 100.0)
        rec = {
            "tsMs": int(time.time() * 1000),
            "mode": mode,
            "side": side,
            "mint": mint,
            "symbol": symbol,
            "dex": dex or "unknown",
            "platform": platform or "python_sniper",
            "quotedPriceUsd": float(quoted_px or fill_px or 0.0),
            "actualFillPriceUsd": float(fill_px or 0.0),
            "slippagePct": round(slip_pct, 3),
            "latencyMs": int(max(1, latency_ms)),
            "jitoProtected": bool(jito_protected),
        }
        with _py_tel_lock:
            items = []
            if os.path.exists(fp):
                try:
                    with open(fp, "r", encoding="utf-8") as f:
                        d = json.load(f)
                        if isinstance(d, list):
                            items = d
                except Exception:
                    pass
            items.append(rec)
            if len(items) > 500:
                items = items[-500:]
            tmp = fp + f".tmp.{os.getpid()}"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(items, f, indent=2)
            os.replace(tmp, fp)
    except Exception:
        pass

def _evaluate_streak_throttle(acct, cfg, now_ts=None):
    """Inspect closed trades trailing loss streak to pause or half-size entries."""
    if not opt_on(cfg, "streak_throttle_enabled", True):
        return {"active": False, "action": "allow", "size_mult": 1.0, "losses": 0}
    limit = max(1, int((cfg or {}).get("streak_loss_limit", 3) or 3))
    cd_sec = max(1.0, float((cfg or {}).get("streak_cooldown_minutes", 20.0) or 20.0)) * 60.0
    csv_path = getattr(acct, "pnl_csv_path", "")
    if not csv_path or not os.path.exists(csv_path):
        return {"active": False, "action": "allow", "size_mult": 1.0, "losses": 0}
    losses = 0
    latest_loss_ts = 0.0
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        for r in reversed(rows):
            pnl = _f(r.get("pnl_usd"))
            if pnl is None:
                continue
            if pnl < 0:
                losses += 1
                if latest_loss_ts <= 0:
                    ms = _parse_iso_ms(r.get("time"))
                    latest_loss_ts = ms / 1000.0 if ms > 0 else 0.0
            else:
                break
    except Exception:
        return {"active": False, "action": "allow", "size_mult": 1.0, "losses": 0}
    if losses < limit or latest_loss_ts <= 0:
        return {"active": False, "action": "allow", "size_mult": 1.0, "losses": losses}
    t = now_ts if now_ts is not None else time.time()
    if (t - latest_loss_ts) >= cd_sec:
        return {"active": False, "action": "allow", "size_mult": 1.0, "losses": losses}
    raw_act = str((cfg or {}).get("streak_action") or "half_size").strip().lower()
    if raw_act == "pause":
        return {"active": True, "action": "pause", "size_mult": 0.0, "losses": losses}
    return {"active": True, "action": "half_size", "size_mult": 0.5, "losses": losses}

def hard_rug_check(mint, cfg, age_s, pair=None):
    """Return (ok, reason). Fail-closed parallel RPC SPL/Token-2022 + RugCheck + creator history + Sybil + reused socials + holder concentration + sell-route test."""
    tight_score_on = opt_on(cfg, "anti_rug_tight_score_enabled", False)
    pool_depth_on = opt_on(cfg, "anti_rug_pool_depth_check_enabled", True)
    sell_sim_on = opt_on(cfg, "anti_rug_sell_sim_enabled", False)
    early_shield_on = opt_on(cfg, "early_rug_shield_enabled", True)
    lp_req_on = opt_on(cfg, "require_lp_locked", False)
    creator_chk_on = opt_on(cfg, "check_creator_history", True)
    sybil_on = opt_on(cfg, "anti_sybil_enabled", True)
    socials_on = opt_on(cfg, "reused_socials_enabled", True)
    cache_key = (
        f"{mint}:{int(tight_score_on)}:{int(pool_depth_on)}:{int(sell_sim_on)}:{int(early_shield_on)}:{int(lp_req_on)}:"
        f"{int(creator_chk_on)}:{int(sybil_on)}:{int(socials_on)}:{int(opt_on(cfg, 'use_rugcheck', True))}:{int(opt_on(cfg, 'strict_rugcheck', True))}:"
        f"{int(cfg.get('max_creator_launches', 5))}:{int(cfg.get('max_creator_rugged_coins', 0))}:"
        f"{float(cfg.get('creator_fast_rug_window_min', 60) or 0):g}"
    )
    ttl = max(60, int(cfg.get("rug_recheck_minutes", 15) or 15) * 60) if opt_on(cfg, "rug_recheck_minutes", True) else 60
    with _rug_lock:
        hit = _rug_cache.get(cache_key)
        if hit and time.time() - hit[0] < ttl:
            c_hit = _creator_meta_cache.get(mint)
            if isinstance(pair, dict) and isinstance(c_hit, dict):
                if c_hit.get("creator") and not pair.get("_creator"):
                    pair["_creator"] = c_hit["creator"]
                pair["_creator_stats"] = c_hit
            return hit[1]

    strict = opt_on(cfg, "strict_rugcheck", True)
    use_rc = opt_on(cfg, "use_rugcheck", True)
    block_bundles = opt_on(cfg, "block_insider_bundles", True)
    block_dev_dump = opt_on(cfg, "block_creator_dump", True)
    px_usd = _f(pair.get("priceUsd")) if pair is not None else None
    tx_m5 = (pair.get("txns") or {}).get("m5") if isinstance(pair, dict) else None
    pp_info = pair.get("_pumpportal") if isinstance(pair, dict) else None
    observed_sells = max(
        int((tx_m5 or {}).get("sells") or 0),
        int((pp_info or {}).get("sells_60s") or 0),
    )
    need_sell_probe = bool(px_usd and px_usd > 0 and (sell_sim_on or observed_sells < 2))
    sell_impact_cap = 10.0 if sell_sim_on else 15.0

    pool = ThreadPoolExecutor(max_workers=3)
    try:
        _rpc_params = len(inspect.signature(_rpc_mint_account_info).parameters)
    except Exception:
        _rpc_params = 1
    rpc_fut = pool.submit(_rpc_mint_account_info, mint, cfg) if _rpc_params >= 2 else pool.submit(_rpc_mint_account_info, mint)
    rc_fut = pool.submit(_fetch_rugcheck_report, mint) if (use_rc or creator_chk_on) else None
    if need_sell_probe:
        try:
            _sell_params = len(inspect.signature(_check_sell_route).parameters)
        except Exception:
            _sell_params = 4
        sell_fut = (
            pool.submit(_check_sell_route, mint, 6, px_usd, cfg, sell_impact_cap)
            if _sell_params >= 5
            else pool.submit(_check_sell_route, mint, 6, px_usd, cfg)
        )
    else:
        sell_fut = None

    creator_addr = str((pp_info or {}).get("creator") or "")
    try:
        verdict = (True, "ok")
        mint_info = rpc_fut.result()
        decimals = mint_info.get("decimals", 6) if mint_info else 6
        if mint:
            _last_mint_decimals[mint] = decimals
            if len(_last_mint_decimals) > 2000:
                _last_mint_decimals.clear()
        supply_ui = mint_info.get("supply_ui", 0.0) if mint_info else 0.0
        jup_verified = False

        if mint_info is not None:
            if mint_info.get("mint_auth"):
                verdict = (False, "mint authority NOT revoked (on-chain: dev can mint supply)")
            elif mint_info.get("freeze_auth"):
                verdict = (False, "freeze authority enabled (on-chain: dev can freeze sells)")
            elif mint_info.get("disallowed_extensions"):
                exts = ", ".join(mint_info["disallowed_extensions"])
                verdict = (False, f"disallowed Token-2022 extensions: {exts}")
        else:
            has_k = bool(cfg.get("jupiter_api_key")) and opt_on(cfg, "jupiter_api_key", True)
            hdrs = {"x-api-key": cfg["jupiter_api_key"]} if has_k else None
            jt = get_json(f"{JUP}/search", params={"query": mint}, headers=hdrs)
            if isinstance(jt, dict): jt = jt.get("tokens") or jt.get("data") or []
            if isinstance(jt, list) and jt:
                tok = next((t for t in jt if isinstance(t, dict) and t.get("id") == mint), None)
                if tok is None and isinstance(jt[0], dict): tok = jt[0]
                if isinstance(tok, dict):
                    jup_verified = True
                    if tok.get("mintAuthority"): verdict = (False, "mint authority NOT revoked")
                    elif tok.get("freezeAuthority"): verdict = (False, "freeze authority enabled")
            if verdict[0] and strict and not jup_verified:
                verdict = (False, "on-chain RPC inspection unavailable (fail closed)")

        young = age_s < 180
        dex_id = str((pair or {}).get("dexId") or "").lower()
        is_bonding_curve = dex_id == "pumpfun"
        pair_addr = str((pair or {}).get("pairAddress") or "")
        raw_pair_liq = ((pair or {}).get("liquidity") or {}).get("usd") if isinstance(pair, dict) else None
        pair_liq = _f(raw_pair_liq) or 0.0
        min_liq_cfg = float(cfg.get("min_liquidity_usd", 3000) or 0) if opt_on(cfg, "min_liquidity_usd", True) else 0.0
        grace_sec = max(0.0, float(cfg.get("ultra_early_grace_sec", 0) or 0)) if opt_on(cfg, "ultra_early_grace_sec", True) else 0.0

        if verdict[0] and pool_depth_on and isinstance(pair, dict) and raw_pair_liq is not None and age_s > grace_sec:
            if pair_liq < 2500.0:
                verdict = (False, f"pool depth too shallow (${pair_liq:.0f} < $2,500)")

        c_meta = None
        rep = rc_fut.result() if rc_fut is not None else None
        if isinstance(rep, dict) and rep.get("creator"):
            creator_addr = str(rep.get("creator") or creator_addr)
        if not creator_addr and (early_shield_on or creator_chk_on) and mint_info is not None:
            creator_addr = _resolve_creator_via_rpc(mint, cfg=cfg)
        if creator_addr and isinstance(pair, dict):
            pair["_creator"] = creator_addr

        # Owner / creator prior launch count & fast-rug speed check
        if creator_addr or (isinstance(rep, dict) and rep.get("creatorTokens")):
            c_res = _evaluate_creator_history(mint, creator_addr, rep, cfg, pair=pair)
            c_meta = {
                "creator": creator_addr,
                "prior_launches": int(c_res.get("prior_launches") or 0),
                "total_launches": int(c_res.get("total_launches") or (int(c_res.get("prior_launches") or 0) + (1 if creator_addr else 0))),
                "rugged_count": int(c_res.get("rugged_count") or 0),
                "fast_rug_min": c_res.get("fast_rug_min"),
            }
            if isinstance(pair, dict):
                pair["_creator_stats"] = c_meta
            if verdict[0] and not c_res.get("ok"):
                verdict = (False, c_res.get("reason") or "creator failed rug history check")

        if verdict[0] and use_rc:
            if not isinstance(rep, dict) or (not isinstance(rep.get("risks"), list) and rep.get("score") is None):
                if strict:
                    verdict = (False, "no rugcheck report yet (fail closed)")
            else:
                if rep.get("rugged") is True:
                    verdict = (False, "token flagged as RUGGED on RugCheck")

                if verdict[0]:
                    if rep.get("mintAuthority"):
                        verdict = (False, "RugCheck reports active mint authority")
                    elif rep.get("freezeAuthority"):
                        verdict = (False, "RugCheck reports active freeze authority")

                # Block creator dump detected on PumpPortal stream on fresh launches
                pp_meta = (pair or {}).get("_pumpportal") if isinstance((pair or {}).get("_pumpportal"), dict) else None
                if verdict[0] and pp_meta and pp_meta.get("creator_sold") and block_dev_dump and young:
                    verdict = (False, "creator/dev already sold during launch curve")

                # Enforce RugCheck risk score at EVERY age (never skip young tokens)
                if verdict[0] and (opt_on(cfg, "rugcheck_max_score", True) or tight_score_on):
                    sn = _f(rep.get("score_normalised"))
                    if sn is None and _f(rep.get("score")) is not None:
                        raw_s = _f(rep.get("score")) or 0.0
                        sn = min(100.0, raw_s / 100.0) if raw_s > 100.0 else raw_s
                    if sn is not None:
                        if sn > 100: sn /= 1000.0
                        max_rc_score = float(cfg.get("rugcheck_max_score", 55) or 55) if opt_on(cfg, "rugcheck_max_score", True) else 100.0
                        if tight_score_on:
                            max_rc_score = min(max_rc_score, 45.0)
                        if sn >= max_rc_score:
                            verdict = (False, f"rugcheck risk score {sn:.0f}/100 >= {max_rc_score:.0f}")

                # Catch bundled / insider wallet networks & excessive dev holdings before buying
                if verdict[0] and block_bundles:
                    insiders = rep.get("insiderNetworks")
                    insiders_cnt = int(rep.get("insidersDetected") or 0)
                    if (isinstance(insiders, list) and len(insiders) > 0) or insiders_cnt > 0:
                        verdict = (False, f"bundled insider wallets detected ({max(insiders_cnt, len(insiders or []))} clusters)")

                if verdict[0] and opt_on(cfg, "max_dev_hold_pct", True):
                    max_dev_pct = float(cfg.get("max_dev_hold_pct", 5.0) or 0.0)
                    if max_dev_pct > 0:
                        c_addr_chk = str(rep.get("creator") or creator_addr or (pp_meta or {}).get("creator") or "")
                        creator_bal = _f(rep.get("creatorBalance"))
                        token_meta = rep.get("token") if isinstance(rep.get("token"), dict) else {}
                        raw_sup = _f(token_meta.get("supply"))
                        tok_dec = int(token_meta.get("decimals") if token_meta.get("decimals") is not None else decimals)
                        eff_sup = supply_ui if supply_ui > 0 else ((raw_sup / (10 ** tok_dec)) if (raw_sup and tok_dec >= 0) else 0.0)
                        dev_checked = False
                        if creator_bal is not None and eff_sup > 0:
                            # RugCheck creatorBalance may be UI or raw units; normalize conservatively
                            dev_ui = creator_bal / (10 ** tok_dec) if creator_bal > eff_sup * 10 else creator_bal
                            dev_pct = (dev_ui / eff_sup) * 100.0
                            dev_checked = True
                            if dev_pct > max_dev_pct:
                                verdict = (False, f"creator/dev holds {dev_pct:.1f}% > {max_dev_pct:.0f}% limit")
                        if verdict[0] and c_addr_chk and isinstance(rep.get("topHolders"), list):
                            for th in rep["topHolders"][:20]:
                                if isinstance(th, dict) and (th.get("owner") == c_addr_chk or th.get("address") == c_addr_chk):
                                    c_pct = _f(th.get("pct")) or 0.0
                                    dev_checked = True
                                    if c_pct > max_dev_pct:
                                        verdict = (False, f"creator wallet holds {c_pct:.1f}% > {max_dev_pct:.0f}% limit")
                                    break
                        if verdict[0] and early_shield_on and not dev_checked and c_addr_chk and supply_ui > 0:
                            rpc_dev_pct = _rpc_owner_token_pct(mint, c_addr_chk, supply_ui, cfg=cfg)
                            if rpc_dev_pct is not None and rpc_dev_pct > max_dev_pct:
                                verdict = (False, f"creator on-chain holds {rpc_dev_pct:.1f}% > {max_dev_pct:.0f}% limit")

                # Always register AMM/pool pubkeys from RugCheck markets so they are excluded from Top-10 holder %
                known_pools = set()
                if pair_addr:
                    known_pools.add(pair_addr)
                for addr, kinfo in (rep.get("knownAccounts") or {}).items():
                    if isinstance(kinfo, dict):
                        ktype = str(kinfo.get("type") or "").upper()
                        if ktype in ("AMM", "LOCKER", "POOL", "CLOB"):
                            known_pools.add(addr)

                markets = rep.get("markets")
                has_canonical_pool = is_bonding_curve or any(
                    k in dex_id for k in ("pumpswap", "pump", "launchlab", "moonshot")
                )
                if isinstance(markets, list) and markets:
                    for m in markets:
                        if not isinstance(m, dict): continue
                        if m.get("pubkey"):
                            known_pools.add(str(m.get("pubkey")))
                        mtype = str(m.get("marketType") or "").lower()
                        if any(k in mtype for k in ("pump", "launchlab", "moonshot")):
                            has_canonical_pool = True

                if verdict[0] and lp_req_on and not has_canonical_pool:
                    if isinstance(markets, list) and markets:
                        max_lp_pct = 0.0
                        for m in markets:
                            if not isinstance(m, dict): continue
                            lp = m.get("lp") or {}
                            locked_pct = _f(lp.get("lpLockedPct")) or 0.0
                            burned_pct = 100.0 if lp.get("lpBurned") else 0.0
                            max_lp_pct = max(max_lp_pct, locked_pct, burned_pct)
                        if max_lp_pct < 80.0:
                            verdict = (False, f"LP burned/locked {max_lp_pct:.0f}% < 80% minimum (rug risk)")

                top10_enabled = opt_on(cfg, "max_top10_holder_pct", True) or tight_score_on
                max_top10 = float(cfg.get("max_top10_holder_pct", 35) or 35) if opt_on(cfg, "max_top10_holder_pct", True) else 100.0
                if tight_score_on:
                    max_top10 = min(max_top10, 30.0)
                max_single = min(25.0, max(10.0, max_top10 * 0.65))
                if tight_score_on:
                    max_single = min(12.0, max_single)
                elif early_shield_on and young:
                    max_single = min(18.0, max_single)
                top10_pct = None
                single_max_pct = None
                non_pool_pcts = []

                # Compute true non-pool top holder % from full RugCheck report first, else RPC
                top_holders = rep.get("topHolders")
                if isinstance(top_holders, list) and top_holders:
                    for h in top_holders[:20]:
                        if not isinstance(h, dict): continue
                        addr = str(h.get("address") or "")
                        owner = str(h.get("owner") or "")
                        if addr in known_pools or owner in known_pools or addr in KNOWN_POOL_OR_BURN_OWNERS or owner in KNOWN_POOL_OR_BURN_OWNERS:
                            continue
                        pct = _f(h.get("pct"))
                        if pct is not None:
                            non_pool_pcts.append(pct)
                    top10_pct = sum(non_pool_pcts[:10])
                    single_max_pct = max(non_pool_pcts) if non_pool_pcts else 0.0

                if top10_pct is None and supply_ui > 0 and top10_enabled:
                    top10_pct, single_max_pct = _rpc_top_holders(mint, supply_ui, known_pools, cfg=cfg)

                risks = rep.get("risks") if isinstance(rep.get("risks"), list) else []
                if verdict[0]:
                    for risk in risks:
                        if not isinstance(risk, dict): continue
                        level = str(risk.get("level") or "").lower()
                        name = str(risk.get("name") or ""); low = name.lower()
                        desc = str(risk.get("description") or "")
                        if top10_enabled and "holder" in low:
                            m = re.search(r"([\d.]+)\s*%", desc + " " + name)
                            if m and float(m.group(1)) > max_top10:
                                verdict = (False, f"{name} ({m.group(1)}% > {max_top10:.0f}% limit)")
                                break
                        if "unlocked" in low and ("lp" in low or "liquidity" in low):
                            if lp_req_on and not has_canonical_pool:
                                verdict = (False, f"LP risk: {name}")
                                break
                            continue
                        if block_bundles and any(k in low for k in ("bundle", "bundled", "insider", "sniper")):
                            verdict = (False, f"bundle/insider risk: {name}")
                            break
                        if level not in ("danger", "critical"):
                            if strict and any(k in low for k in ("transfer fee", "permanent delegate", "honeypot", "insider", "copycat", "freeze", "mint")):
                                verdict = (False, f"rugcheck risk: {name}")
                                break
                            continue
                        # Exempt only generic 'Low Liquidity' / 'Low amount of LP Providers' when pair liquidity already beat min_liquidity_usd
                        is_generic_liq_warn = ("low liquidity" in low or "low amount of lp providers" in low) and "unlocked" not in low
                        if young and is_generic_liq_warn and pair_liq >= min_liq_cfg:
                            continue
                        if not strict and not any(k in low for k in ("mint", "freeze", "authorit", "holder", "transfer fee", "delegate", "unlocked")):
                            continue
                        verdict = (False, f"rugcheck danger: {name or 'unknown risk'}")
                        break

                if verdict[0] and top10_enabled:
                    if top10_pct is None:
                        if strict:
                            verdict = (False, "top holder concentration unavailable (fail closed)")
                    else:
                        if top10_pct > max_top10:
                            verdict = (False, f"top-10 non-pool holders own {top10_pct:.1f}% > {max_top10:.0f}% limit")
                        elif single_max_pct is not None and single_max_pct > max_single:
                            verdict = (False, f"single holder owns {single_max_pct:.1f}% > {max_single:.0f}% limit")
                        elif early_shield_on and young and len(non_pool_pcts) >= 3:
                            top3_cap = min(max_top10, 34.0)
                            top3_pct = sum(sorted(non_pool_pcts, reverse=True)[:3])
                            if top3_pct > top3_cap:
                                verdict = (False, f"top-3 early holders own {top3_pct:.1f}% > {top3_cap:.0f}% whale-split limit")

                # Pro Desk Group 1A: Anti-Sybil Fresh-Wallet Shared-Funder Cluster Check (enabled on AMM + Pump.fun curves when shield ON)
                if verdict[0] and sybil_on and (early_shield_on or not is_bonding_curve):
                    max_shared = max(2, int(cfg.get("max_shared_funder_count", 3) or 3))
                    syb = _analyze_sybil_details(mint, rep, cfg, creator_addr=creator_addr, known_pools=known_pools, supply_ui=supply_ui)
                    dev_sh = syb.get("dev_shared_funder")
                    shared_cnt = int(syb.get("shared_cnt") or 0)
                    shared_funder = syb.get("shared_funder")
                    if early_shield_on and dev_sh:
                        f_short = f"{dev_sh[:6]}..."
                        verdict = (False, f"dev-linked sybil bundle: creator + holder funded by {f_short}")
                    elif shared_cnt >= max_shared:
                        f_short = f"{shared_funder[:6]}..." if shared_funder else "unknown"
                        verdict = (False, f"sybil cluster: {shared_cnt} fresh holders funded by {f_short} (>= {max_shared})")
                    elif early_shield_on and young and int(syb.get("fresh_cnt") or 0) >= 4 and float(syb.get("fresh_pct") or 0.0) >= 20.0:
                        verdict = (False, f"fresh-wallet sniper bundle ({syb['fresh_cnt']} new wallets hold {syb['fresh_pct']:.1f}%)")

        # Pro Desk Group 1C: Reused Socials (Twitter/Telegram/Website recycling)
        if verdict[0] and socials_on and isinstance(pair, dict):
            sym_s = str(((pair.get("baseToken") or {}).get("symbol") or "?"))
            social_urls = _extract_pair_social_urls(pair)
            if social_urls:
                max_reuse = max(1, int(cfg.get("max_social_reuse_count", 2) or 2))
                s_ok, s_reason, _ = _check_reused_socials(mint, sym_s, social_urls, max_reuse)
                if not s_ok:
                    verdict = (False, s_reason)

        # Pro Desk Group 1B: Smart Money Confluence Tracking
        if verdict[0] and isinstance(pair, dict):
            pair["_smart_buyers"] = _get_pair_smart_buyers(pair, rep, cfg)

        # Pre-buy Jupiter sell-route check (reuses parallel future)
        if verdict[0] and need_sell_probe:
            if sell_fut is not None and decimals == 6:
                route_ok, route_reason = sell_fut.result()
            else:
                try:
                    _sell_params = len(inspect.signature(_check_sell_route).parameters)
                except Exception:
                    _sell_params = 4
                route_ok, route_reason = (
                    _check_sell_route(mint, decimals, px_usd, cfg, sell_impact_cap)
                    if _sell_params >= 5
                    else _check_sell_route(mint, decimals, px_usd, cfg)
                )
            if not route_ok:
                verdict = (False, route_reason)
    finally:
        pool.shutdown(wait=False)

    if not verdict[0] and creator_addr and any(w in verdict[1].lower() for w in ("rug", "honeypot", "authority", "freeze", "lp burned")):
        _mark_creator_coin_rugged(mint, verdict[1], creator=creator_addr)
        _mark_social_rugged(mint)

    with _rug_lock:
        if len(_rug_cache) > 5000: _rug_cache.clear()
        _rug_cache[cache_key] = (time.time(), verdict)
        if c_meta is not None:
            if len(_creator_meta_cache) > 5000: _creator_meta_cache.clear()
            _creator_meta_cache[mint] = c_meta
    return verdict

# ---------------------------------------------------------------- account (paper & live)
def locked(fn):
    def wrapper(self, *args, **kwargs):
        with self.lock: return fn(self, *args, **kwargs)
    return wrapper

class TradingAccount:
    def __init__(self, cfg, mode=None):
        load_settings()
        self.cfg = cfg
        env_mode = (os.environ.get("SNIPER_MODE") or cfg.get("mode") or "paper").strip().lower()
        self.mode = "live" if (mode or env_mode) == "live" else "paper"
        self.lock = threading.RLock()
        base = _base_dir()
        if self.mode == "live":
            self.path = os.path.join(base, "live_state.json")
            self.csv_path = os.path.join(base, "live_trades.csv")
            self.pnl_csv_path = os.path.join(base, "live_pnl_history.csv")
            self.sell_queue_path = os.path.join(base, "live_sell_queue.json")
            self.delete_queue_path = os.path.join(base, "live_delete_queue.json")
        else:
            self.path = os.path.join(base, cfg.get("state_file") or "state.json")
            self.csv_path = os.path.join(base, cfg.get("trades_csv") or "trades.csv")
            self.pnl_csv_path = os.path.join(base, "pnl_history.csv")
            self.sell_queue_path = os.path.join(base, "sell_queue.json")
            self.delete_queue_path = os.path.join(base, "delete_queue.json")

        self.state = {
            "mode": self.mode,
            "cash": 0.0 if self.mode == "live" else cfg["start_balance_usd"],
            "wallet_sol": None,
            "positions": {},
            "day": now().strftime("%Y-%m-%d"),
            "day_pnl": 0.0,
            "total_pnl": 0.0,
            "closed": 0,
            "wins": 0,
            "blacklist": [],
            "last_price_time": 0.0,
            "scan_paused": False,
            "sol_price_usd": None,
            "sol_price_updated_at": 0.0,
            "last_sell_time": 0.0,
            "cooldown_remaining_sec": 0,
        }
        self._last_wallet_sync = 0.0
        self._last_insufficient_log = 0.0
        self._in_flight_buys = 0
        self._last_live_swap_ts = 0.0
        self.load()

    def load(self):
        if os.path.exists(self.path):
            try:
                with open(self.path, encoding="utf-8") as f:
                    self.state.update(json.load(f))
            except Exception:
                pass
        self.state["mode"] = self.mode
        self.state.setdefault("wallet_sol", None)
        self.state.setdefault("blacklist", [])
        self.state.setdefault("last_price_time", 0.0)
        self.state.setdefault("scan_paused", False)
        self.state.setdefault("sol_price_usd", None)
        self.state.setdefault("sol_price_updated_at", 0.0)
        self.state.setdefault("last_sell_time", 0.0)
        self.state.setdefault("cooldown_remaining_sec", 0)

    @locked
    def _drain_delete_queue(self):
        dpath = getattr(self, "delete_queue_path", None)
        if not dpath or not os.path.exists(dpath):
            return False
        try:
            with open(dpath, "r", encoding="utf-8") as f:
                mints = json.load(f)
            try:
                os.remove(dpath)
            except Exception:
                with open(dpath, "w", encoding="utf-8") as f:
                    f.write("[]")
            changed = False
            if isinstance(mints, list):
                bl = self.state.setdefault("blacklist", [])
                for mint in mints:
                    if mint in self.state.get("positions", {}):
                        pos = self.state["positions"].pop(mint, None)
                        if isinstance(pos, dict):
                            cost = float(pos.get("cost") or 0.0)
                            self.state["closed"] = int(self.state.get("closed") or 0) + 1
                            self.state["total_pnl"] = float(self.state.get("total_pnl") or 0.0) - cost
                            self.state["day_pnl"] = float(self.state.get("day_pnl") or 0.0) - cost
                        changed = True
                    if mint and mint not in bl:
                        bl.append(mint)
            return changed
        except Exception:
            return False

    @locked
    def save(self):
        self._drain_delete_queue()
        tmp = self.path + ".tmp"
        payload = json.dumps(self.state, indent=2, ensure_ascii=False)
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(payload)
        for _attempt in range(6):
            try:
                os.replace(tmp, self.path)
                return
            except (PermissionError, OSError):
                time.sleep(0.025)
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                f.write(payload)
        except Exception:
            pass

    def _roll_day(self):
        if self.state["day"] != now().strftime("%Y-%m-%d"):
            self.state["day"] = now().strftime("%Y-%m-%d")
            self.state["day_pnl"] = 0.0

    def is_slots_full(self):
        if not opt_on(self.cfg, "max_open_positions", True):
            return False, len(self.state["positions"]), 0
        max_pos = max(1, int(self.cfg.get("max_open_positions", 3)))
        used = len(self.state["positions"]) + int(getattr(self, "_in_flight_buys", 0))
        return used >= max_pos, used, max_pos

    def sync_live_wallet(self, force=False):
        if self.mode != "live":
            return None
        now_ts = time.time()
        if not force and now_ts - self._last_wallet_sync < 8.0:
            return None
        self._last_wallet_sync = now_ts
        resp = bridge_get("/api/sniper/live-wallet", timeout=6)
        if not isinstance(resp, dict) or not resp.get("ok"):
            return resp
        bal_sol = _f(resp.get("balanceSol"))
        sol_px = _f(resp.get("solPriceUsd")) or self.state.get("sol_price_usd")
        with self.lock:
            if bal_sol is not None:
                self.state["wallet_sol"] = bal_sol
                if sol_px and sol_px > 0:
                    self.state["cash"] = round(bal_sol * sol_px, 4)
                    self.state["sol_price_usd"] = sol_px
                    self.state["sol_price_updated_at"] = now_ts
            self.save()
        return resp

    def can_open(self):
        self._roll_day()
        c = self.cfg
        if opt_on(c, "max_open_positions", True):
            max_pos = max(1, int(c.get("max_open_positions", 3)))
            if len(self.state["positions"]) >= max_pos: return False, "max positions"
        if opt_on(c, "daily_loss_limit_usd", True):
            dll = float(c.get("daily_loss_limit_usd", 0) or 0)
            if dll > 0 and self.state["day_pnl"] <= -dll: return False, "daily loss limit"
        req_size = float(c.get("trade_size_usd", 5.0) or 5.0) if opt_on(c, "trade_size_usd", True) else 5.0
        if self.mode == "live":
            sol_px = self.state.get("sol_price_usd") or 0.0
            bal_sol = self.state.get("wallet_sol")
            if bal_sol is not None:
                avail_usd = float(bal_sol) * float(sol_px or 0.0)
                if float(bal_sol) <= 0.001 or (sol_px > 0 and avail_usd < req_size):
                    return False, f"no SOL/USD in wallet ({float(bal_sol):.4f} SOL / ${avail_usd:.2f})"
        else:
            if self.state["cash"] < req_size:
                return False, f"no cash (${self.state['cash']:.2f})"
        return True, "ok"

    def _log_trade(self, row):
        csv_path = self.csv_path
        new = not os.path.exists(csv_path)
        with open(csv_path, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["time", "action", "symbol", "mint", "price", "usd", "pnl_usd", "pnl_pct", "reason", "dexscreener", "age_s", "dex", "source", "entry_price", "sol_price_usd", "tx_sig"])
            w.writerow(row)

    def _log_pnl(self, row):
        csv_path = self.pnl_csv_path
        new = not os.path.exists(csv_path)
        with open(csv_path, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if new:
                w.writerow([
                    "time", "symbol", "mint", "outcome", "entry_price", "exit_price",
                    "cost_usd", "proceeds_usd", "pnl_usd", "pnl_sol", "pnl_pct",
                    "reason", "hold_seconds", "dex", "source", "sol_price_usd",
                    "tx_buy", "tx_sell", "dexscreener"
                ])
            w.writerow(row)

    @locked
    def note_rejected(self, mint):
        bl = self.state["blacklist"]
        if mint not in bl: bl.append(mint)
        if len(bl) > 5000: del bl[:len(bl) - 5000]
        self.save()

    def buy(self, mint, symbol, price, url=None, meta=None):
        if _should_stop():
            return False
        meta = meta or {}
        c = self.cfg
        url = url or f"https://dexscreener.com/solana/{mint}"
        fast_lock = self.mode == "live" and opt_on(c, "fast_live_buy_enabled", True)
        eff_slip_pct = float(c.get("slippage_pct", 2.0) or 0.0) if opt_on(c, "slippage_pct", True) else 0.0
        eff_fee_pct = float(c.get("fee_pct", 1.0) or 0.0) if opt_on(c, "fee_pct", True) else 0.0
        with self.lock:
            ok, _why = self.can_open()
            if not ok or mint in self.state["positions"] or self.is_slots_full()[0]:
                return False
            base_size = float(c.get("trade_size_usd", 5.0) or 5.0) if opt_on(c, "trade_size_usd", True) else 5.0
            size_mult = float(meta.get("size_mult", 1.0) or 1.0)
            size = round(max(0.5, base_size * size_mult), 4)
            sol_px = self.state.get("sol_price_usd")
            tx_buy = ""
            cost_sol = (size / sol_px) if sol_px and sol_px > 0 else 0.0
            extra_pos = {}
            if fast_lock:
                self._in_flight_buys += 1

        if self.mode == "live":
            try:
                log(f"⚡ LIVE BUY REQUEST {symbol} (${size:.2f}) via Jupiter...")
                buy_payload = {
                    "mint": mint,
                    "symbol": symbol,
                    "tradeSizeUsd": size,
                    "slippagePct": eff_slip_pct if opt_on(c, "slippage_pct", True) else 1.5,
                    "solPriceUsd": sol_px,
                    "dex": meta.get("dex", "?"),
                    "source": meta.get("source", "?"),
                    "age_s": meta.get("age_s", 0),
                    "url": url,
                }
                if fast_lock and meta.get("decimals") is not None:
                    buy_payload["decimals"] = meta.get("decimals")
                if fast_lock:
                    res = bridge_post("/api/sniper/live-buy", buy_payload, timeout=55)
                else:
                    with self.lock:
                        res = bridge_post("/api/sniper/live-buy", buy_payload, timeout=55)
                self._last_live_swap_ts = time.time()
                if _should_stop():
                    if not isinstance(res, dict) or not res.get("ok"):
                        return False
                if not isinstance(res, dict) or not res.get("ok"):
                    err = (res or {}).get("error") or "Live swap failed"
                    with self.lock:
                        if (res or {}).get("insufficientFunds"):
                            if time.time() - self._last_insufficient_log > 10:
                                self._last_insufficient_log = time.time()
                                log(f"⚠ {err}")
                            bal_sol = _f((res or {}).get("walletBalanceSol"))
                            if bal_sol is not None:
                                self.state["wallet_sol"] = bal_sol
                                if sol_px:
                                    self.state["cash"] = round(bal_sol * sol_px, 4)
                                self.save()
                        else:
                            log(f"✗ LIVE BUY FAILED {symbol}: {err}")
                            if (res or {}).get("blacklist"):
                                self.note_rejected(mint)
                    return False

                qty = float(res.get("qty") or 0.0)
                fill = float(res.get("entryPriceUsd") or price)
                size = float(res.get("costUsd") or size)
                cost_sol = float(res.get("costSol") or cost_sol)
                tx_buy = str(res.get("txSig") or "")
                extra_pos = {
                    "raw_amount": str(res.get("rawAmount") or ""),
                    "decimals": int(res.get("decimals") if res.get("decimals") is not None else 6),
                    "cost_sol": cost_sol,
                    "fee_sol": float(res.get("feeSol") or 0.0),
                    "rent_sol": float(res.get("rentSol") or 0.0),
                    "tx_buy": tx_buy,
                    "last_sell_attempt": 0.0,
                }
            finally:
                if fast_lock:
                    with self.lock:
                        self._in_flight_buys = max(0, self._in_flight_buys - 1)
        else:
            with self.lock:
                fill = price * (1 + eff_slip_pct / 100.0)
                qty = (size * (1 - eff_fee_pct / 100.0)) / fill

        with self.lock:
            if self.mode == "live":
                if _f(res.get("solPriceUsd")):
                    sol_px = _f(res.get("solPriceUsd"))
                    self.state["sol_price_usd"] = sol_px
                if _f(res.get("walletBalanceSol")) is not None:
                    bal_sol = float(res["walletBalanceSol"])
                    self.state["wallet_sol"] = bal_sol
                    if sol_px:
                        self.state["cash"] = round(bal_sol * sol_px, 4)
                else:
                    self.state["cash"] = max(0.0, float(self.state.get("cash") or 0.0) - size)
            else:
                self.state["cash"] -= size

            smart_hits = list(dict.fromkeys(
                str(w).strip() for w in (meta.get("smart_wallets_hit") or []) if str(w).strip()
            ))
            smart_entry = bool(meta.get("smart_money_entry") or smart_hits)

            self.state["positions"][mint] = {
                "symbol": symbol,
                "qty": qty,
                "entry_price": fill,
                "current_price": fill,
                "cost": size,
                "original_cost": size,
                "opened": time.time(),
                "last_updated": time.time(),
                "url": url,
                "peak_price": fill,
                "low_price": fill,
                "pnl_pct": 0.0,
                "pnl_usd": 0.0,
                "peak_pct": 0.0,
                "low_pct": 0.0,
                "trailing_active": False,
                "trailing_floor_pct": None,
                "principal_recovered": False,
                "recovered_usd": 0.0,
                "realized_pnl_usd": 0.0,
                "next_scale_out_pct": None,
                "scale_out_count": 0,
                "dex": meta.get("dex", "?"),
                "source": meta.get("source", "?"),
                "creator": meta.get("creator", ""),
                "creator_launches": meta.get("creator_launches"),
                "creator_prior_launches": meta.get("creator_prior_launches"),
                "creator_rugged": meta.get("creator_rugged"),
                "creator_fast_rug_min": meta.get("creator_fast_rug_min"),
                "smart_money_entry": smart_entry,
                "smart_wallets_hit": smart_hits,
                "age_at_entry": round(meta.get("age_s", 0), 1),
                "entry_liquidity_usd": meta.get("liquidity_usd"),
                "current_liquidity_usd": meta.get("liquidity_usd"),
                "entry_liq_source": meta.get("liq_source", "dexscreener"),
                "liq_drop_streak": 0,
                "crash_streak": 0,
                "peak_real_sol": meta.get("real_sol"),
                "current_real_sol": meta.get("real_sol"),
                **extra_pos,
            }
            self.state["blacklist"].append(mint)
            self._log_trade([
                now().isoformat(),
                "BUY",
                symbol,
                mint,
                fmt_price(fill),
                round(size, 4),
                "",
                "",
                "sniper_entry",
                url,
                meta.get("age_s", 0),
                meta.get("dex", "?"),
                meta.get("source", "?"),
                fmt_price(fill),
                round(sol_px, 4) if sol_px else "",
                tx_buy,
            ])
            sol_hint = f" ({cost_sol:.4f} SOL)" if cost_sol else (f" ({size / sol_px:.4f} SOL)" if sol_px else "")
            mode_tag = "LIVE BUY" if self.mode == "live" else "SNIPER BUY"
            tx_hint = f" tx={tx_buy[:8]}..." if tx_buy else ""
            whale_hint = f" [Whale: {smart_hits[0][:6]}...]" if smart_hits else ""
            log(f"✓ {mode_tag} {symbol} [{meta.get('dex', '?')}/{meta.get('source', '?')}] age {meta.get('age_s', 0):.0f}s @ ${fmt_price(fill)}{sol_hint}{whale_hint}{tx_hint}")
            full, cnt, max_pos = self.is_slots_full()
            if full and not self.state.get("scan_paused"):
                self.state["scan_paused"] = True
                log(f"⏸ Slots full ({cnt}/{max_pos}) — stopped scanning for new coins until a slot frees up.")
            self.save()
        if self.mode == "paper":
            _append_py_telemetry(
                self.mode, "BUY", mint, symbol,
                meta.get("dex", "?"), meta.get("source", "python_sniper"),
                price, fill, latency_ms=40, jito_protected=False,
            )
        return True

    def sell(self, mint, price, reason, sell_fraction=1.0):
        if _should_stop():
            return False
        c = self.cfg
        fast_lock = self.mode == "live" and opt_on(c, "fast_live_buy_enabled", True)
        eff_slip_pct = float(c.get("slippage_pct", 2.0) or 0.0) if opt_on(c, "slippage_pct", True) else 0.0
        eff_fee_pct = float(c.get("fee_pct", 1.0) or 0.0) if opt_on(c, "fee_pct", True) else 0.0
        with self.lock:
            pos = self.state["positions"].get(mint)
            if not pos:
                return False
            sol_px = self.state.get("sol_price_usd")
            tx_sell = ""
            req_frac = float(sell_fraction if sell_fraction is not None else 1.0)
            is_partial = 0.01 < req_frac < 0.999
            req_frac = min(1.0, max(0.05, req_frac)) if is_partial else 1.0

            prev_qty = float(pos.get("qty") or 0.0)
            prev_cost = float(pos.get("cost") or 0.0)
            prev_cost_sol = float(pos.get("cost_sol") or 0.0)
            pos_symbol = pos["symbol"]
            pos_raw_amount = pos.get("raw_amount")
            pos_decimals = pos.get("decimals")

            # Avoid leaving microscopic unswappable dust on partial sells
            if is_partial:
                est_rem_usd = (prev_qty * (1.0 - req_frac)) * float(price or 0.0) * (1.0 - eff_fee_pct / 100.0)
                if est_rem_usd < 0.15:
                    req_frac = 1.0
                    is_partial = False

        if self.mode == "live":
            frac_label = f" ({req_frac * 100:.0f}%)" if is_partial else ""
            log(f"⚡ LIVE SELL {pos_symbol}{frac_label} [{reason}] via Jupiter...")
            sell_payload = {
                "mint": mint,
                "symbol": pos_symbol,
                "qty": prev_qty,
                "rawAmount": pos_raw_amount,
                "decimals": pos_decimals,
                "costUsd": prev_cost,
                "costSol": prev_cost_sol,
                "slippagePct": eff_slip_pct if opt_on(c, "slippage_pct", True) else 1.5,
                "solPriceUsd": sol_px,
                "reason": reason,
                "sellFraction": req_frac if is_partial else 1.0,
            }
            if fast_lock:
                res = bridge_post("/api/sniper/live-sell", sell_payload, timeout=95)
            else:
                with self.lock:
                    res = bridge_post("/api/sniper/live-sell", sell_payload, timeout=95)
            self._last_live_swap_ts = time.time()
            if not isinstance(res, dict) or not res.get("ok"):
                err = (res or {}).get("error") or "No live sell route available"
                with self.lock:
                    cur = self.state["positions"].get(mint)
                    if cur:
                        cur["last_sell_attempt"] = time.time()
                        cur["last_sell_error"] = str(err)[:220]
                        cur["last_sell_error_at"] = time.time()
                        self.save()
                log(f"✗ LIVE SELL FAILED {pos_symbol} [{reason}]: {err} (keeping position open)")
                return False

            with self.lock:
                pos = self.state["positions"].get(mint)
                if not pos:
                    return True
                fill = float(res.get("exitPriceUsd") or price)
                proceeds = float(res.get("proceedsUsd") or 0.0)
                sold_frac = float(res.get("soldFraction") or req_frac)
                actual_partial = bool(res.get("isPartial")) and float(res.get("remainingQty") or 0.0) > 0.0
                allocated_cost = prev_cost * sold_frac if actual_partial else prev_cost
                pnl = float(res.get("pnlUsd") if res.get("pnlUsd") is not None else (proceeds - allocated_cost))
                pnl_pct = float(res.get("pnlPct") if res.get("pnlPct") is not None else (pnl / allocated_cost * 100 if allocated_cost else 0.0))
                tx_sell = str(res.get("txSig") or "")
                if _f(res.get("solPriceUsd")):
                    sol_px = _f(res.get("solPriceUsd"))
                    self.state["sol_price_usd"] = sol_px
                if _f(res.get("walletBalanceSol")) is not None:
                    bal_sol = float(res["walletBalanceSol"])
                    self.state["wallet_sol"] = bal_sol
                    if sol_px:
                        self.state["cash"] = round(bal_sol * sol_px, 4)
                else:
                    self.state["cash"] = float(self.state.get("cash") or 0.0) + proceeds

                if actual_partial:
                    is_partial = True
                    pos["qty"] = float(res.get("remainingQty") or 0.0)
                    if res.get("remainingRawAmount"):
                        pos["raw_amount"] = str(res.get("remainingRawAmount"))
                    pos["cost"] = round(max(0.0, prev_cost - allocated_cost), 6)
                    if prev_cost_sol > 0:
                        pos["cost_sol"] = max(0.0, prev_cost_sol * (1.0 - sold_frac))
                    pos["recovered_usd"] = round(float(pos.get("recovered_usd") or 0.0) + proceeds, 4)
                    pos["realized_pnl_usd"] = round(float(pos.get("realized_pnl_usd") or 0.0) + pnl, 4)
                    pos["last_sell_attempt"] = time.time()
                    pos.pop("last_sell_error", None)
                    pos.pop("last_sell_error_at", None)
                else:
                    is_partial = False
                    self.state["positions"].pop(mint, None)
        else:
            with self.lock:
                pos = self.state["positions"].get(mint)
                if not pos:
                    return False
                fill = price * (1 - eff_slip_pct / 100.0)
                if is_partial:
                    sold_qty = prev_qty * req_frac
                    rem_qty = max(0.0, prev_qty - sold_qty)
                    allocated_cost = prev_cost * req_frac
                    proceeds = sold_qty * fill * (1 - eff_fee_pct / 100.0)
                    pnl = proceeds - allocated_cost
                    pnl_pct = (pnl / allocated_cost * 100) if allocated_cost > 0 else 0.0
                    self.state["cash"] += proceeds
                    pos["qty"] = rem_qty
                    pos["cost"] = round(max(0.0, prev_cost - allocated_cost), 6)
                    pos["recovered_usd"] = round(float(pos.get("recovered_usd") or 0.0) + proceeds, 4)
                    pos["realized_pnl_usd"] = round(float(pos.get("realized_pnl_usd") or 0.0) + pnl, 4)
                else:
                    allocated_cost = prev_cost
                    self.state["positions"].pop(mint, None)
                    proceeds = prev_qty * fill * (1 - eff_fee_pct / 100.0)
                    pnl = proceeds - allocated_cost
                    pnl_pct = (pnl / allocated_cost * 100) if allocated_cost > 0 else 0.0
                    self.state["cash"] += proceeds

        r_low = str(reason or "").lower()
        if str(reason) in ("rug_liquidity_drop", "creator_dump_exit", "flash_rug_exit") or "rug" in r_low or "creator_dump" in r_low:
            _mark_creator_coin_rugged(mint, str(reason), creator=(pos or {}).get("creator"))
            _mark_social_rugged(mint)

        if self.mode == "paper":
            _append_py_telemetry(
                self.mode, "SELL", mint, pos.get("symbol", "?"),
                pos.get("dex", "?"), pos.get("source", "python_sniper"),
                price, fill, latency_ms=40, jito_protected=False,
            )

        with self.lock:
            self._roll_day()
            self.state["day_pnl"] += pnl
            self.state["total_pnl"] += pnl
            if not is_partial:
                self.state["closed"] += 1
                cumulative_pnl = float(pos.get("realized_pnl_usd") or 0.0) + pnl
                if cumulative_pnl > 0:
                    self.state["wins"] += 1

            self._log_trade([
                now().isoformat(),
                "SELL",
                pos["symbol"],
                mint,
                fmt_price(fill),
                round(proceeds, 4),
                round(pnl, 4),
                round(pnl_pct, 2),
                reason,
                pos.get("url", ""),
                pos.get("age_at_entry", 0),
                pos.get("dex", "?"),
                pos.get("source", "?"),
                fmt_price(pos["entry_price"]),
                round(sol_px, 4) if sol_px else "",
                tx_sell,
            ])
            now_ts = time.time()
            outcome = "PROFIT" if pnl >= 0 else "LOSS"
            hold_sec = round(now_ts - pos.get("opened", now_ts), 1)
            pnl_sol = round(pnl / sol_px, 6) if sol_px and sol_px > 0 else 0.0
            self._log_pnl([
                now().isoformat(),
                pos["symbol"],
                mint,
                outcome,
                fmt_price(pos["entry_price"]),
                fmt_price(fill),
                round(allocated_cost, 4),
                round(proceeds, 4),
                round(pnl, 4),
                pnl_sol,
                round(pnl_pct, 2),
                reason,
                hold_sec,
                pos.get("dex", "?"),
                pos.get("source", "?"),
                round(sol_px, 4) if sol_px else "",
                pos.get("tx_buy", ""),
                tx_sell,
                pos.get("url", f"https://dexscreener.com/solana/{mint}")
            ])
            sol_hint = f" ({pnl / sol_px:+.4f} SOL)" if sol_px else ""
            tx_hint = f" tx={tx_sell[:8]}..." if tx_sell else ""
            if is_partial:
                mode_tag = "LIVE PARTIAL SELL" if self.mode == "live" else "PARTIAL SELL"
                log(f"💰 {mode_tag} {pos['symbol']} ({req_frac * 100:.0f}%) entry ${fmt_price(pos['entry_price'])} -> exit ${fmt_price(fill)} proceeds ${proceeds:.2f} pnl ${pnl:+.2f}{sol_hint} [{reason}]{tx_hint}")
            else:
                self.state["last_sell_time"] = now_ts
                mode_tag = "LIVE SELL" if self.mode == "live" else "SELL"
                log(f"✗ {mode_tag} {pos['symbol']} entry ${fmt_price(pos['entry_price'])} -> exit ${fmt_price(fill)} pnl ${pnl:.2f}{sol_hint} ({pnl_pct:.1f}%) [{reason}]{tx_hint}")
                rescan_delay = (
                    max(0, int(self.cfg.get("rescan_delay_after_sell_sec", 0) or 0))
                    if opt_on(self.cfg, "rescan_delay_after_sell_sec", True)
                    else 0
                )
                full, cnt, max_pos = self.is_slots_full()
                if rescan_delay > 0:
                    self.state["cooldown_remaining_sec"] = rescan_delay
                    log(f"⏳ Rescan delay active: will wait {rescan_delay}s before searching for new coins.")
                else:
                    self.state["cooldown_remaining_sec"] = 0
                    if not full and self.state.get("scan_paused"):
                        self.state["scan_paused"] = False
                        log(f"▶ Slot freed ({cnt}/{max_pos}) — resuming scan for new coins.")
                        _scan_wake.set()
            self.save()
        return True

    @staticmethod
    def calc_min_recovery_tp_pct(cfg, sol_price_usd=None):
        """Mirror of calcMinRecoveryTakeProfitPct in sniperFormat.ts."""
        trade_size = max(0.01, float(cfg.get("trade_size_usd", 5.0) or 5.0) if opt_on(cfg, "trade_size_usd", True) else 5.0)
        sell_pct = min(95.0, max(5.0, float(cfg.get("recover_principal_sell_pct", 50.0) or 50.0)))
        fee = min(0.45, max(0.0, (float(cfg.get("fee_pct", 1.0) or 0.0) if opt_on(cfg, "fee_pct", True) else 0.0) / 100.0))
        slip = min(0.45, max(0.0, (float(cfg.get("slippage_pct", 2.0) or 0.0) if opt_on(cfg, "slippage_pct", True) else 0.0) / 100.0))
        sell_frac = sell_pct / 100.0
        is_live = str(cfg.get("mode") or "paper").strip().lower() == "live"
        sol_px = float(sol_price_usd or 0.0)
        extra_tx_usd = min(trade_size * 0.25, 0.0002 * sol_px) if (is_live and sol_px > 0) else 0.0
        target_usd = trade_size + extra_tx_usd
        retention = ((1.0 - slip) * (1.0 - fee)) if is_live else ((1.0 - fee) * (1.0 - slip) * (1.0 - fee))
        safe_ret = max(0.05, sell_frac * retention)
        mult_needed = target_usd / (trade_size * safe_ret)
        raw_pct = max(0.0, (mult_needed - 1.0) * 100.0)
        return math.ceil(raw_pct * 10.0) / 10.0, round(target_usd, 4)

    @staticmethod
    def trailing_stop_arm_pct(tp, trail):
        """Minimum peak gain (%) needed before trailing stop becomes active."""
        tp = float(tp or 0.0)
        trail = float(trail or 0.0)
        if trail <= 0.0:
            return 0.0
        if tp > 0.0:
            return tp
        return max(10.0, trail + 5.0)

    @classmethod
    def evaluate_exit_signal(
        cls,
        entry,
        price,
        peak_price,
        tp,
        trail,
        held_minutes,
        max_hold_minutes,
        recover_principal_enabled=False,
        principal_recovered=False,
        recover_sell_pct=50.0,
        scale_out_sell_pct=25.0,
        scale_out_step_gain_pct=100.0,
        next_scale_out_pct=None,
        stop_loss_pct=0.0,
        auto_rug_exit=False,
        entry_liquidity_usd=None,
        current_liquidity_usd=None,
        rug_liq_drop_pct=60.0,
        dex="",
        liq_drop_confirmed=True,
        curve_sol_drained=False,
    ):
        """Return (reason_or_none, trailing_active, drop_from_peak_pnl_pct)."""
        if not entry or entry <= 0 or not price or price <= 0:
            return None, False, 0.0
        tp = float(tp or 0.0)
        trail = float(trail or 0.0)
        sl = max(0.0, float(stop_loss_pct or 0.0))
        peak = max(float(entry), float(peak_price or entry), float(price))
        change_pct = round((price / entry - 1.0) * 100.0, 6)
        peak_chg_pct = round((peak / entry - 1.0) * 100.0, 6)
        drop_from_peak_pct = max(0.0, round(peak_chg_pct - change_pct, 6))

        # 1. Emergency auto-rug exit if AMM pool liquidity drains sharply below entry floor
        # or Pump.fun bonding curve real SOL drains sharply across 2 polls.
        is_bonding_curve = str(dex or "").strip().lower() == "pumpfun"
        if auto_rug_exit and is_bonding_curve and liq_drop_confirmed and curve_sol_drained:
            return "rug_liquidity_drop", False, drop_from_peak_pct
        if (
            auto_rug_exit
            and not is_bonding_curve
            and liq_drop_confirmed
            and entry_liquidity_usd is not None
            and entry_liquidity_usd >= 500.0
            and current_liquidity_usd is not None
        ):
            liq_drop_limit = max(20.0, min(95.0, float(rug_liq_drop_pct or 60.0)))
            liq_drop_pct = (1.0 - float(current_liquidity_usd) / float(entry_liquidity_usd)) * 100.0
            if float(current_liquidity_usd) < 250.0 or liq_drop_pct >= liq_drop_limit:
                return "rug_liquidity_drop", False, drop_from_peak_pct

        # 2. Take profit / Principal recovery / Profit-only trailing stop
        if recover_principal_enabled:
            if not principal_recovered:
                trailing_active = tp > 0.0 and trail > 0.0 and peak_chg_pct >= tp
                if tp > 0.0 and change_pct >= tp:
                    pct_int = int(round(max(5.0, min(95.0, float(recover_sell_pct or 50.0)))))
                    return f"principal_recovery_{pct_int}pct", (trail > 0.0), drop_from_peak_pct
                # If TP spike armed trailing stop before partial sell could fill and price pulled back >= trail, still exit in profit!
                if trailing_active and change_pct > 0.0 and drop_from_peak_pct >= trail:
                    return f"trailing_stop_{trail:g}", True, drop_from_peak_pct
            else:
                # Principal is safely recovered — remaining bag rides with trailing stop + optional scale-out ladder
                trailing_active = trail > 0.0
                if trail > 0.0 and change_pct > 0.0 and drop_from_peak_pct >= trail:
                    return f"trailing_stop_{trail:g}", True, drop_from_peak_pct
                step = float(scale_out_step_gain_pct or 0.0)
                sell_pct = float(scale_out_sell_pct or 0.0)
                if step > 0.0 and sell_pct > 0.0 and next_scale_out_pct is not None and change_pct >= float(next_scale_out_pct):
                    return f"scale_out_{int(round(sell_pct))}pct", trailing_active, drop_from_peak_pct
        elif trail > 0.0:
            arm_pct = cls.trailing_stop_arm_pct(tp, trail)
            trailing_active = peak_chg_pct >= arm_pct
            if trailing_active and change_pct > 0.0 and drop_from_peak_pct >= trail:
                return f"trailing_stop_{trail:g}", True, drop_from_peak_pct
        else:
            trailing_active = False
            if tp > 0.0 and change_pct >= tp:
                return f"take_profit_{tp:g}", False, drop_from_peak_pct

        # 3. Stop loss (protects against slow rugs / post-entry dumps)
        if sl > 0.0 and change_pct <= -sl:
            return f"stop_loss_{sl:g}", trailing_active, drop_from_peak_pct

        max_hold = float(max_hold_minutes or 0.0)
        if max_hold > 0.0 and held_minutes >= max_hold:
            return "max_hold", trailing_active, drop_from_peak_pct

        return None, trailing_active, drop_from_peak_pct

    @locked
    def check_exits(self, prices, liquidities=None, healthy_rev_quotes=None, dex_updates=None, real_sol_updates=None):
        if _should_stop():
            return 0
        self._drain_delete_queue()
        liquidities = liquidities or {}
        healthy_rev_quotes = healthy_rev_quotes or set()
        dex_updates = dex_updates or {}
        real_sol_updates = real_sol_updates or {}
        exits = 0
        tp = float(self.cfg.get("take_profit_pct", 50) or 0.0) if opt_on(self.cfg, "take_profit_pct", True) else 0.0
        sl = float(self.cfg.get("stop_loss_pct", 0) or 0.0) if opt_on(self.cfg, "stop_loss_pct", True) else 0.0
        trail = float(self.cfg.get("trailing_stop_pct", 0) or 0.0) if opt_on(self.cfg, "trailing_stop_pct", True) else 0.0
        max_hold = float(self.cfg.get("max_hold_minutes", 120) or 0.0) if opt_on(self.cfg, "max_hold_minutes", True) else 0.0
        recover_enabled = opt_on(self.cfg, "recover_principal_enabled", False)
        recover_sell_pct = float(self.cfg.get("recover_principal_sell_pct", 50.0) or 50.0) if opt_on(self.cfg, "recover_principal_sell_pct", True) else 50.0
        scale_sell_pct = float(self.cfg.get("scale_out_sell_pct", 25.0) or 25.0) if opt_on(self.cfg, "scale_out_sell_pct", True) else 0.0
        scale_step = float(self.cfg.get("scale_out_step_gain_pct", 100.0) or 0.0) if opt_on(self.cfg, "scale_out_step_gain_pct", True) else 0.0
        auto_rug = opt_on(self.cfg, "auto_rug_exit", False)
        rug_drop = float(self.cfg.get("rug_liq_drop_pct", 60.0) or 60.0) if opt_on(self.cfg, "rug_liq_drop_pct", True) else 60.0
        eff_slip_pct = float(self.cfg.get("slippage_pct", 2.0) or 0.0) if opt_on(self.cfg, "slippage_pct", True) else 0.0
        eff_fee_pct = float(self.cfg.get("fee_pct", 1.0) or 0.0) if opt_on(self.cfg, "fee_pct", True) else 0.0
        now_ts = time.time()
        self.state["last_price_time"] = now_ts
        for mint, pos in list(self.state["positions"].items()):
            if _should_stop():
                break
            prev_dex = str(pos.get("dex") or "").strip().lower()
            new_dex = str(dex_updates.get(mint) or "").strip().lower()
            if new_dex and new_dex != "?" and new_dex != prev_dex:
                pos["dex"] = new_dex
                # If bonding curve migrated to AMM, wait to recalibrate baseline from AMM liquidity
                if prev_dex == "pumpfun" and new_dex != "pumpfun":
                    pos["entry_liq_source"] = "pumpportal"
                    pos["liq_drop_streak"] = 0
            pos_dex = str(pos.get("dex") or "").strip().lower()

            if mint in liquidities and liquidities[mint] is not None:
                liq_val = float(liquidities[mint])
                if not (pos_dex == "pumpfun" and liq_val <= 0):
                    if pos.get("entry_liq_source") == "pumpportal" and liq_val > 0 and pos_dex != "pumpfun":
                        pos["entry_liquidity_usd"] = liq_val
                        pos["entry_liq_source"] = "dexscreener"
                        pos["liq_drop_streak"] = 0
                    pos["current_liquidity_usd"] = liq_val

            if mint in real_sol_updates and real_sol_updates[mint] is not None:
                rs_val = float(real_sol_updates[mint])
                if rs_val >= 0:
                    pos["current_real_sol"] = rs_val
                    prev_peak_rs = _f(pos.get("peak_real_sol"))
                    pos["peak_real_sol"] = max(prev_peak_rs, rs_val) if prev_peak_rs is not None else rs_val

            price = prices.get(mint)
            if price is None or price <= 0:
                continue
            entry = pos["entry_price"]
            prev_cur = float(pos.get("current_price") or entry)
            if prev_cur > 0 and price < prev_cur * 0.30:
                pos["crash_streak"] = int(pos.get("crash_streak", 0) or 0) + 1
                if pos["crash_streak"] < 2 and int(pos.get("liq_drop_streak", 0) or 0) < 2:
                    price = prev_cur
            else:
                pos["crash_streak"] = 0
            pos["current_price"] = price
            pos["last_updated"] = now_ts
            pos["peak_price"] = max(pos.get("peak_price", entry), price)
            pos["low_price"] = min(pos.get("low_price", entry), price)
            change = (price / entry - 1) * 100
            pos["pnl_pct"] = round(change, 2)
            fill = price * (1 - eff_slip_pct / 100.0)
            proceeds = pos["qty"] * fill * (1 - eff_fee_pct / 100.0)
            pos["pnl_usd"] = round(proceeds - pos["cost"], 4)
            pos["peak_pct"] = round((pos["peak_price"] / entry - 1) * 100, 2)
            pos["low_pct"] = round((pos["low_price"] / entry - 1) * 100, 2)

            entry_liq = pos.get("entry_liquidity_usd")
            cur_liq = pos.get("current_liquidity_usd")
            early_shield_on = opt_on(self.cfg, "early_rug_shield_enabled", True)
            liq_drop_confirmed = False
            curve_sol_drained = False
            eff_auto_rug = auto_rug
            eff_rug_drop = rug_drop
            if pos_dex == "pumpfun":
                peak_rs = _f(pos.get("peak_real_sol"))
                cur_rs = _f(pos.get("current_real_sol"))
                if (
                    (auto_rug or early_shield_on)
                    and peak_rs is not None
                    and peak_rs >= 3.0
                    and cur_rs is not None
                    and cur_rs <= peak_rs * 0.35
                    and (auto_rug or change <= -25.0)
                ):
                    has_healthy_quote = mint in healthy_rev_quotes
                    if has_healthy_quote and (change > -35.0 or not auto_rug):
                        pos["liq_drop_streak"] = 0
                    else:
                        pos["liq_drop_streak"] = int(pos.get("liq_drop_streak") or 0) + 1
                        if pos["liq_drop_streak"] >= 2:
                            liq_drop_confirmed = True
                            curve_sol_drained = True
                            eff_auto_rug = True
                else:
                    pos["liq_drop_streak"] = 0
            elif (auto_rug or early_shield_on) and entry_liq is not None and entry_liq >= 500.0 and cur_liq is not None:
                liq_drop_limit = max(20.0, min(95.0, float(rug_drop or 60.0))) if auto_rug else 65.0
                liq_floor_usd = 250.0 if auto_rug else 350.0
                liq_drop_pct_now = (1.0 - float(cur_liq) / float(entry_liq)) * 100.0
                looks_drained = float(cur_liq) < liq_floor_usd or liq_drop_pct_now >= liq_drop_limit
                if looks_drained:
                    has_healthy_quote = mint in healthy_rev_quotes
                    # Never panic-sell on a mild dip when a live Jupiter reverse exit quote is still active
                    if has_healthy_quote and (change > -35.0 or not auto_rug):
                        pos["liq_drop_streak"] = 0
                    elif auto_rug or change <= -25.0:
                        pos["liq_drop_streak"] = int(pos.get("liq_drop_streak") or 0) + 1
                        if pos["liq_drop_streak"] >= 2 or (not has_healthy_quote and ((auto_rug and change <= -50.0) or (early_shield_on and float(cur_liq) < 150.0 and change <= -55.0))):
                            liq_drop_confirmed = True
                            eff_auto_rug = True
                            eff_rug_drop = liq_drop_limit
                    else:
                        pos["liq_drop_streak"] = 0
                else:
                    pos["liq_drop_streak"] = 0
            else:
                pos["liq_drop_streak"] = 0

            held_min = max(0.0, (now_ts - pos["opened"]) / 60.0)
            reason, trailing_active, _drop_pct = self.evaluate_exit_signal(
                entry,
                price,
                pos["peak_price"],
                tp,
                trail,
                held_min,
                max_hold,
                recover_principal_enabled=recover_enabled,
                principal_recovered=bool(pos.get("principal_recovered", False)),
                recover_sell_pct=recover_sell_pct,
                scale_out_sell_pct=scale_sell_pct,
                scale_out_step_gain_pct=scale_step,
                next_scale_out_pct=pos.get("next_scale_out_pct"),
                stop_loss_pct=sl,
                auto_rug_exit=eff_auto_rug,
                entry_liquidity_usd=entry_liq,
                current_liquidity_usd=cur_liq,
                rug_liq_drop_pct=eff_rug_drop,
                dex=pos_dex,
                liq_drop_confirmed=liq_drop_confirmed,
                curve_sol_drained=curve_sol_drained,
            )
            was_active = bool(pos.get("trailing_active"))
            pos["trailing_active"] = trailing_active
            pos["trailing_floor_pct"] = round(max(0.01, pos["peak_pct"] - trail), 2) if (trailing_active and trail > 0) else None
            if trailing_active and not was_active and not str(reason or "").startswith("principal_recovery"):
                log(f"🎯 Trailing stop ARMED for {pos['symbol']}: peak +{pos['peak_pct']:.1f}% | exit floor +{pos['trailing_floor_pct']:.1f}% (-{trail:g}% from peak PnL)")

            if reason:
                if _should_stop():
                    break
                reason_str = str(reason)
                is_recovery = reason_str.startswith("principal_recovery")
                is_scale_out = reason_str.startswith("scale_out")
                if not reason_str.startswith("take_profit") and not is_recovery and not is_scale_out and self.mode == "live":
                    cooldown = 2.0 if (reason_str.startswith("trailing_stop") or reason_str == "rug_liquidity_drop") else 4.0
                    if now_ts - float(pos.get("last_sell_attempt") or 0.0) < cooldown:
                        continue
                sell_frac = (
                    recover_sell_pct / 100.0
                    if is_recovery
                    else (scale_sell_pct / 100.0 if is_scale_out else 1.0)
                )
                if self.sell(mint, price, reason_str, sell_fraction=sell_frac):
                    exits += 1
                    cur_pos = self.state["positions"].get(mint)
                    if cur_pos is not None:
                        if is_recovery:
                            cur_pos["principal_recovered"] = True
                            cur_pos["trailing_active"] = trail > 0.0
                            cur_pos["trailing_floor_pct"] = round(max(0.01, cur_pos["peak_pct"] - trail), 2) if trail > 0 else None
                            cur_pos["next_scale_out_pct"] = round(tp + scale_step, 2) if (scale_step > 0 and scale_sell_pct > 0) else None
                            log(f"🛡️ PRINCIPAL RECOVERED for {cur_pos['symbol']}: initial cost + fees returned · {100 - recover_sell_pct:.0f}% moonbag riding with {trail:g}% trailing stop!")
                            self.save()
                        elif is_scale_out:
                            cur_pos["scale_out_count"] = int(cur_pos.get("scale_out_count") or 0) + 1
                            prev_target = float(cur_pos.get("next_scale_out_pct") or tp)
                            cur_pos["next_scale_out_pct"] = round(max(prev_target + scale_step, change + scale_step), 2)
                            log(f"📈 SCALE-OUT #{cur_pos['scale_out_count']} for {cur_pos['symbol']}: next ladder trigger at +{cur_pos['next_scale_out_pct']:.1f}%")
                            self.save()
        if exits == 0:
            self.save()
        return exits

# Keep backwards compatibility alias
PaperAccount = TradingAccount

# ---------------------------------------------------------------- scan / monitor
_stats_lock = threading.Lock()
_stats = {"since": time.time(), "cands": 0, "no_pair": 0, "checked": 0, "rejects": {}, "rug": 0, "bought": 0, "smart_buys": 0, "whale_held": 0}
_last_block_log = [0.0]
_last_rescan_delay_log = [0.0]
_last_smart_decision_log = {}

def _maybe_summary():
    with _stats_lock:
        if time.time() - _stats["since"] < 60: return
        cands, no_pair, checked = _stats["cands"], _stats["no_pair"], _stats["checked"]
        rejects, rug, bought = dict(_stats["rejects"]), _stats["rug"], _stats["bought"]
        sb_cnt, wh_cnt = _stats.get("smart_buys", 0), _stats.get("whale_held", 0)
        src_bits = [f"{n}={v.get('items', 0)}{'*' if time.time() - v.get('ok_at', 0) > 120 else ''}"
                    for n, v in sorted(_src_stats.items())]
        _stats.update({"since": time.time(), "cands": 0, "no_pair": 0, "checked": 0, "rejects": {}, "rug": 0, "bought": 0, "smart_buys": 0, "whale_held": 0})
    rej_txt = " ".join(f"{k}:{v}" for k, v in sorted(rejects.items(), key=lambda kv: -kv[1]))
    if _get_scan_mode(CONFIG) == "smart_money_only":
        watched = len(CONFIG.get("smart_wallets") or [])
        max_h = max(0.0, float(CONFIG.get("smart_money_max_coin_age_hours", 72) or 0.0))
        age_txt = "any" if max_h <= 0 else f"{max_h:g}h"
        log(f"[SmartMoney] scan summary (60s): watched={watched} whale-signals[live_buys={sb_cnt} held_scans={wh_cnt}] candidates={cands} not-on-dex={no_pair} evaluated={checked} rejected[{rej_txt or '-'}] rug={rug} BOUGHT={bought}")
        if cands == 0 and watched > 0:
            log(f"[SmartMoney] Waiting on {watched} whale(s) — zero new live buys or <={age_txt} held tokens matched this minute (raise Max Coin Age (h) or wait for fresh whale swap).")
        return
    log(f"scan summary (60s): sources[{(' '.join(src_bits)) or 'none'}] new-mints={cands} not-on-dexscreener={no_pair} evaluated={checked} rejected[{rej_txt or '-'}] rug={rug} BOUGHT={bought}")
    if cands == 0 and _src_stats and all(time.time() - v.get("ok_at", 0) > 60 for v in _src_stats.values()):
        log("⚠ all candidate sources returned nothing for 60s — check internet / VPN / rate limits")

def scan_and_buy(acct, cfg):
    if _should_stop():
        return
    maybe_reload_settings()
    if acct.mode == "live":
        acct.sync_live_wallet()
    full, cnt, max_pos = acct.is_slots_full()
    if full:
        if not acct.state.get("scan_paused"):
            acct.state["scan_paused"] = True
            acct.save()
            log(f"⏸ Position slots full ({cnt}/{max_pos}) — stopped scanning for new coins until a slot frees up.")
        return

    # Check post-sell rescan delay
    rescan_delay = (
        max(0, int(cfg.get("rescan_delay_after_sell_sec", 0) or 0))
        if opt_on(cfg, "rescan_delay_after_sell_sec", True)
        else 0
    )
    last_sell = float(acct.state.get("last_sell_time") or 0.0)
    if rescan_delay > 0 and last_sell > 0:
        elapsed = time.time() - last_sell
        if elapsed < rescan_delay:
            remaining = int(math.ceil(rescan_delay - elapsed))
            with acct.lock:
                if acct.state.get("cooldown_remaining_sec") != remaining:
                    acct.state["cooldown_remaining_sec"] = remaining
                    acct.save()
            if time.time() - _last_rescan_delay_log[0] > 10:
                _last_rescan_delay_log[0] = time.time()
                log(f"⏳ Post-sell cooldown active: {remaining}s remaining before rescanning new coins (configured delay: {rescan_delay}s)")
            return
        else:
            with acct.lock:
                if acct.state.get("cooldown_remaining_sec", 0) > 0:
                    acct.state["cooldown_remaining_sec"] = 0
                    acct.save()

    if acct.state.get("scan_paused"):
        acct.state["scan_paused"] = False
        acct.save()
        log(f"▶ Slot freed ({cnt}/{max_pos}) — resuming scan for new coins.")

    _maybe_summary()
    regime = _evaluate_sol_regime(cfg)
    if (regime or {}).get("action") == "pause":
        if time.time() - _last_block_log[0] > 30:
            _last_block_log[0] = time.time()
            log(f"⏸ SOL 15m Red Market Pause active (-{float((regime or {}).get('drop_pct', 0.0)):.2f}% drop in 15m) — skipping fresh entries.")
        return

    streak = _evaluate_streak_throttle(acct, cfg)
    if (streak or {}).get("action") == "pause":
        if time.time() - _last_block_log[0] > 30:
            _last_block_log[0] = time.time()
            log(f"⏸ Losing-Streak Throttle Pause active ({int((streak or {}).get('losses', 0))} consecutive losses) — cooling down.")
        return

    ok, why = acct.can_open()
    if not ok:
        if time.time() - _last_block_log[0] > 30:
            _last_block_log[0] = time.time()
            log(f"Cannot trade: {why}")
        return
    if _should_stop():
        return
    fresh = fetch_candidate_mints(cfg)
    if not fresh or _should_stop(): return
    with _stats_lock: _stats["cands"] += len(fresh)

    now_ms = int(time.time() * 1000)
    pairs = {}
    for i in range(0, len(fresh), 30):
        if _should_stop():
            return
        chunk = fresh[i:i + 30]
        data = get_json(f"{DEX}/tokens/v1/solana/{','.join(chunk)}")
        if not isinstance(data, list): continue
        for p in data:
            mint = (p.get("baseToken") or {}).get("address")
            if not mint: continue
            liq = _f((p.get("liquidity") or {}).get("usd")) or 0.0
            cur = pairs.get(mint)
            if cur is None or liq > cur[0]: pairs[mint] = (liq, p)
    for mint in fresh:
        if mint in pairs and mint in _pumpportal_pairs:
            # Enrich DexScreener pair with real-time PumpPortal 60s trade stream & creator telemetry
            pp_info = _pumpportal_pairs[mint].get("_pumpportal")
            if pp_info and isinstance(pairs[mint][1], dict):
                pairs[mint][1]["_pumpportal"] = pp_info
        elif mint not in pairs and mint in _pumpportal_pairs:
            ppp = _pumpportal_pairs[mint]
            liq = _f((ppp.get("liquidity") or {}).get("usd")) or 0.0
            pairs[mint] = (liq, ppp)
        elif mint not in pairs and mint in _gecko_pairs:
            gp = _gecko_pairs[mint]
            liq = _f((gp.get("liquidity") or {}).get("usd")) or 0.0
            pairs[mint] = (liq, gp)

    # Backfill price via Jupiter if a real-time synthetic launch pair has liq/buys but missing priceUsd
    missing_px_mints = [
        m for m, (_l, p) in pairs.items()
        if (_f(p.get("priceUsd")) or 0.0) <= 0.0
    ]
    if missing_px_mints:
        jup_px = _jupiter_prices(missing_px_mints[:30], cfg)
        for m, px in jup_px.items():
            if m in pairs and px > 0:
                pairs[m][1]["priceUsd"] = str(px)

    _update_pending_dex_mints(fresh, pairs)
    with _stats_lock: _stats["no_pair"] += max(0, len(fresh) - len(pairs))

    # 1. Filter all candidates first so we can rank passing launches by momentum & smart money priority
    passing = []
    for mint, (_liq, pair) in pairs.items():
        if _should_stop():
            return
        if mint in acct.state["positions"] or mint in acct.state["blacklist"]: continue
        sb_hits = _get_pair_smart_buyers(pair, pair.get("_rep"), cfg)
        if sb_hits:
            pair["_smart_buyers"] = sb_hits
        symbol = (pair.get("baseToken") or {}).get("symbol") or "?"
        okp, code, detail = passes_filters(pair, cfg, now_ms, source=_src_of.get(mint, ""))
        with _stats_lock: _stats["checked"] += 1
        if not okp:
            if code == "too old":
                with _seen_lock:
                    _too_old_mints[mint] = time.time()
            with _stats_lock: _stats["rejects"][code] = _stats["rejects"].get(code, 0) + 1
            if sb_hits:
                dkey = f"{mint}:{code}"
                now_log = time.time()
                if now_log - _last_smart_decision_log.get(dkey, 0.0) >= 60.0:
                    _last_smart_decision_log[dkey] = now_log
                    if len(_last_smart_decision_log) > 500:
                        _last_smart_decision_log.clear()
                    log(f"🐋 [SmartMoney] – {symbol} ({mint[:6]}..) skipped: {code} ({detail})")
            elif opt_on(cfg, "log_rejects", False):
                log(f"– {symbol} filtered: {code} ({detail})")
            continue
        passing.append((mint, pair))

    if not passing:
        return

    ranked = rank_candidates(passing, cfg, now_ms)
    if len(ranked) > 1:
        top_sym = (ranked[0][1].get("baseToken") or {}).get("symbol") or "?"
        top_score = score_candidate(ranked[0][1], cfg, now_ms)
        log(f"⚡ Ranked {len(ranked)} passing launches (top: {top_sym} score={top_score:.1f})")

    # 2. Run parallel or sequential hard_rug_check and enter in highest-momentum order until slots fill
    pre_screened = {}
    if opt_on(cfg, "parallel_rug_screen_enabled", True) and len(ranked) > 1:
        top_batch = ranked[:3]
        scr_pool = ThreadPoolExecutor(max_workers=len(top_batch))
        try:
            futs = [
                (
                    m,
                    (p.get("baseToken") or {}).get("symbol") or "?",
                    scr_pool.submit(
                        hard_rug_check,
                        m,
                        cfg,
                        max(0.0, (now_ms - int(p.get("pairCreatedAt") or 0)) / 1000.0),
                        pair=p,
                    ),
                )
                for m, p in top_batch
            ]
            for m, _sym, f in futs:
                try:
                    pre_screened[m] = f.result()
                except Exception:
                    pass
        finally:
            scr_pool.shutdown(wait=False)

    for mint, pair in ranked:
        if _should_stop():
            return
        if acct.is_slots_full()[0]:
            break
        if not acct.can_open()[0]: break
        symbol = (pair.get("baseToken") or {}).get("symbol") or "?"
        age_s = max(0.0, (now_ms - int(pair.get("pairCreatedAt") or 0)) / 1000.0)
        if mint in pre_screened:
            rok, rwhy = pre_screened[mint]
        else:
            rok, rwhy = hard_rug_check(mint, cfg, age_s, pair=pair)
        if not rok:
            with _stats_lock: _stats["rug"] += 1
            log(f"✗ RUG REJECT {symbol}: {rwhy}")
            acct.note_rejected(mint)
            _note_symbol_cooldown(symbol, cfg)
            continue
        if _should_stop():
            return
        # Pro Desk Group 4C: Narrative / Ticker Stem Duplicate Cap
        if opt_on(cfg, "narrative_cap_enabled", True):
            max_same = max(1, int(cfg.get("max_same_narrative_positions", 1) or 1))
            cand_stem = _extract_ticker_stem(symbol)
            open_stems = sum(1 for op in acct.state["positions"].values() if _extract_ticker_stem(op.get("symbol", "")) == cand_stem)
            if open_stems >= max_same:
                with _stats_lock: _stats["rejects"]["narrative_cap"] = _stats["rejects"].get("narrative_cap", 0) + 1
                if opt_on(cfg, "log_rejects", False):
                    log(f"– {symbol} skipped: narrative stem '{cand_stem}' cap ({open_stems}/{max_same})")
                continue

        price = _f(pair.get("priceUsd"))
        if price is None or price <= 0: continue
        liq_usd = _f((pair.get("liquidity") or {}).get("usd"))
        smart_buyers = list(dict.fromkeys(
            str(w).strip()
            for w in (pair.get("_smart_buyers") if isinstance(pair.get("_smart_buyers"), list) else [])
            if str(w).strip()
        ))
        if _get_scan_mode(cfg) == "smart_money_only" and not smart_buyers:
            continue
        if smart_buyers:
            log(f"🐋 [SmartMoney] {len(smart_buyers)} tracked whale(s) buying {symbol} ({smart_buyers[0][:6]}...) — prioritizing entry")
        conv_mult = _evaluate_conviction_mult(pair, cfg, len(smart_buyers))
        regime_mult = float((regime or {}).get("size_mult", 1.0) or 1.0)
        streak_mult = float((streak or {}).get("size_mult", 1.0) or 1.0)
        total_size_mult = round(max(0.1, min(3.0, conv_mult * regime_mult * streak_mult)), 3)
        c_stats = pair.get("_creator_stats") if isinstance(pair.get("_creator_stats"), dict) else {}
        pp_dict = pair.get("_pumpportal") if isinstance(pair.get("_pumpportal"), dict) else {}
        c_addr = pair.get("_creator") or c_stats.get("creator") or pp_dict.get("creator") or ""
        meta = {
            "dex": pair.get("dexId") or "?",
            "source": _src_of.get(mint, "?"),
            "creator": c_addr,
            "creator_launches": c_stats.get("total_launches"),
            "creator_prior_launches": c_stats.get("prior_launches"),
            "creator_rugged": c_stats.get("rugged_count"),
            "creator_fast_rug_min": c_stats.get("fast_rug_min"),
            "smart_wallets_hit": smart_buyers,
            "smart_money_entry": bool(smart_buyers),
            "age_s": age_s,
            "liquidity_usd": liq_usd,
            "real_sol": _f(pp_dict.get("real_sol")),
            "liq_source": "pumpportal" if pair.get("_synthetic") else "dexscreener",
            "decimals": _last_mint_decimals.get(mint),
            "size_mult": total_size_mult,
        }
        if acct.buy(mint, symbol, price, pair.get("url"), meta):
            with _stats_lock: _stats["bought"] += 1
            if acct.is_slots_full()[0]:
                break
        elif acct.mode == "live" and not _should_stop():
            # Brief spacing after a failed live buy prevents back-to-back Jupiter 429 collisions on the next ranked candidate
            time.sleep(0.5 if opt_on(cfg, "fast_live_buy_enabled", True) else 0.9)

_last_rev_quote_ts = [0.0]

def _reverse_quote_prices(pos_dict, cfg, sol_px, acct=None):
    """Fetch true executable exit prices (mint -> WSOL quote) without overloading Jupiter keyless limits."""
    if not opt_on(cfg, "use_real_swap_quotes", True) or not pos_dict:
        return {}
    if opt_on(cfg, "jupiter_quota_guard_enabled", True) and acct is not None and acct.mode == "live":
        if time.time() - float(getattr(acct, "_last_live_swap_ts", 0.0) or 0.0) < 10.0:
            return {}
        has_key = bool(cfg.get("jupiter_api_key")) and opt_on(cfg, "jupiter_api_key", True)
        if not has_key and not acct.is_slots_full()[0]:
            return {}
    now_ts = time.time()
    tp = float(cfg.get("take_profit_pct") or 0.0) if opt_on(cfg, "take_profit_pct", True) else 0.0
    sl = float(cfg.get("stop_loss_pct") or 0.0) if opt_on(cfg, "stop_loss_pct", True) else 0.0
    near_exit = False
    for _m, p in pos_dict.items():
        pnl = float(p.get("pnl_pct") or 0.0)
        if p.get("trailing_active"):
            near_exit = True
            break
        if tp > 0 and pnl >= tp * 0.7:
            near_exit = True
            break
        if sl > 0 and pnl <= -sl * 0.7:
            near_exit = True
            break
    min_interval = 1.2 if near_exit else 4.0
    if now_ts - _last_rev_quote_ts[0] < min_interval:
        return {}
    _last_rev_quote_ts[0] = now_ts

    if _bridge_base_url():
        payload_pos = [
            {
                "mint": mint,
                "qty": float(p.get("qty") or 0.0),
                "decimals": int(p.get("decimals") if p.get("decimals") is not None else 6),
                "rawAmount": p.get("raw_amount"),
            }
            for mint, p in list(pos_dict.items())[:4]
            if float(p.get("qty") or 0.0) > 0
        ]
        if payload_pos:
            resp = bridge_post(
                "/api/sniper/reverse-quotes",
                {"positions": payload_pos, "solPriceUsd": sol_px},
                timeout=4,
            )
            if isinstance(resp, dict) and resp.get("ok") and isinstance(resp.get("prices"), dict):
                return {
                    m: float(v)
                    for m, v in resp["prices"].items()
                    if _f(v) and float(v) > 0
                }
    return {}

def _jupiter_prices(mints, cfg):
    if not opt_on(cfg, "use_jupiter_price", True) or not mints:
        return {}
    has_key = bool(cfg.get("jupiter_api_key")) and opt_on(cfg, "jupiter_api_key", True)
    url = JUP_PRICE if has_key else JUP_PRICE_LITE
    headers = {"x-api-key": cfg["jupiter_api_key"]} if has_key else None
    data = get_json(url, params={"ids": ",".join(mints)}, timeout=4, headers=headers)
    if not isinstance(data, dict):
        return {}
    source_map = data.get("data") if isinstance(data.get("data"), dict) else data
    prices = {}
    for mint in mints:
        quote = source_map.get(mint)
        if isinstance(quote, dict):
            price = _f(quote.get("usdPrice") or quote.get("price"))
            if price is not None and price > 0:
                prices[mint] = price
    return prices

def _process_sell_queue(acct, prices):
    if _should_stop():
        return
    qpath = acct.sell_queue_path
    if not os.path.exists(qpath):
        return
    try:
        with open(qpath, "r", encoding="utf-8") as f:
            mints = json.load(f)
        try:
            os.remove(qpath)
        except Exception:
            with open(qpath, "w", encoding="utf-8") as f:
                f.write("[]")
        if not isinstance(mints, list):
            return
        for mint in mints:
            if _should_stop():
                return
            with acct.lock:
                pos = acct.state["positions"].get(mint)
                px = (prices.get(mint) or pos.get("current_price") or pos.get("entry_price")) if pos else None
            if pos and px:
                acct.sell(mint, px, "manual_exit")
    except Exception:
        pass

_last_liq_poll = [0.0]
_last_orphan_sweep = [0.0]
_last_ws_watch_sig = ["", 0.0]

def monitor(acct):
    if _should_stop():
        return {}
    maybe_reload_settings()
    if acct._drain_delete_queue():
        acct.save()
    sol_px, sol_ts = get_sol_price_usd(acct.cfg)
    if sol_px and sol_px > 0:
        with acct.lock:
            changed = acct.state.get("sol_price_usd") != sol_px
            acct.state["sol_price_usd"] = sol_px
            acct.state["sol_price_updated_at"] = sol_ts
            if changed and not acct.state["positions"]:
                acct.save()
    if acct.mode == "live":
        acct.sync_live_wallet()
        # Pro Desk Group 2C: Periodic live wallet orphan position sweep (~25s)
        if (
            opt_on(acct.cfg, "orphan_sweep_enabled", True)
            and _bridge_base_url()
            and time.time() - _last_orphan_sweep[0] >= 25.0
        ):
            _last_orphan_sweep[0] = time.time()
            try:
                sw = bridge_post("/api/sniper/sweep-orphans", {}, timeout=6)
                if isinstance(sw, dict) and int(sw.get("adopted") or 0) > 0:
                    acct.load()
                    log(f"🔎 Orphan Sweep adopted {sw.get('adopted')} wallet token(s): {', '.join(sw.get('adoptedSymbols') or [])}")
            except Exception:
                pass

    pos = acct.state["positions"]
    # Sync open position mints to Node PumpPortal WS stream for <200ms exits
    if opt_on(acct.cfg, "ws_exit_stream_enabled", True) and _bridge_base_url():
        cur_mints = sorted(list(pos.keys()))
        mints_sig = ",".join(cur_mints)
        if mints_sig != _last_ws_watch_sig[0] or (cur_mints and time.time() - _last_ws_watch_sig[1] >= 10.0):
            _last_ws_watch_sig[0] = mints_sig
            _last_ws_watch_sig[1] = time.time()
            try:
                creators_map = {m: p.get("creator") for m, p in pos.items() if p.get("creator")}
                bridge_post("/api/sniper/ws-watch", {"mints": cur_mints, "creators": creators_map}, timeout=2.5)
            except Exception:
                pass

    if not pos:
        full, cnt, max_pos = acct.is_slots_full()
        if not full and acct.state.get("scan_paused"):
            with acct.lock:
                acct.state["scan_paused"] = False
                acct.save()
            log(f"▶ Slot freed ({cnt}/{max_pos}) — resuming scan for new coins.")
            _scan_wake.set()
        _process_sell_queue(acct, {})
        return {}

    mints = list(pos.keys())
    ws_open, ws_smart_sells = _poll_ws_monitor_feed(acct.cfg, force=False)
    prices = _jupiter_prices(mints, acct.cfg)
    liquidities = {}
    real_sol_updates = {}
    early_shield_on = opt_on(acct.cfg, "early_rug_shield_enabled", True)
    block_dev_dump = opt_on(acct.cfg, "block_creator_dump", True)
    creator_dump_mints = []
    for wm, snap in ws_open.items():
        if wm in pos and isinstance(snap, dict):
            wpx = _f(snap.get("priceUsd"))
            wliq = _f(snap.get("liquidityUsd"))
            wrs = _f(snap.get("realSol"))
            if wpx and wpx > 0:
                prices[wm] = wpx
            if wliq and wliq > 0:
                liquidities[wm] = wliq
            if wrs is not None and wrs >= 0:
                real_sol_updates[wm] = wrs
            p_ref = pos[wm]
            snap_creator = str(snap.get("creator") or "").strip()
            if snap_creator and not p_ref.get("creator"):
                p_ref["creator"] = snap_creator
            pos_creator = str(p_ref.get("creator") or "").strip()
            recent_sellers = snap.get("recentSellers") if isinstance(snap.get("recentSellers"), list) else []
            dev_sold = bool(snap.get("creatorSold") or snap.get("creator_sold") or (pos_creator and pos_creator in recent_sellers))
            if early_shield_on and block_dev_dump and dev_sold:
                creator_dump_mints.append(wm)

    # Immediate dev-dump emergency exit on real-time PumpPortal WS sell event
    for dm in creator_dump_mints:
        p_ref = pos.get(dm)
        if not p_ref:
            continue
        sell_px = prices.get(dm) or p_ref.get("current_price") or p_ref.get("entry_price")
        if sell_px and sell_px > 0:
            log(f"🚨 CREATOR DUMP DETECTED for {p_ref.get('symbol', dm[:6])} — emergency selling immediately to protect capital.")
            if acct.sell(dm, sell_px, "creator_dump_exit"):
                with _ws_feed_lock:
                    _ws_open_prices.pop(dm, None)

    # Auto-exit immediately when a tracked Smart Money wallet sells an open position
    if (
        ws_smart_sells
        and opt_on(acct.cfg, "smart_money_enabled", True)
        and opt_on(acct.cfg, "smart_money_auto_exit_on_sell", True)
    ):
        for sm_mint, sellers in list(ws_smart_sells.items()):
            if sm_mint in pos and sellers:
                p_ref = pos[sm_mint]
                sell_px = prices.get(sm_mint) or p_ref.get("current_price") or p_ref.get("entry_price")
                if sell_px and sell_px > 0:
                    log(f"🚨 SMART MONEY SELL detected for {p_ref.get('symbol', sm_mint[:6])} ({sellers[0][:6]}...) — exiting immediately.")
                    acct.sell(sm_mint, sell_px, "smart_money_sell")
        with _ws_feed_lock:
            _ws_smart_sells.clear()

    mints = list(pos.keys())
    if not mints:
        return prices

    rev_prices = _reverse_quote_prices(pos, acct.cfg, sol_px, acct=acct)
    if rev_prices:
        prices.update(rev_prices)
    dex_updates = {}
    missing = [mint for mint in mints if mint not in prices]
    need_liq_check = (bool(acct.cfg.get("auto_rug_exit", False)) or early_shield_on) and (time.time() - _last_liq_poll[0] >= 3.0)
    ds_targets = mints if need_liq_check else missing
    if need_liq_check and ds_targets:
        _last_liq_poll[0] = time.time()
    for i in range(0, len(ds_targets), 30):
        if _should_stop():
            return prices
        chunk = ds_targets[i:i + 30]
        data = get_json(f"{DEX}/tokens/v1/solana/{','.join(chunk)}", timeout=4)
        if isinstance(data, list):
            best_by_mint = {}
            for p in data:
                if not isinstance(p, dict): continue
                mint = (p.get("baseToken") or {}).get("address")
                if mint in pos:
                    price = _f(p.get("priceUsd"))
                    raw_liq = _f((p.get("liquidity") or {}).get("usd"))
                    dex_id = str(p.get("dexId") or "").strip().lower()
                    liq_valid = raw_liq if (raw_liq is not None and (raw_liq > 0 or dex_id != "pumpfun")) else None
                    score_liq = liq_valid if liq_valid is not None else -1.0
                    cur = best_by_mint.get(mint)
                    if cur is None or score_liq > cur[0]:
                        best_by_mint[mint] = (score_liq, liq_valid, price, dex_id)
            for mint, (_score_liq, liq_valid, price, dex_id) in best_by_mint.items():
                if dex_id:
                    dex_updates[mint] = dex_id
                if liq_valid is not None:
                    liquidities[mint] = liq_valid
                if mint not in prices and price is not None and price > 0:
                    prices[mint] = price

    if _should_stop():
        return prices
    _process_sell_queue(acct, prices)
    acct.check_exits(
        prices,
        liquidities=liquidities,
        healthy_rev_quotes=set(rev_prices.keys()),
        dex_updates=dex_updates,
        real_sol_updates=real_sol_updates,
    )
    return prices

def probe(cfg):
    """One-shot diagnostic: what candidates exist right now and exactly why each is/ isn't bought."""
    log("--- PROBE: force-fetching all sources now ---")
    cands = fetch_candidate_mints(cfg, force=True)
    log(f"probe: {len(cands)} fresh mints right now")
    if not cands:
        log("probe: 0 candidates → all sources returned nothing (internet/VPN/CF block?)")
        return
    now_ms = int(time.time() * 1000)
    grace = cfg.get("ultra_early_grace_sec", 10)
    shown = 0
    for i in range(0, len(cands), 30):
        chunk = cands[i:i + 30]
        data = get_json(f"{DEX}/tokens/v1/solana/{','.join(chunk)}")
        plist = data if isinstance(data, list) else []
        if not plist:
            log(f"probe: no pair data on DexScreener for {len(chunk)} mints (too new / not indexed yet)")
        for p in plist:
            sym = ((p.get("baseToken") or {}).get("symbol") or "?")[:10]
            created = int(p.get("pairCreatedAt") or 0)
            age = (now_ms - created) / 1000.0 if created else -1
            liq = _f((p.get("liquidity") or {}).get("usd")) or 0.0
            m5 = (p.get("txns") or {}).get("m5") or {}
            buys, sells = int(m5.get("buys") or 0), int(m5.get("sells") or 0)
            chg = _f((p.get("priceChange") or {}).get("m5"))
            pmint = (p.get("baseToken") or {}).get("address") or ""
            ok, code, detail = passes_filters(p, cfg, now_ms, source=_src_of.get(pmint, ""))
            tag = "WOULD BUY → rug check" if ok else f"filtered: {code} ({detail})"
            early = " [ultra-early]" if 0 <= age <= grace else ""
            log(f"probe: {sym:<10} {str(p.get('dexId', '?'))[:10]:<10} age={age:6.1f}s{early} liq=${liq:8.0f} {buys}b/{sells}s m5={chg if chg is not None else '?'}% → {tag}")
            shown += 1
            if shown >= 25:
                log("probe: (first 25 shown)")
                return
    if shown == 0:
        log("probe: 0 pairs found on DexScreener for current candidates.")

def _register_stop_signals():
    def _handle_signal(_signum, _frame):
        _stop_event.set()
        _scan_wake.set()
    for sig_name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        sig = getattr(signal, sig_name, None)
        if sig is not None:
            try:
                signal.signal(sig, _handle_signal)
            except Exception:
                pass

def _write_pid_file(mode):
    pf = _pid_file_path()
    try:
        with open(pf, "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid(), "run_id": _run_id, "mode": mode, "started_at": time.time()}, f)
    except Exception:
        pass

def _cleanup_pid_file():
    pf = _pid_file_path()
    try:
        if os.path.exists(pf):
            with open(pf, "r", encoding="utf-8") as f:
                info = json.load(f)
            if not isinstance(info, dict) or not _run_id or info.get("run_id") == _run_id:
                os.remove(pf)
    except Exception:
        pass

def run(once=False):
    global _run_id
    load_settings()
    _run_id = _resolve_arg_run_id()
    if not _run_id:
        # Standalone CLI run: clear any stale stop flag from previous UI session
        try:
            if os.path.exists(_stop_flag_path()):
                os.remove(_stop_flag_path())
        except Exception:
            pass
    elif os.path.exists(_stop_flag_path()):
        log("Stop flag already present at launch — exiting cleanly.")
        return

    _register_stop_signals()
    mode = (os.environ.get("SNIPER_MODE") or CONFIG.get("mode") or "paper").strip().lower()
    mode = "live" if mode == "live" else "paper"
    if not once:
        _write_pid_file(mode)

    acct = TradingAccount(CONFIG, mode=mode)
    sol_px, sol_ts = get_sol_price_usd(CONFIG, force=True)
    if sol_px and sol_px > 0:
        with acct.lock:
            acct.state["sol_price_usd"] = sol_px
            acct.state["sol_price_updated_at"] = sol_ts
            acct.save()
    if mode == "live":
        acct.sync_live_wallet(force=True)
    sol_banner = f" | SOL=${sol_px:.2f}" if sol_px else ""
    mode_banner = "LIVE MODE — REAL SOLANA WALLET" if mode == "live" else "PAPER MODE"
    log(f"=== MULTI-SOURCE SNIPER STARTED ({mode_banner}) ===")
    if mode == "live":
        bal_sol = acct.state.get("wallet_sol")
        bal_usd = acct.state.get("cash") or 0.0
        if bal_sol is not None:
            t_sz = float(CONFIG.get("trade_size_usd", 5.0) or 5.0) if opt_on(CONFIG, "trade_size_usd", True) else 5.0
            log(f"Wallet balance: {float(bal_sol):.4f} SOL (${float(bal_usd):.2f}) | trade size ${t_sz:.2f}")
    scan_mode_banner = _get_scan_mode(CONFIG)
    if scan_mode_banner == "smart_money_only":
        w_cnt = len(CONFIG.get("smart_wallets") or [])
        log(f"Strategy: WHALE WALLETS ONLY (smart_money_only) | Watching {w_cnt} tracked whale wallet(s) · PumpPortal Account WS + On-Chain Holdings{sol_banner}")
    else:
        log(f"Sources: gecko={opt_on(CONFIG, 'use_gecko', True)} jupiter={opt_on(CONFIG, 'use_jupiter_recent', True)} profiles={opt_on(CONFIG, 'use_dex_profiles', True)} pumpportal={opt_on(CONFIG, 'use_pumpportal', True)} boosts={opt_on(CONFIG, 'use_promoted_feeds', False)} | mode={scan_mode_banner}{sol_banner}")
    plats = CONFIG.get("enabled_platforms") if (opt_on(CONFIG, "enabled_platforms", True) and isinstance(CONFIG.get("enabled_platforms"), list)) else []
    log(f"Websites: {', '.join(str(x) for x in plats) if plats else 'ALL (no restriction)'}")
    tp_cfg = float(CONFIG.get("take_profit_pct", 50) or 0.0) if opt_on(CONFIG, "take_profit_pct", True) else 0.0
    tr_cfg = float(CONFIG.get("trailing_stop_pct", 0) or 0.0) if opt_on(CONFIG, "trailing_stop_pct", True) else 0.0
    rec_enabled = opt_on(CONFIG, "recover_principal_enabled", False)
    rec_sell_pct = float(CONFIG.get("recover_principal_sell_pct", 50.0) or 50.0) if opt_on(CONFIG, "recover_principal_sell_pct", True) else 50.0
    scale_sell_pct = float(CONFIG.get("scale_out_sell_pct", 25.0) or 25.0) if opt_on(CONFIG, "scale_out_sell_pct", True) else 0.0
    scale_step_pct = float(CONFIG.get("scale_out_step_gain_pct", 100.0) or 0.0) if opt_on(CONFIG, "scale_out_step_gain_pct", True) else 0.0

    if rec_enabled:
        min_tp, target_usd = TradingAccount.calc_min_recovery_tp_pct({**CONFIG, "mode": mode}, sol_px)
        t_sz = float(CONFIG.get("trade_size_usd", 5.0) or 5.0) if opt_on(CONFIG, "trade_size_usd", True) else 5.0
        if tp_cfg <= 0 or tp_cfg + 1e-9 < min_tp:
            log(f"✗ INVALID SETTINGS: Investment is ${t_sz:.2f} (requires ~${target_usd:.2f} back incl. fees). Selling {rec_sell_pct:g}% requires Take Profit >= +{min_tp:.1f}% (got +{tp_cfg:g}%). Exiting.")
            _cleanup_pid_file()
            return
        scale_note = f" + {scale_sell_pct:g}% scale-out every +{scale_step_pct:g}%" if (scale_step_pct > 0 and scale_sell_pct > 0) else ""
        trail_note = f" + {tr_cfg:g}% trail" if tr_cfg > 0 else ""
        exit_banner = f"Recover {rec_sell_pct:g}% @ +{tp_cfg:g}% TP{scale_note}{trail_note}"
    elif tp_cfg > 0 and tr_cfg > 0:
        exit_banner = f"TP +{tp_cfg:g}% arms {tr_cfg:g}% trail (profit-only)"
    elif tp_cfg > 0:
        exit_banner = f"TP +{tp_cfg:g}%"
    elif tr_cfg > 0:
        exit_banner = f"Profit-only Trail {tr_cfg:g}% (arms +{TradingAccount.trailing_stop_arm_pct(0, tr_cfg):.0f}%)"
    else:
        exit_banner = "TP/Trail OFF"
    min_age_banner = f"{float(CONFIG.get('min_age_minutes', 0) or 0):g}m" if opt_on(CONFIG, "min_age_minutes", False) else "0m"
    max_age_banner = f"{float(CONFIG.get('max_age_minutes', 2) or 2):g}m" if opt_on(CONFIG, "max_age_minutes", True) else "any"
    grace_banner = float(CONFIG.get("ultra_early_grace_sec", 0) or 0) if opt_on(CONFIG, "ultra_early_grace_sec", True) else 0
    liq_banner = float(CONFIG.get("min_liquidity_usd", 5000) or 0) if opt_on(CONFIG, "min_liquidity_usd", True) else 0
    pump_banner = f"+{float(CONFIG.get('max_price_change_m5_pct', 250) or 0):.0f}%" if opt_on(CONFIG, "max_price_change_m5_pct", True) else "OFF"
    creator_banner = f"owner-chk={'ON' if opt_on(CONFIG, 'check_creator_history', True) else 'OFF'}"
    if scan_mode_banner == "smart_money_only":
        whale_h = max(0.0, float(CONFIG.get("smart_money_max_coin_age_hours", 72) or 0.0))
        whale_age_txt = "Any age" if whale_h <= 0 else f"<={whale_h:g}h"
        log(f"Whale Rules: {exit_banner} | coin-age {whale_age_txt} | liq>=${liq_banner:.0f} | pump cap {pump_banner} | rug={'ON' if opt_on(CONFIG, 'use_rugcheck', True) else 'OFF'} | {creator_banner}")
    else:
        log(f"Window: coins {min_age_banner}–{max_age_banner} old (grace <{grace_banner:g}s skips liquidity/buy floors) | {exit_banner} | liq>=${liq_banner:.0f} after grace | pump cap {pump_banner} | rug={'ON' if opt_on(CONFIG, 'use_rugcheck', True) else 'OFF'} | {creator_banner}")
    if once:
        try:
            scan_and_buy(acct, CONFIG)
            monitor(acct)
        finally:
            _cleanup_pid_file()
        return

    def scan_loop():
        while not _should_stop():
            started = time.time()
            try:
                scan_and_buy(acct, CONFIG)
            except Exception as e:
                if not _should_stop():
                    log(f"scan error: {e}")
            scan_iv = float(CONFIG.get("scan_interval_sec", 1) or 1) if opt_on(CONFIG, "scan_interval_sec", True) else 1.0
            wait_sec = max(0.1, scan_iv - (time.time() - started))
            _interruptible_wait(wait_sec, _scan_wake)

    threading.Thread(target=scan_loop, daemon=True).start()
    try:
        while not _should_stop():
            started = time.time()
            try:
                monitor(acct)
            except KeyboardInterrupt:
                _stop_event.set()
                _scan_wake.set()
                break
            except Exception as e:
                if not _should_stop():
                    log(f"monitor error: {e}")
            mon_iv = float(CONFIG.get("monitor_interval_sec", 1.0) or 1.0) if opt_on(CONFIG, "monitor_interval_sec", True) else 1.0
            wait_sec = max(0.1, mon_iv - (time.time() - started))
            _interruptible_wait(wait_sec)
    finally:
        _stop_event.set()
        _scan_wake.set()
        _cleanup_pid_file()
        log("Python sniper loop exited cleanly.")

if __name__ == "__main__":
    if "--probe" in sys.argv: probe(CONFIG)
    else: run(once="--once" in sys.argv)