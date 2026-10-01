forge catalog snapshot — 2026-09-04 18:00 MSK
================================================

Staging output of the forge pipeline (3mf.tech catalog). Nothing here has
been promoted to the dataset; everything is a candidate with provenance.

Contents
--------
machines/<vendor>/<model>.json   296 printer cards: specs, field_provenance
                                  (source, url, confidence, confirmed_by), evidence quotes,
                                  sources with tiers, conflicts for human review.
                                  Cards with confirmed_by = independently confirmed by a shop.
materials.json                    899 live filament lines (brand sites + RU shops).
                                  shop / ru_market / discontinued fields mark market data.
materials.ofd/                    2058 lines imported from Open Filament Database (MIT).
news.json                         1881 news items (outlets from 2023, vendor feeds from 2019).
prices.json                       88 RU retail prices.
reviews.json                      413 user reviews (3DToday): claims with verbatim quotes,
                                  author, date, printer, settings. Tier: community.
summaries.json                    35 AI SUMMARIES per brand x material family, built ONLY
                                  from the quoted reviews; every pro/con cites quote numbers;
                                  sentences verified by a second model. Field summary_ai. AI TEXT.
descriptions.json                 711 AI DESCRIPTIONS (description_ai) for printers and
                                  filament lines, generated only from verified facts, each
                                  sentence verified. AI TEXT — label as such in the catalog.
history/                          39 historical machines from RepRap wiki (GFDL 1.2) and
                                  Wikipedia (CC BY-SA 4.0). Tier: community; license and url in
                                  each record. Attribution required.
brands.json                       Market census: 30 filament brands on RU shelves,
                                  flagged russian.
REVIEW.md                         Human review digest: vendor outvoted, shop/vendor disputes with
                                  quotes, internal consistency, unconfirmed fields.
ranking.md                        Measured source reliability.

Licenses of structural sources: Open Filament Database (MIT), SpoolmanDB (MIT),
RepRap wiki (GFDL 1.2), Wikipedia (CC BY-SA 4.0). Vendor/shop pages: facts
extracted with short quotes; no page copies included.

Known weak spots (see software/forge/gotchas.md §25–30): free-text vendor
fields (target_use, limitations) may come from neighbouring page blocks;
RepRap-wiki translations; news 'new machine' vs application case.

Changelog since Thu 2026-09-03 15:40 (start of the 30-hour run)
------------------------------------------------------------
Thu 15:40 -> 22:47   source ranking measured; second opinions from 5 independent sources
                     (4 RU shops + 3DToday community): 2283 confirmations on 179 cards;
                     repass of all vendor cards under current guards (169/172);
                     news 67 -> 291; KREMEN filament adapter; OFD import 2058 lines.
Thu 21:00            all 4 GPUs put to work (second verifier on 3090 #2, spark extractor,
                     7 parallel chains); Fri 00:35 -> everything via the park broker (roles).
Fri 01:30 -> 15:00   scope expansion by operator: news outlets back to 2023 (291 -> 1758),
                     filament census from RU shops (491 lines, 24 brands, 10 Russian),
                     user reviews from 3DToday (413, 1732 quoted claims), AI summaries per
                     brand x family (30), AI descriptions for printers (356) and filament
                     lines (283), Wayback archive for discontinued models (14 cards kept
                     after strict filters), history from RepRap wiki / Wikipedia (39 cards).
Fri 05:40            checkpoint: 15 adversarial agents checked 1479 fields (12% problems);
                     all fixable classes turned into deterministic rules and applied
                     retroactively (refilter v3-v5: 775 records, 381 fields dropped,
                     67 wrong-object records removed).
Fri 10:40            recheck on fresh records: archive 45% -> 20%, descriptions 30% -> 14%,
                     reviews 20% -> 15%; summaries and history tightened further.
Fri 15:00 -> 17:33   verification mode (no collection): consistency checks (80 notes),
                     second helper q38 over 314 records: 3840 fields double-verified,
                     14 dropped, 58 left unconfirmed (flagged); summaries recomputed.
Final preview: 296 printer cards, 7009 fields, 1299 independently confirmed,
1471 with confidence >= 0.95, validator 0 problems.
Broker: 18063 requests since Fri 00:33, 3 errors (early 400s before the owner fix).
