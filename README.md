# Redzai Guesthouse

Booking website for Redzai Guesthouse, built with plain HTML, CSS and JavaScript.
No build step or server code is needed.

## Features

Guests can book:

| Option | ID | Notes |
| --- | --- | --- |
| Whole House | `house` | All three rooms; can't overlap any room booking |
| Room 1 | `r1` | Big room, ground floor |
| Room 2 | `r2` | Small room, upstairs |
| Room 3 | `r3` | Small room, upstairs |

Prices, guest limits, photos and descriptions are in the `ROOMS` array in `js/store.js`.

| Page | File | What it does |
| --- | --- | --- |
| Welcome | `index.html` | Landing page with the business name, the four options, and links to check availability or sign in |
| Room availability | `rooms.html` | Choose dates and guests to see which options are free |
| Room details | `room.html` | Two-month availability calendar (booked nights are crossed out), price summary, and reservation |
| Login | `login.html` | Log in or sign up for a member account |
| Pay deposit | `pay.html` | Deposit amount, DuitNow QR, and "I've paid" for a reserved booking |
| Admin | `admin.html` | Admins only: approve or decline bookings, mark cash deposits received |
| Members | `members.html` | Members-only page: profile, booking stats, and upcoming, past and cancelled bookings, with cancellation |

Member accounts use **Firebase Authentication** (email and password), and profiles and bookings are stored in **Cloud Firestore**. The free Spark plan is enough for this site.

## Firebase setup (one time)

1. Go to https://console.firebase.google.com and click **Create a project**. Google Analytics is not needed.
2. **Build → Authentication → Get started → Sign-in method**: enable **Email/Password**.
3. **Build → Firestore Database → Create database**: pick a location (for Malaysia, `asia-southeast1` Singapore) and start in **production mode**.
4. **Firestore Database → Rules**: replace everything with the contents of `firestore.rules` and click **Publish**.
5. **Project settings (gear) → General → Your apps → Web (`</>`)**: register an app (no Hosting needed), then copy the `firebaseConfig` values into `js/firebase-config.js`.
6. **Authentication → Settings → Authorized domains**: add `syakirrizlan.github.io`.

Until step 5 is done, the site shows "Firebase is not configured yet".

## Deposits and approval

1. A member reserves dates and accepts the non-refundable RM50 deposit. The dates are **held for 24 hours** (status *awaiting deposit*).
2. They pay by DuitNow QR or cash and tap **I've paid** (*awaiting approval*). The hold no longer expires. If nobody pays within 24 hours, the booking shows as *expired* and the dates are free again.
3. An admin checks the money arrived and **approves** (*confirmed*) or **declines** (*declined*; a deposit already paid is marked for refund). For cash paid in person, **Cash received – approve** confirms straight away.
4. The balance is paid on arrival. A member who cancels after paying forfeits the deposit.

The deposit amount, QR image, account name and WhatsApp number are in `PAYMENT` in `js/store.js` (placeholders for now). The 24-hour hold is also written in `firestore.rules`; change both together.

### Making someone an admin

1. Firebase console → **Authentication → Users**: copy the person's **User UID**.
2. **Firestore → Data → Start collection** (or open `admins`): collection ID `admins`, document ID = that UID, add a field `role` (string) = `owner`. Save.
3. They log in again and an **Admin** link appears.

To remove an admin, delete their document from `admins`.

## Publishing changes

Every page loads its CSS and JavaScript with a version tag, e.g. `js/store.js?v=20261117`. When you change any CSS or JS file, change the tag in **all** `.html` files to a new value (for example today's date). Browsers then fetch the new files together instead of mixing cached old files with new ones.

```bash
sed -i -E 's/\?v=[0-9]+/?v=NEWVALUE/g' *.html
```

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. `localhost` is an authorized domain by default.

## How it works

- `js/store.js` loads the Firebase SDK from Google's CDN, so there is still no build step.
- `users/{uid}`: member profile (name, phone, join date). Only that member can read or change it.
- `admins/{uid}`: one document per admin; managed in the Firebase console only.
- `bookings/{id}`: room, dates, guests, status and payment details. Only the member who made it and admins can read it. Members can mark it paid or cancel it; only admins can approve or decline.
- `nights/{roomId}_{date}`: one document per booked night, readable by everyone to show availability. It holds no personal data. Firestore refuses to create a night that already exists (unless its unpaid 24-hour hold has run out), so two members can never book the same night, even at the same moment.
- Booking the Whole House writes a night document for each of `r1`, `r2` and `r3`, so it can never overlap a room booking, and a room booking blocks the Whole House.
- Room listings are defined in the `ROOMS` array in `js/store.js`. If you add or rename a room, update the room lists in `firestore.rules` and publish the rules again.

The `firebaseConfig` values in `js/firebase-config.js` are not secret; access is controlled by sign-in and `firestore.rules`.

## Testing with the Firebase emulator

`firebase.json` configures the Auth and Firestore emulators:

```bash
npx firebase-tools emulators:start --project demo-homestay --only auth,firestore
```

Add `useEmulators: true` to `FIREBASE_CONFIG` to point the site at them.
