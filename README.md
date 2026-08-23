# AVA

A personal data organizer for a merchant navy officer. Installable on iPhone from
Safari, works with no connection at all, and keeps every record encrypted on the
device itself.

There is no backend. Nothing is uploaded, there is no account, and the app makes
no network requests once it has loaded.

## Sections

| Tab | Holds |
|---|---|
| **Ship Manuals** | Title, category, vessel, location, extracted procedures |
| **Certificates** | Issuer, reference no., issue and expiry dates — flagged amber within 90 days, red once expired |
| **Sea Time** | Full vessel particulars, sign-on/off, and up to 5 contracts per entry |
| **Sea Service Letters** | Same shape as certificates, without expiry tracking |
| **Salary Slips** | Month, vessel, amount, currency |
| **Important Notes** | Free text, pinnable to the top |

Every entry also takes encrypted file attachments and a cloud link.

## Calendar

Certificate expiries and voyages can be pushed into Apple Calendar as standard
`.ics` events — per entry from its detail view, or in bulk from Settings.

No web API can write into Apple Calendar directly, so AVA generates the calendar
file on-device and hands it to the iOS share sheet, where Calendar offers *Add
All Events*. A subscribed `webcal://` feed would auto-update instead, but it
would require your dates to live on a server, which is exactly what this app
avoids.

- **Certificate expiry** — an all-day event on the expiry date, with reminders at
  90 days, 30 days, and on the morning itself.
- **Voyage** — a multi-day event spanning sign-on to sign-off, with the sign-on
  port as the location and a reminder 14 days before sign-off. An entry still
  onboard becomes a single-day sign-on marker instead.

## Sea time arithmetic

Days are counted **inclusive of both the sign-on and the sign-off day**, the way
sea service is reckoned on a discharge book. An entry with no sign-off date is
treated as still onboard and counts up to today.

Totals are shown as `X mo Y d` using **30-day months**, the convention used on
sea service letters, alongside the raw day count. The Sea Time tab also breaks
the total down by rank.

## Security

| Layer | Choice |
|---|---|
| Key derivation | PBKDF2-SHA256, 310,000 iterations, 16-byte random salt |
| Encryption | AES-GCM 256, fresh 96-bit IV per record and per file |
| Key handling | A random data key is generated once and stored only wrapped by the passcode-derived key |
| Passcode change | Rewraps the data key — instant, no re-encryption of records |
| Verification | The GCM auth tag is the passcode check; there is no separate hash to attack |

Every record and every attachment is stored as ciphertext. Nothing on disk is
readable without the passcode — there are no plaintext index columns. The
passcode is never stored and never transmitted.

**If you forget the passcode, the data is unrecoverable.** That is the point, and
it is why backups matter.

The app auto-locks after a configurable idle period (5 minutes by default).

## Files on the device

Attachments are encrypted and held inside AVA's own database. Consequences worth
knowing:

- They are **not** visible when browsing the iPhone Files app — iOS cannot index
  what it cannot read.
- Any file can be sent back out at any time with **Save to Files** on the entry,
  which opens the normal iOS share sheet.
- Storage is finite. Keep large manuals in iCloud Drive and use the **cloud
  link** field instead of attaching them.

## Backups — read this

The device holds the only copy. Two things destroy it:

- deleting the Home Screen icon, or
- clearing Safari website data.

iPhone backups do not reliably capture web app storage, so **export regularly**.
Settings → *Export encrypted backup* produces a file that is ciphertext, safe to
keep in iCloud Drive, and restores only with the passcode that was in effect when
it was written. A plaintext export is also available and is exactly as dangerous
as it sounds.

## Installing on iPhone

The app must be served over HTTPS (or `localhost`). GitHub Pages works and is
free:

1. Push this repository, then enable **Settings → Pages → deploy from branch**.
2. Open the resulting URL in **Safari** — not Chrome; only Safari can install.
3. Tap **Share → Add to Home Screen**.
4. Launch it from the icon, not from Safari.

Installing matters: an installed web app is exempt from Safari's eviction of
unused website data, and it is what makes the storage persistent rather than
best-effort. Settings shows which state you are in.

## Running locally

```bash
npm start           # serves on http://localhost:8080
npm test            # 30 unit checks + 59-check end-to-end suite in Chromium
npm run test:unit   # calendar export only, no browser needed
npm run test:shots  # end-to-end, writing screenshots to tests/screens/
npm run icons       # regenerate the app icons from tools/lion.mjs
```

The end-to-end suite drives a real browser at iPhone dimensions through vault
creation, all six record types, the sea time arithmetic, expiry flagging, global
search, lock/unlock, and a reload with the network cut to prove the offline
shell. The unit suite checks the generated `.ics` against RFC 5545 — exclusive
all-day end dates, text escaping, alarm triggers and 75-octet line folding.

## Layout

```
index.html              app shell
sw.js                   offline shell cache
manifest.webmanifest    install metadata
css/app.css             maritime theme
fonts/                  self-hosted Oswald (a CDN font would break offline use)
js/crypto.js            key derivation, wrapping, AES-GCM
js/db.js                IndexedDB — stores ciphertext, knows nothing of keys
js/store.js             vault: decrypt on unlock, encrypt on write
js/schema.js            field definitions — every form and list is generated from these
js/derive.js            sea time totals, expiry status, date formatting
js/calendar.js          iCalendar (RFC 5545) export
js/icons.js             inline SVG icons
js/ui.js                DOM helpers
js/app.js               screens and interaction
tools/lion.mjs          the AVA lion mark, drawn as geometry
tools/make-icons.mjs    rasterises the mark to PNG icons via headless Chromium
```

Adding a field to any section is a one-line change in `js/schema.js`; the list
row, detail view and edit form all follow from it.

## Known limits

- **No Face ID.** A web app cannot reach the biometric API on iOS; the passcode
  is the lock. A native app could do better here.
- **Storage quota.** Safari limits how much a web app may store. Large PDFs are
  better left in iCloud with a link.
- **One device.** There is no sync. Moving to a new phone means exporting a
  backup and restoring it.
