#!/usr/bin/env python3
"""
Multi-source new-launch sniper (PAPER & LIVE MODES).
Sources: GeckoTerminal new pools (ALL Solana DEXes), Jupiter recent, DexScreener
profiles (+optional boosted), PumpPortal new launches.
Rug screen: on-chain mint/freeze authority (Solana RPC) + Jupiter audit + RugCheck.
Entry: coins younger than max_age_minutes; coins younger than ultra_early_grace_sec
skip the liquidity/buy-volume floors (true "first seconds" entries).
"""
import csv
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
    "take_profit_pct": 50.0, "trailing_stop_pct": 0.0, "max_hold_minutes": 120,
    # sniper window: buy ONLY coins younger than this
    "max_age_minutes": 2.0,
    # coins younger than this skip the liquidity / buy-volume floors (first-seconds entries)
    "ultra_early_grace_sec": 10,
    # scan speed
    "scan_interval_sec": 1, "monitor_interval_sec": 1.0,
    # entry guards (applied after the grace window)
    "min_liquidity_usd": 300.0, "min_volume_m5_usd": 0.0,
    "min_buys_m5": 2, "min_buy_sell_ratio_m5": 1.0,
    "max_price_change_m5_pct": 300.0,
    "min_holders": 0,
    # hard rug screen
    "use_rugcheck": True, "strict_rugcheck": True, "rugcheck_max_score": 50.0,
    "max_top10_holder_pct": 75.0, "rug_recheck_minutes": 15,
    # candidate sources (any-DEX coverage)
    "use_gecko": True, "use_jupiter_recent": True, "use_dex_profiles": True,
    "use_pumpportal": True, "use_promoted_feeds": False,
    # misc
    "slippage_pct": 2.0, "fee_pct": 1.0,
    "state_file": "state.json", "trades_csv": "trades.csv",
    "log_rejects": True, "jupiter_api_key": "",
    # compatibility keys kept so old settings files still load
    "cooldown_minutes": 60, "min_volume_h1_usd": 0.0, "min_age_minutes": 0,
    "max_age_hours": 24, "min_buys_h1": 0, "min_buy_sell_ratio_h1": 0.0,
    "use_jupiter_price": True, "pool_keep_hours": 1, "pool_max_size": 500,
    "rescan_delay_after_sell_sec": 0,
}

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
RUGC = "https://api.rugcheck.xyz/v1/tokens"
PUMPP = "https://api.pumpportal.fun/api/data"
RPC_URLS = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
]
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

def get_sol_price_usd(cfg=None, force=False):
    """Fetch and cache live SOL/USD price every 12s via Jupiter / DexScreener."""
    now_ts = time.time()
    with _sol_lock:
        if not force and _sol_cache["price"] and now_ts - _sol_cache["updated_at"] < 12.0:
            return _sol_cache["price"], _sol_cache["updated_at"]

    cfg = cfg or CONFIG
    price = None
    has_key = bool(cfg.get("jupiter_api_key"))
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
        return price, now_ts

    with _sol_lock:
        return _sol_cache["price"], _sol_cache["updated_at"]

# ---------------------------------------------------------------- candidate sources
_src_last, _src_stats = {}, {}
_src_lock = threading.Lock()
_seen, _seen_lock = {}, threading.Lock()
_too_old_mints = {}
_src_of = {}
_gecko_pairs = {}
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

def _fresh_only(mints):
    t = time.time()
    with _seen_lock:
        return [
            m for m in mints
            if (t - _seen.get(m, 0) > SEEN_TTL_SEC) and (m not in _too_old_mints)
        ]

def _src_gecko(cfg):
    global _gecko_backoff_until
    if not cfg.get("use_gecko", True):
        return []
    now_ts = time.time()
    if now_ts < _gecko_backoff_until:
        return []
    out = []
    try:
        r = _session.get(GECKO, params={"page": 1}, headers=HEADERS, timeout=6)
        if r.status_code == 429:
            _gecko_backoff_until = time.time() + 45.0
            return []
        r.raise_for_status()
        data = r.json()
    except Exception:
        return []
    if not (isinstance(data, dict) and isinstance(data.get("data"), list)):
        return []
    for pool in data["data"]:
        try:
            rel = pool.get("relationships") or {}
            tid = ((rel.get("base_token") or {}).get("data") or {}).get("id", "")
            if not tid.startswith("solana_"):
                continue
            mint = tid[len("solana_"):]
            if not mint or len(mint) <= 20:
                continue
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
    if len(_gecko_pairs) > 500:
        for k in list(_gecko_pairs.keys())[:250]:
            _gecko_pairs.pop(k, None)
    return out

def _src_jup(cfg):
    if not cfg.get("use_jupiter_recent", True): return []
    hdrs = {"x-api-key": cfg["jupiter_api_key"]} if cfg.get("jupiter_api_key") else None
    data = get_json(f"{JUP}/recent", headers=hdrs)
    if isinstance(data, list): items = data
    elif isinstance(data, dict): items = data.get("tokens") or data.get("data") or []
    else: return []
    return [t.get("id") for t in items if isinstance(t, dict) and t.get("id")]

def _src_profiles(cfg):
    if not cfg.get("use_dex_profiles", True): return []
    data = get_json(f"{DEX}/token-profiles/latest/v1")
    if not isinstance(data, list): return []
    return [d.get("tokenAddress") for d in data
            if isinstance(d, dict) and d.get("chainId") == "solana" and d.get("tokenAddress")]

def _src_boosts(cfg):
    if not cfg.get("use_promoted_feeds", False): return []
    data = get_json(f"{DEX}/token-boosts/latest/v1")
    if not isinstance(data, list): return []
    return [d.get("tokenAddress") for d in data
            if isinstance(d, dict) and d.get("chainId") == "solana" and d.get("tokenAddress")]

def _src_pumpportal(cfg):
    if not cfg.get("use_pumpportal", True): return []
    if _bridge_base_url():
        resp = bridge_get("/api/sniper/pumpportal-mints", timeout=4)
        if isinstance(resp, dict) and resp.get("ok") and isinstance(resp.get("mints"), list):
            return [m for m in resp["mints"] if isinstance(m, str) and m]
    data = get_json(f"{PUMPP}/coins/new")
    if not isinstance(data, list): return []
    return [c.get("mint") for c in data if isinstance(c, dict) and c.get("mint")]

SOURCES = [
    ("pumpportal", 2.0, _src_pumpportal),
    ("gecko", 10.0, _src_gecko),
    ("jup", 6.0, _src_jup),
    ("profiles", 4.0, _src_profiles),
    ("boosts", 10.0, _src_boosts),
]

def fetch_candidate_mints(cfg, force=False):
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
    ths = [threading.Thread(target=run, args=s, daemon=True) for s in SOURCES]
    for t in ths: t.start()
    for t in ths: t.join(timeout=5)
    # Prioritize real-time launch streams (pumpportal, gecko) ahead of older profile/jupiter lists
    ordered_mints = []
    seen_batch = set()
    for src_name in ("pumpportal", "gecko", "profiles", "jup", "boosts"):
        for m in by_src.get(src_name, []):
            if m not in seen_batch:
                seen_batch.add(m)
                ordered_mints.append(m)
    fresh = _fresh_only(ordered_mints)
    _mark_seen(ordered_mints)
    return fresh

# ---------------------------------------------------------------- entry filters
def passes_filters(pair, cfg, now_ms=None):
    """Returns (ok, short_reason_code, detail)."""
    now_ms = now_ms or int(time.time() * 1000)
    created = int(pair.get("pairCreatedAt") or 0)
    if created <= 0: return False, "missing data", "no pairCreatedAt"
    age_s = (now_ms - created) / 1000.0
    if age_s > cfg.get("max_age_minutes", 2) * 60: return False, "too old", f"{age_s / 60:.1f}m > window"
    if age_s < -10: return False, "clock skew", "sync your PC clock"
    if _f(pair.get("priceUsd")) is None: return False, "no price", "no price on DexScreener yet"

    m5 = (pair.get("txns") or {}).get("m5") or {}
    buys, sells = int(m5.get("buys") or 0), int(m5.get("sells") or 0)
    ratio = cfg.get("min_buy_sell_ratio_m5", 1.0)
    if ratio > 0 and buys < sells * ratio:
        return False, "selling pressure", f"{buys}b/{sells}s in last 5m"
    m5c = _f((pair.get("priceChange") or {}).get("m5"))
    if m5c is not None and m5c > cfg.get("max_price_change_m5_pct", 300):
        return False, "already pumped", f"+{m5c:.0f}% in 5m"

    if age_s > cfg.get("ultra_early_grace_sec", 10):
        liq = _f((pair.get("liquidity") or {}).get("usd")) or 0.0
        if liq < cfg.get("min_liquidity_usd", 300):
            return False, "low liquidity", f"${liq:.0f} < ${cfg.get('min_liquidity_usd', 0):.0f}"
        if buys < cfg.get("min_buys_m5", 2):
            return False, "few buys", f"{buys} buys in last 5m"
        if cfg.get("min_volume_m5_usd", 0) > 0:
            mv5 = _f((pair.get("volume") or {}).get("m5")) or 0.0
            if mv5 < cfg["min_volume_m5_usd"]: return False, "low m5 volume", f"${mv5:.0f}"
        if cfg.get("min_holders", 0) > 0:
            h1b = int(((pair.get("txns") or {}).get("h1") or {}).get("buys") or 0)
            if h1b < cfg["min_holders"]: return False, "too few h1 buys", f"{h1b}"
    return True, "ok", ""

# ---------------------------------------------------------------- hard rug screen
_rug_cache, _rug_lock = {}, threading.Lock()

def _rpc_mint_authorities(mint):
    """Direct on-chain check of the SPL mint account. Returns (rpc_ok, mint_auth, freeze_auth)."""
    body = {"jsonrpc": "2.0", "id": 1, "method": "getAccountInfo", "params": [mint, {"encoding": "jsonParsed"}]}
    for url in RPC_URLS:
        try:
            r = _session.post(url, json=body, timeout=6, headers={**HEADERS, "Content-Type": "application/json"})
            if r.status_code != 200: continue
            value = ((r.json().get("result") or {}).get("value") or {})
            parsed = ((value.get("data") or {}).get("parsed") or {})
            if parsed.get("type") == "mint":
                inf = parsed.get("info") or {}
                return True, inf.get("mintAuthority"), inf.get("freezeAuthority")
        except Exception:
            continue
    return False, None, None

def hard_rug_check(mint, cfg, age_s):
    """Return (ok, reason). On-chain authority check + Jupiter audit + RugCheck. Cached."""
    ttl = max(60, cfg.get("rug_recheck_minutes", 15) * 60)
    with _rug_lock:
        hit = _rug_cache.get(mint)
        if hit and time.time() - hit[0] < ttl: return hit[1]

    verdict = (True, "ok")
    rpc_ok, ma, fa = _rpc_mint_authorities(mint)
    if rpc_ok:
        if ma: verdict = (False, "mint authority NOT revoked (on-chain: dev can mint supply)")
        elif fa: verdict = (False, "freeze authority enabled (on-chain: dev can freeze sells)")
    else:
        hdrs = {"x-api-key": cfg["jupiter_api_key"]} if cfg.get("jupiter_api_key") else None
        jt = get_json(f"{JUP}/search", params={"query": mint}, headers=hdrs)
        if isinstance(jt, dict): jt = jt.get("tokens") or jt.get("data") or []
        if isinstance(jt, list) and jt:
            tok = next((t for t in jt if isinstance(t, dict) and t.get("id") == mint), None)
            if tok is None and isinstance(jt[0], dict): tok = jt[0]
            if isinstance(tok, dict):
                if tok.get("mintAuthority"): verdict = (False, "mint authority NOT revoked")
                elif tok.get("freezeAuthority"): verdict = (False, "freeze authority enabled")

    young = age_s < 180   # seconds-old pools always look 'low liquidity' to RugCheck
    if verdict[0] and cfg.get("use_rugcheck", True):
        rep = get_json(f"{RUGC}/{mint}/report/summary", timeout=8)
        risks = rep.get("risks") if isinstance(rep, dict) else None
        if isinstance(risks, list):
            if not young:
                sn = _f(rep.get("score_normalised"))
                if sn is not None:
                    if sn > 100: sn /= 1000.0
                    if sn >= cfg.get("rugcheck_max_score", 50):
                        verdict = (False, f"rugcheck risk score {sn:.0f}/100")
            if verdict[0]:
                strict = cfg.get("strict_rugcheck", True)
                for risk in risks:
                    level = str(risk.get("level") or "").lower()
                    name = str(risk.get("name") or ""); low = name.lower()
                    if level != "danger":
                        if "holder" in low and not young:
                            m = re.search(r"([\d.]+)\s*%", str(risk.get("description") or "") + " " + name)
                            if m and float(m.group(1)) > cfg.get("max_top10_holder_pct", 75):
                                verdict = (False, f"{name} ({m.group(1)}%)")
                                break
                        continue
                    if young and (("liquidity" in low) or ("lp" in low)):
                        continue
                    if not strict and not (("mint" in low) or ("freeze" in low) or ("authorit" in low) or ("holder" in low)):
                        continue
                    verdict = (False, f"rugcheck danger: {name or 'unknown risk'}")
                    break
        elif not young:
            verdict = (False, "no rugcheck report (coin not brand new)")

    with _rug_lock:
        if len(_rug_cache) > 5000: _rug_cache.clear()
        _rug_cache[mint] = (time.time(), verdict)
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
        else:
            self.path = os.path.join(base, cfg.get("state_file") or "state.json")
            self.csv_path = os.path.join(base, cfg.get("trades_csv") or "trades.csv")
            self.pnl_csv_path = os.path.join(base, "pnl_history.csv")
            self.sell_queue_path = os.path.join(base, "sell_queue.json")

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
    def save(self):
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
        max_pos = max(1, int(self.cfg.get("max_open_positions", 3)))
        return len(self.state["positions"]) >= max_pos, len(self.state["positions"]), max_pos

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
        max_pos = max(1, int(c.get("max_open_positions", 3)))
        if len(self.state["positions"]) >= max_pos: return False, "max positions"
        if self.state["day_pnl"] <= -c["daily_loss_limit_usd"]: return False, "daily loss limit"
        if self.mode == "live":
            sol_px = self.state.get("sol_price_usd") or 0.0
            bal_sol = self.state.get("wallet_sol")
            if bal_sol is not None:
                avail_usd = float(bal_sol) * float(sol_px or 0.0)
                if float(bal_sol) <= 0.001 or (sol_px > 0 and avail_usd < c["trade_size_usd"]):
                    return False, f"no SOL/USD in wallet ({float(bal_sol):.4f} SOL / ${avail_usd:.2f})"
        else:
            if self.state["cash"] < c["trade_size_usd"]:
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

    @locked
    def buy(self, mint, symbol, price, url=None, meta=None):
        if _should_stop():
            return False
        meta = meta or {}
        c = self.cfg
        url = url or f"https://dexscreener.com/solana/{mint}"
        ok, why = self.can_open()
        if not ok or mint in self.state["positions"]:
            return False
        size = c["trade_size_usd"]
        sol_px = self.state.get("sol_price_usd")
        tx_buy = ""
        cost_sol = (size / sol_px) if sol_px and sol_px > 0 else 0.0
        extra_pos = {}

        if self.mode == "live":
            log(f"⚡ LIVE BUY REQUEST {symbol} (${size:.2f}) via Jupiter...")
            res = bridge_post("/api/sniper/live-buy", {
                "mint": mint,
                "symbol": symbol,
                "tradeSizeUsd": size,
                "slippagePct": c.get("slippage_pct", 2.0),
                "solPriceUsd": sol_px,
                "dex": meta.get("dex", "?"),
                "source": meta.get("source", "?"),
                "age_s": meta.get("age_s", 0),
                "url": url,
            }, timeout=55)
            if _should_stop():
                if not isinstance(res, dict) or not res.get("ok"):
                    return False
            if not isinstance(res, dict) or not res.get("ok"):
                err = (res or {}).get("error") or "Live swap failed"
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
            extra_pos = {
                "raw_amount": str(res.get("rawAmount") or ""),
                "decimals": int(res.get("decimals") if res.get("decimals") is not None else 6),
                "cost_sol": cost_sol,
                "fee_sol": float(res.get("feeSol") or 0.0),
                "rent_sol": float(res.get("rentSol") or 0.0),
                "tx_buy": tx_buy,
                "last_sell_attempt": 0.0,
            }
        else:
            fill = price * (1 + c["slippage_pct"] / 100)
            qty = (size * (1 - c["fee_pct"] / 100)) / fill
            self.state["cash"] -= size

        self.state["positions"][mint] = {
            "symbol": symbol,
            "qty": qty,
            "entry_price": fill,
            "current_price": fill,
            "cost": size,
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
            "dex": meta.get("dex", "?"),
            "source": meta.get("source", "?"),
            "age_at_entry": round(meta.get("age_s", 0), 1),
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
        log(f"✓ {mode_tag} {symbol} [{meta.get('dex', '?')}/{meta.get('source', '?')}] age {meta.get('age_s', 0):.0f}s @ ${fmt_price(fill)}{sol_hint}{tx_hint}")
        full, cnt, max_pos = self.is_slots_full()
        if full and not self.state.get("scan_paused"):
            self.state["scan_paused"] = True
            log(f"⏸ Slots full ({cnt}/{max_pos}) — stopped scanning for new coins until a slot frees up.")
        self.save()
        return True

    @locked
    def sell(self, mint, price, reason):
        if _should_stop():
            return False
        c = self.cfg
        pos = self.state["positions"].get(mint)
        if not pos:
            return False

        sol_px = self.state.get("sol_price_usd")
        tx_sell = ""

        if self.mode == "live":
            log(f"⚡ LIVE SELL {pos['symbol']} [{reason}] via Jupiter...")
            res = bridge_post("/api/sniper/live-sell", {
                "mint": mint,
                "symbol": pos["symbol"],
                "qty": pos.get("qty", 0),
                "rawAmount": pos.get("raw_amount"),
                "decimals": pos.get("decimals"),
                "costUsd": pos.get("cost", 0),
                "costSol": pos.get("cost_sol"),
                "slippagePct": c.get("slippage_pct", 2.0),
                "solPriceUsd": sol_px,
                "reason": reason,
            }, timeout=55)
            if not isinstance(res, dict) or not res.get("ok"):
                err = (res or {}).get("error") or "No live sell route available"
                pos["last_sell_attempt"] = time.time()
                self.save()
                log(f"✗ LIVE SELL FAILED {pos['symbol']} [{reason}]: {err} (keeping position open)")
                return False

            self.state["positions"].pop(mint, None)
            fill = float(res.get("exitPriceUsd") or price)
            proceeds = float(res.get("proceedsUsd") or 0.0)
            pnl = float(res.get("pnlUsd") or (proceeds - pos["cost"]))
            pnl_pct = float(res.get("pnlPct") or (pnl / pos["cost"] * 100 if pos["cost"] else 0.0))
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
        else:
            self.state["positions"].pop(mint, None)
            fill = price * (1 - c["slippage_pct"] / 100)
            proceeds = pos["qty"] * fill * (1 - c["fee_pct"] / 100)
            pnl = proceeds - pos["cost"]
            pnl_pct = pnl / pos["cost"] * 100
            self.state["cash"] += proceeds

        self._roll_day()
        self.state["day_pnl"] += pnl
        self.state["total_pnl"] += pnl
        self.state["closed"] += 1
        if pnl > 0: self.state["wins"] += 1
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
        self.state["last_sell_time"] = now_ts
        rescan_delay = max(0, int(self.cfg.get("rescan_delay_after_sell_sec", 0)))
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
            round(pos["cost"], 4),
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
        mode_tag = "LIVE SELL" if self.mode == "live" else "SELL"
        tx_hint = f" tx={tx_sell[:8]}..." if tx_sell else ""
        log(f"✗ {mode_tag} {pos['symbol']} entry ${fmt_price(pos['entry_price'])} -> exit ${fmt_price(fill)} pnl ${pnl:.2f}{sol_hint} ({pnl_pct:.1f}%) [{reason}]{tx_hint}")
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
    def trailing_stop_arm_pct(tp, trail):
        """Minimum peak gain (%) needed before trailing stop becomes active.

        - When both take_profit_pct (tp > 0) and trailing_stop_pct (trail > 0) are set,
          take_profit_pct acts as the arm threshold: wait until peak >= +tp% before
          activating trailing stop so runners are not sold early at +tp% or in a loss.
        - When take_profit_pct == 0 and trailing_stop_pct > 0, wait until peak reaches at
          least trail + 5% so the trailing floor (peak - trail) is already +5%+ in profit.
        """
        tp = float(tp or 0.0)
        trail = float(trail or 0.0)
        if trail <= 0.0:
            return 0.0
        if tp > 0.0:
            return tp
        return max(10.0, trail + 5.0)

    @classmethod
    def evaluate_exit_signal(cls, entry, price, peak_price, tp, trail, held_minutes, max_hold_minutes):
        """Return (reason_or_none, trailing_active, drop_from_peak_pnl_pct)."""
        if not entry or entry <= 0 or not price or price <= 0:
            return None, False, 0.0
        tp = float(tp or 0.0)
        trail = float(trail or 0.0)
        peak = max(float(entry), float(peak_price or entry), float(price))
        change_pct = (price / entry - 1.0) * 100.0
        peak_chg_pct = (peak / entry - 1.0) * 100.0
        # Pullback from peak gain in percentage points (matches Spot Bot trailing floor: peak_pnl - trail)
        drop_from_peak_pct = max(0.0, peak_chg_pct - change_pct)

        if trail > 0.0:
            arm_pct = cls.trailing_stop_arm_pct(tp, trail)
            trailing_active = peak_chg_pct >= arm_pct
            # Trailing stop can only sell while the position is actually in profit above entry
            if trailing_active and change_pct > 0.0 and drop_from_peak_pct >= trail:
                return f"trailing_stop_{trail:g}", True, drop_from_peak_pct
        else:
            trailing_active = False
            if tp > 0.0 and change_pct >= tp:
                return f"take_profit_{tp:g}", False, drop_from_peak_pct

        max_hold = float(max_hold_minutes or 0.0)
        if max_hold > 0.0 and held_minutes >= max_hold:
            return "max_hold", trailing_active, drop_from_peak_pct

        return None, trailing_active, drop_from_peak_pct

    @locked
    def check_exits(self, prices):
        if _should_stop():
            return 0
        exits = 0
        tp = float(self.cfg.get("take_profit_pct", 50) or 0.0)
        trail = float(self.cfg.get("trailing_stop_pct", 0) or 0.0)
        max_hold = float(self.cfg.get("max_hold_minutes", 120) or 0.0)
        now_ts = time.time()
        self.state["last_price_time"] = now_ts
        for mint, pos in list(self.state["positions"].items()):
            if _should_stop():
                break
            price = prices.get(mint)
            if price is None or price <= 0:
                continue
            entry = pos["entry_price"]
            pos["current_price"] = price
            pos["last_updated"] = now_ts
            pos["peak_price"] = max(pos.get("peak_price", entry), price)
            pos["low_price"] = min(pos.get("low_price", entry), price)
            change = (price / entry - 1) * 100
            pos["pnl_pct"] = round(change, 2)
            fill = price * (1 - self.cfg.get("slippage_pct", 2.0) / 100)
            proceeds = pos["qty"] * fill * (1 - self.cfg.get("fee_pct", 1.0) / 100)
            pos["pnl_usd"] = round(proceeds - pos["cost"], 4)
            pos["peak_pct"] = round((pos["peak_price"] / entry - 1) * 100, 2)
            pos["low_pct"] = round((pos["low_price"] / entry - 1) * 100, 2)

            held_min = max(0.0, (now_ts - pos["opened"]) / 60.0)
            reason, trailing_active, _drop_pct = self.evaluate_exit_signal(
                entry, price, pos["peak_price"], tp, trail, held_min, max_hold
            )
            was_active = bool(pos.get("trailing_active"))
            pos["trailing_active"] = trailing_active
            pos["trailing_floor_pct"] = round(max(0.01, pos["peak_pct"] - trail), 2) if (trailing_active and trail > 0) else None
            if trailing_active and not was_active:
                log(f"🎯 Trailing stop ARMED for {pos['symbol']}: peak +{pos['peak_pct']:.1f}% | exit floor +{pos['trailing_floor_pct']:.1f}% (-{trail:g}% from peak PnL)")

            if reason:
                if _should_stop():
                    break
                # Bypass 5s lockout for take_profit so TP executes instantly every 1s tick until filled
                if not str(reason).startswith("take_profit") and self.mode == "live":
                    cooldown = 2.0 if str(reason).startswith("trailing_stop") else 5.0
                    if now_ts - float(pos.get("last_sell_attempt") or 0.0) < cooldown:
                        continue
                if self.sell(mint, price, reason):
                    exits += 1
        if exits == 0:
            self.save()
        return exits

# Keep backwards compatibility alias
PaperAccount = TradingAccount

# ---------------------------------------------------------------- scan / monitor
_stats_lock = threading.Lock()
_stats = {"since": time.time(), "cands": 0, "no_pair": 0, "checked": 0, "rejects": {}, "rug": 0, "bought": 0}
_last_block_log = [0.0]
_last_rescan_delay_log = [0.0]

def _maybe_summary():
    with _stats_lock:
        if time.time() - _stats["since"] < 60: return
        cands, no_pair, checked = _stats["cands"], _stats["no_pair"], _stats["checked"]
        rejects, rug, bought = dict(_stats["rejects"]), _stats["rug"], _stats["bought"]
        src_bits = [f"{n}={v.get('items', 0)}{'*' if time.time() - v.get('ok_at', 0) > 120 else ''}"
                    for n, v in sorted(_src_stats.items())]
        _stats.update({"since": time.time(), "cands": 0, "no_pair": 0, "checked": 0, "rejects": {}, "rug": 0, "bought": 0})
    rej_txt = " ".join(f"{k}:{v}" for k, v in sorted(rejects.items(), key=lambda kv: -kv[1]))
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
    rescan_delay = max(0, int(cfg.get("rescan_delay_after_sell_sec", 0)))
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
        if mint not in pairs and mint in _gecko_pairs:
            gp = _gecko_pairs[mint]
            liq = _f((gp.get("liquidity") or {}).get("usd")) or 0.0
            pairs[mint] = (liq, gp)
    with _stats_lock: _stats["no_pair"] += max(0, len(fresh) - len(pairs))

    for mint, (_liq, pair) in pairs.items():
        if _should_stop():
            return
        if acct.is_slots_full()[0]:
            break
        if not acct.can_open()[0]: break
        if mint in acct.state["positions"] or mint in acct.state["blacklist"]: continue
        symbol = (pair.get("baseToken") or {}).get("symbol") or "?"
        okp, code, detail = passes_filters(pair, cfg, now_ms)
        with _stats_lock: _stats["checked"] += 1
        if not okp:
            if code == "too old":
                with _seen_lock:
                    _too_old_mints[mint] = time.time()
            with _stats_lock: _stats["rejects"][code] = _stats["rejects"].get(code, 0) + 1
            if cfg.get("log_rejects"): log(f"– {symbol} filtered: {code} ({detail})")
            continue
        if _should_stop():
            return
        age_s = max(0.0, (now_ms - int(pair.get("pairCreatedAt") or 0)) / 1000.0)
        rok, rwhy = hard_rug_check(mint, cfg, age_s)
        if not rok:
            with _stats_lock: _stats["rug"] += 1
            log(f"✗ RUG REJECT {symbol}: {rwhy}")
            acct.note_rejected(mint)
            continue
        if _should_stop():
            return
        price = _f(pair.get("priceUsd"))
        if price is None: continue
        meta = {"dex": pair.get("dexId") or "?", "source": _src_of.get(mint, "?"), "age_s": age_s}
        if acct.buy(mint, symbol, price, pair.get("url"), meta):
            with _stats_lock: _stats["bought"] += 1
            if acct.is_slots_full()[0]:
                break

def _jupiter_prices(mints, cfg):
    if not cfg.get("use_jupiter_price", True) or not mints:
        return {}
    has_key = bool(cfg.get("jupiter_api_key"))
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
                if not pos:
                    continue
                px = prices.get(mint) or pos.get("current_price") or pos.get("entry_price")
                if px:
                    acct.sell(mint, px, "manual_exit")
    except Exception:
        pass

def monitor(acct):
    if _should_stop():
        return {}
    maybe_reload_settings()
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

    pos = acct.state["positions"]
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
    prices = _jupiter_prices(mints, acct.cfg)
    missing = [mint for mint in mints if mint not in prices]
    for i in range(0, len(missing), 30):
        if _should_stop():
            return prices
        chunk = missing[i:i + 30]
        data = get_json(f"{DEX}/tokens/v1/solana/{','.join(chunk)}", timeout=4)
        if isinstance(data, list):
            best_by_mint = {}
            for p in data:
                if not isinstance(p, dict): continue
                mint = (p.get("baseToken") or {}).get("address")
                if mint in pos and mint not in prices:
                    price = _f(p.get("priceUsd"))
                    liq = _f((p.get("liquidity") or {}).get("usd")) or 0.0
                    if price is not None and price > 0:
                        cur = best_by_mint.get(mint)
                        if cur is None or liq > cur[0]:
                            best_by_mint[mint] = (liq, price)
            for mint, (_liq, price) in best_by_mint.items():
                prices[mint] = price

    if _should_stop():
        return prices
    _process_sell_queue(acct, prices)
    acct.check_exits(prices)
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
            ok, code, detail = passes_filters(p, cfg, now_ms)
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
            log(f"Wallet balance: {float(bal_sol):.4f} SOL (${float(bal_usd):.2f}) | trade size ${CONFIG['trade_size_usd']:.2f}")
    log(f"Sources: gecko={CONFIG['use_gecko']} jupiter={CONFIG['use_jupiter_recent']} profiles={CONFIG['use_dex_profiles']} pumpportal={CONFIG['use_pumpportal']} boosts={CONFIG['use_promoted_feeds']}{sol_banner}")
    tp_cfg = float(CONFIG.get("take_profit_pct", 50) or 0.0)
    tr_cfg = float(CONFIG.get("trailing_stop_pct", 0) or 0.0)
    if tp_cfg > 0 and tr_cfg > 0:
        exit_banner = f"TP +{tp_cfg:g}% arms {tr_cfg:g}% trail (profit-only)"
    elif tp_cfg > 0:
        exit_banner = f"TP +{tp_cfg:g}%"
    elif tr_cfg > 0:
        exit_banner = f"Profit-only Trail {tr_cfg:g}% (arms +{TradingAccount.trailing_stop_arm_pct(0, tr_cfg):.0f}%)"
    else:
        exit_banner = "TP/Trail OFF"
    log(f"Window: coins < {CONFIG['max_age_minutes'] * 60:.0f}s old (grace <{CONFIG['ultra_early_grace_sec']}s skips liquidity/buy floors) | {exit_banner} | liq>=${CONFIG['min_liquidity_usd']:.0f} after grace | buys>=sells(5m) | pump cap +{CONFIG['max_price_change_m5_pct']:.0f}% | rug check {'ON' if CONFIG['use_rugcheck'] else 'OFF'}")
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
            wait_sec = max(0.1, float(CONFIG.get("scan_interval_sec", 1)) - (time.time() - started))
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
            wait_sec = max(0.1, float(CONFIG.get("monitor_interval_sec", 1.0)) - (time.time() - started))
            _interruptible_wait(wait_sec)
    finally:
        _stop_event.set()
        _scan_wake.set()
        _cleanup_pid_file()
        log("Python sniper loop exited cleanly.")

if __name__ == "__main__":
    if "--probe" in sys.argv: probe(CONFIG)
    else: run(once="--once" in sys.argv)