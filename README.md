# SafeShare

Neighbours lend and borrow emergency equipment (generators, water pumps, first-aid kits,
oxygen cylinders, boats, tents) during floods, accidents and festivals, with a record
of every step that cannot be quietly changed.

* Register / sign in with a name and password (hashed with scrypt, 5 wrong tries lock the name for 5 minutes,
  server-checked session per browser tab)
* Verified members only (admin verifies, gives 100 starting credits)
* List an item with photo, condition 1-5 and deposit; details + photo are fingerprinted (SHA-256)
  into the ledger, and any later edit shows a red **TAMPERED** badge
* Borrow flow: request, approve, handover, return. Credits act as the deposit
  (late = 20% kept, each lost condition point = 25% kept)
* QR handover/return: borrower shows a signed code (10 minutes, one person, one item);
  the owner scans it on **another device** and confirms the condition
* Trust score 0-100, urgent requests to every member, disputes settled by the admin,
  emergency pause, blacklist, security log
* Works on several devices at once (2 s polling, "Connected devices" list)

## Run locally (two devices)
    cd web
    npm install
    npm run dev          # http://localhost:3000

Open it on the PC, then on a phone on the same Wi-Fi open `http://<PC address>:3000`
(the QR code uses the PC's Wi-Fi address automatically when you are on localhost).
Follow the steps in the app's **Help** tab. Open **Create an account** (or `/register`) on each device.
The name `admin` is the administrator (set `ADMIN_NAME` to change it), so **register it first**.
On a public deployment set `ADMIN_PASSWORD`: only that password can create the admin account.

Phones scan the QR with the normal camera app (it opens the link). The in-app camera
scanner only works on https or localhost; "photo of the QR" and "paste link" always work.

## Contract (Remix)
`contracts/contracts/SafeShare.sol` has the same rules in Solidity. In Remix: compile with
0.8.20+, deploy on **Remix VM**, then play the story by hand: `verify`, `listItem`,
`requestBorrow`, `approve`, `handover`, `returnItem`, then read `credits(address)`,
`stats(address)` and `trustScore(address)`. Bad cases revert with "Not verified" and so on.

## Deploy (Render, free)
Push to GitHub, Render > New > Blueprint (uses `render.yaml`). Free-tier storage is
ephemeral: data resets on redeploy or sleep.

## Honest limits
* The web app's ledger is a server-side hash chain; it is **not connected** to the Solidity
  contract. It shows the same integrity idea, the contract shows the same rules on a chain.
* Accounts are name + password with no email or password reset. If someone forgets theirs, delete
  `web/data/db.json` (this also clears all demo data). Accounts made before passwords existed can't sign in.
* Sessions are kept per browser tab on purpose, so one PC can play several people. The login lockout
  lives in memory. Production would use real wallets and a proper session store.
