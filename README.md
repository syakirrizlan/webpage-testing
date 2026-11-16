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

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. `localhost` is an authorized domain by default.

## How it works

- `js/store.js` loads the Firebase SDK from Google's CDN, so there is still no build step.
- `users/{uid}`: member profile (name, phone, join date). Only that member can read or change it.
- `bookings/{id}`: room, dates, guests and status. Only the member who made it can read or cancel it.
- `nights/{roomId}_{date}`: one document per booked night, readable by everyone to show availability. It holds no personal data. Firestore refuses to create a night that already exists, so two members can never book the same night, even at the same moment.
- Booking the Whole House writes a night document for each of `r1`, `r2` and `r3`, so it can never overlap a room booking, and a room booking blocks the Whole House.
- Room listings are defined in the `ROOMS` array in `js/store.js`. If you add or rename a room, update the room lists in `firestore.rules` and publish the rules again.

The `firebaseConfig` values in `js/firebase-config.js` are not secret; access is controlled by sign-in and `firestore.rules`.

## Testing with the Firebase emulator

`firebase.json` configures the Auth and Firestore emulators:

```bash
npx firebase-tools emulators:start --project demo-homestay --only auth,firestore
```

Add `useEmulators: true` to `FIREBASE_CONFIG` to point the site at them.
