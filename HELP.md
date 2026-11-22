# Solana Spot Bot & Python Sniper — Master Help & User Guide (Extremely Easy English & Urdu)
# سولانا اسپاٹ بوٹ اور پائথন اسنائپر — ماسٹر یوزر گائیڈ (انتہائی آسان انگریزی اور اردو)

Welcome to the **Solana Spot Bot** master guide! This guide explains every single tab, feature, button, and setting in the entire application using very simple English and Urdu.
**سولانا اسپاٹ بوٹ** کے اس مکمل گائیڈ میں آپ کا استقبال ہے! یہاں بوٹ کے تمام ٹیمز، فیچرز اور سیٹنگز کو انتہائی آسان انگریزی اور اردو میں سمجھایا گیا ہے۔

---

## Part 1: Main App Tabs (بنیادی ٹیبز اور اسکرینز)

### 1. Dashboard (ڈیش بورڈ / مین اسکرین)
- **English**: Your home screen. Shows your Wallet Balance, Total Portfolio Value, Open Profit/Loss, Win Rate, Equity Chart, and Exposure Limits at a glance.
- **Urdu**: آپ کی ہوم اسکرین۔ یہاں آپ کا والٹ بیلنس، کل پورٹ فولیو کی مالیت، منافع/نقصان، اور رسک کی حدیں ایک نظر میں نظر آتی ہیں۔

### 2. Positions (پوزیشنز / کھلے سودے)
- **English**: Shows all coins you currently own. You can click **Sell Now** to exit a coin immediately at market price, or **Force Delete** if a token is a dead rugpull.
- **Urdu**: یہاں آپ کے وہ کوئنز نظر آتے ہیں جو آپ نے خریدے ہوئے ہیں۔ آپ کسی بھی کوئن کو بیچنے کے لیے "Sell Now" دبا سکتے ہیں یا پھنسے ہوئے کوئن کو ہٹا سکتے ہیں۔

### 3. Scanner (اسکینر)
- **English**: Real-time scanner that searches new Solana token launches across DEXes and pools.
- **Urdu**: یہ اسکرین ریئل ٹائم میں نئے سولانا ٹوکنز اور پولز کو تلاش کرتی ہے۔

### 4. Shadow Compare (شیڈو کمپیئر / موازنہ)
- **English**: Compares your simulated paper trades against real live execution results to check for price slippage and execution delay ("Reality Gap").
- **Urdu**: یہ دیکھتا ہے کہ آپ کی نقلی ٹریڈنگ اور اصلی ٹریڈنگ میں قیمتوں کا کتنا فرق (Reality Gap) آ رہا ہے۔

### 5. History & Analytics (تاریخ اور تجارتی ریکارڈ)
- **English**: A complete ledger of all your past closed trades with entry price, exit price, PnL, Solscan transaction links, and a button to **Export CSV**.
- **Urdu**: آپ کے پچھلے تمام بند شدہ سودوں کا مکمل ریکارڈ۔ آپ یہاں سے اپنا ڈیٹا CSV فائل میں ڈاؤن لوڈ بھی کر سکتے ہیں۔

### 6. Settings (ترتیبات)
- **English**: General configuration for the trading terminal interface and server connection.
- **Urdu**: ٹریڈنگ ٹرمینل اور سرور کنکشن کی عام ترتیبات۔

### 7. Wallets & Signer (والٹس اور سائنر)
- **English**: Securely import or unlock your Solana private key using password encryption (AES-256-GCM). Your private key is kept safe and never shared.
- **Urdu**: اپنے سولانا پرائیویٹ کی کو پاس ورڈ کے ساتھ محفوظ طریقے سے ان لاک کریں۔ آپ کا کی مکمل طور پر محفوظ رہتا ہے۔

### 8. Event Logs (ایونٹ لاگز / سسٹمز لاگ)
- **English**: Live system activity log showing backend events, connection status, and trade activities.
- **Urdu**: سسٹم کی لائیو سرگرمیوں کا ریکارڈ جو بتاتا ہے کہ پس منظر میں کیا ہو رہا ہے۔

### 9. Pipeline Rules & Config (پائپ لائن کے اصول)
- **English**: Rules and safety checkpoints that every coin must pass before the bot is allowed to buy it.
- **Urdu**: وہ حفاظتی اصول جن پر پورا اترنے کے بعد ہی بوٹ کسی کوئن کو خریدتا ہے۔

### 10. Risk Centre (رسک سینٹر / خطرے کا انتظام)
- **English**: Protects your capital by enforcing Daily Loss Budgets, Max Wallet Exposure, and emergency stop limits.
- **Urdu**: یومیہ نقصان کی حد اور زیادہ سے زیادہ انویسٹمنٹ کو کنٹرول کرکے آپ کے سرمائے کی حفاظت کرتا ہے۔

### 11. Avg Win / Avg Loss (اوسط منافع / اوسط نقصان)
- **English**: Performance metrics showing your average profit per winning trade compared to your average loss.
- **Urdu**: یہ بتاتا ہے کہ آپ کے جیتنے والے سودوں میں اوسطاً کتنا منافع اور ہارنے والے سودوں میں کتنا نقصان ہوا۔

### 12. Python Sniper Bot (پائথন اسنائپر بوٹ)
- **English**: The main auto-sniper section for buying brand-new Solana meme coins and launches in seconds.
- **Urdu**: نئے سولانا میم کوئنز اور لانچز کو سیکنڈوں میں خودکار طریقے سے خریدنے کا مرکزی حصہ۔

---

## Part 2: Python Sniper Bot Settings Guide (پائথন اسنائپر بوٹ کی ترتیبات)

### 1. Core Position Settings (بنیادی ترتیبات)
- **Trade Size ($) / ٹریڈ سائز**: USD invested per coin buy (e.g., `$0.50` or `$5.00`). / فی کوئن خریداری کی رقم۔
- **Max Open Positions / زیادہ سے زیادہ کھلی پوزیشنیں**: Max coins held at the same time (e.g., `3`). / بیک وقت زیادہ سے زیادہ کوئنز۔
- **Daily Loss Limit ($) / یومیہ نقصان کی حد**: Stops buying for the day if total losses reach this USD amount. / اس حد تک نقصان پر دن کے لیے خریداری بند۔

### 2. Profit & Loss Exits (منافع اور نقصان سے نکلنے کے اصول)
- **Take Profit % / منافع کا ہدف (`take_profit_pct`)**: Sells at this profit % (or arms the trailing stop). / اتنے فیصد منافع پر فروخت۔
- **Trailing Stop % / ٹریلنگ اسٹاپ (`trailing_stop_pct`)**: Locks in profits by following the price upwards and selling if it drops by X% from peak. / عروج سے گرنے پر منافع محفوظ کرنا۔
- **Stop Loss % / اسٹاپ لاس (`stop_loss_pct`)**: Force-sells if PnL drops to `-X%` (`0` = disabled). / اتنے فیصد نقصان پر فوراً فروخت۔
- **Slippage % / سلپیج (`slippage_pct`)**: Max price tolerance for fast fills (e.g., `3%`). / قیمت کی برداشت کی حد۔
- **Real Jupiter Reverse Swap Quotes (`use_real_swap_quotes`)**: Prices exits using real live Jupiter token-to-SOL quotes. / اصلی ریورس سویپ کوٹس سے قیمت کی جانچ۔

### 3. Entry Momentum Filters (انٹری فلٹرز)
- **Max Coin Age / زیادہ سے زیادہ عمر (`max_age_minutes`)**: Only buys coins launched within X minutes (e.g., `2` min). / صرف اتنے منٹ پرانے کوئنز خریدنا۔
- **Min Liquidity ($) / کم از کم لیکویڈیٹی (`min_liquidity_usd`)**: Minimum pool liquidity required (e.g., `$5,000`). / کم از کم لیکویڈیٹی کی شرط۔
- **Min 5-Min Volume ($) / والیوم (`min_volume_m5_usd`)**: Minimum 5-minute trading volume. / کم از کم 5 منٹ کا والیوم۔
- **Min Buys Last 5 Min / خریدار (`min_buys_m5`)**: Minimum buy transactions in 5 min. / کم از کم خریداری کی تعداد۔
- **Min Buy/Sell Ratio / تناسب (`min_buy_sell_ratio_m5`)**: Buys must outnumber sells. / خرید و فروخت کا تناسب۔
- **Skip if Pumped +X% / پہلے سے پمپ شدہ (`max_price_change_m5_pct`)**: Skips coins already up too much. / بہت زیادہ اوپر جانے والے کوئنز کو چھوڑنا۔

### 4. Hard Anti-Rug Protections (اسکیم سے بچاؤ)
- **Hard RugCheck (`use_rugcheck`)**: Audits token mint and freeze authorities. / ٹوکن کا سکیورٹی آڈٹ۔
- **Strict RugCheck (`strict_rugcheck`)**: Rejects tokens with missing reports. / رپورٹ نہ ہونے پر کوئن مسترد کرنا۔
- **Block Insider Bundles (`block_insider_bundles`)**: Blocks bundled developer wallets. / ڈیولپر کے مشکوک والیٹس کو بلاک کرنا۔
- **Max Dev Holdings % (`max_dev_hold_pct`)**: Rejects if creator holds too much supply. / ڈیولپر کی زیادہ ہولڈنگ پر مسترد کرنا۔
- **Max RugCheck Score (`rugcheck_max_score`)**: Maximum allowed risk score (e.g., `55`). / زیادہ سے زیادہ رسک اسکور۔
- **Max Top-10 Holder % (`max_top10_holder_pct`)**: Caps top-10 wallets combined share. / ٹاپ 10 ہولڈرز کی حد۔

### 5. Speed & Anti-Rug Checkboxes (v1.35.0 Checkbox Suite) (اسپیڈ اور اینٹی رگ چیک باکسز)
1. **Fast Live Buy Pipeline (`fast_live_buy_enabled`)**: Speeds up live buys to ~1–3s. / لائیو خریداری کو 1-3 سیکنڈ میں تیز کرتا ہے۔
2. **Parallel Top-3 Rug Pre-Screening (`parallel_rug_screen_enabled`)**: Screens top 3 coins concurrently. / بیک وقت ٹاپ 3 کوئنز کی جانچ۔
3. **Jupiter 429 Quota Guard (`jupiter_quota_guard_enabled`)**: Pauses background quotes to prevent 429 errors. / ریٹ لمیٹ (429) سے بچنے کے لیے پس منظر کی کوئریز روکتا ہے۔
4. **Direct PumpPortal & Raydium Fallback (`direct_dex_fallback_enabled`)**: Uses backup swaps if Jupiter fails. / جیوپیٹر فیل ہونے پر بیک اپ سویپ استعمال کرتا ہے۔
5. **Tight Anti-Rug Score & Whale Cap (`anti_rug_tight_score_enabled`)**: Stricter safety limits (score <= 45). / سخت حفاظتی حدیں (اسکور <= 45)۔
6. **Real Pool Depth & MCap/LP Guard (`anti_rug_pool_depth_check_enabled`)**: Requires `$2,500` effective liquidity. / کم از کم $2,500 لیکویڈیٹی کی سخت شرط۔
7. **Always Simulate Exit Swap (`anti_rug_sell_sim_enabled`)**: Simulates sell route before every buy. / خریدنے سے پہلے فروخت کی نقلی جانچ۔
8. **Copycat Ticker Cooldown (`anti_rug_copycat_cooldown_enabled`)**: 10-minute cooldown on rejected coin tickers. / مسترد شدہ ٹوکن کے نام پر 10 منٹ کا کول ڈاؤن۔
9. **Require LP Burned/Locked >= 80% (`require_lp_locked`)**: Rejects unlocked AMM pool tokens. / غیر محفوظ ایل پی پولز کو مسترد کرنا۔
10. **Auto Emergency Sell on LP Drain (`auto_rug_exit`)**: Emergency sell if pool liquidity drops by 50%. / لیکویڈیٹی نکلنے پر ایمرجنسی فروخت۔

### 6. Target Websites / Launchpads Filter (ویب سائٹس فلٹر)
- **English**: Select specific checkboxes (Pump.fun, Axiom Trade, PumpSwap, Raydium, Meteora, etc.) to search only those launchpads.
- **Urdu**: مخصوص لانچ پیڈز (جیسے Pump.fun یا Axiom Trade) کو منتخب کریں تاکہ بوٹ صرف وہیں سے کوئنز تلاش کرے۔
