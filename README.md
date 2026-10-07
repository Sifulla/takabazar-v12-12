# TakaBazar Credits Platform V2

A ready-to-run credits-based gaming platform for testing and development. Credits have no cash value and no real-money payment gateway is connected.

## Included
- Register / Login / Logout
- Central wallet with Available + Held credits
- Deposit-credit request flow: Pending -> Admin Approve/Reject
- Withdrawal-credit request flow with hold balance and daily limits
- Transaction ledger and request history
- Notifications
- Coin Flip, Dice Six, Lucky Wheel
- Server-side game settlement
- Hidden admin panel (tap TakaBazar logo 5 times)
- Admin dashboard, users, wallet requests, limits, bets, support, audit
- Game Manager: Add, Test, Publish/Unpublish, Maintenance, Delete, Stats
- Safe ZIP game-package installer using allow-listed engines
- Game version history + rollback
- SQLite auto-migration from the earlier project
- Rate limiting and security headers

## Run in Termux
```bash
cd ~/storage/downloads/takabazar-credits-platform-v2
npm install
npm start
```
Open: http://localhost:3000

Default admin PIN: `64686123`
Change `ADMIN_PIN` before any public deployment.

## Update from the earlier Termux project while keeping the database
Stop the old server first (Ctrl+C), then extract this V2 ZIP. If you already have user data, copy your old database into this folder before starting:
```bash
mkdir -p data
cp ../takabazar-demo-casino/data/takabazar.sqlite data/takabazar.sqlite 2>/dev/null || true
npm install
npm start
```
The app upgrades compatible database columns/tables automatically. Keep a backup before updating.

## Game package format
A game ZIP needs `game.json` at the root. Packages cannot contain executable files. Supported engines are `coin`, `dice`, and `wheel`.

Example:
```json
{
  "slug": "neon-wheel",
  "name": "Neon Wheel",
  "version": "1.0.0",
  "category": "arcade",
  "engine": "wheel",
  "icon": "🎡",
  "minBet": 10,
  "maxBet": 500,
  "config": {
    "choices": [
      {"key":"red","label":"Red","weight":5,"payout":2},
      {"key":"blue","label":"Blue","weight":5,"payout":2},
      {"key":"gold","label":"Gold","weight":2,"payout":4}
    ]
  }
}
```

## Important
This package implements practice-credit requests only. Real-money deposits, withdrawals, bank/mobile-money transfers, card processing, and payout automation are not included.
