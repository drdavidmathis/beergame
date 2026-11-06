# The Beer Game: setup guide

A browser-based Beer Game for a live class. Students join on their laptops or phones with a session code and their first name. No accounts are needed.

There are two ways to run it:

- **One class-wide network.** One brewery supplies 2 distributors, which supply 4 wholesalers, which supply 8 retailers. That makes 15 teams, about 4 students each in a class of 60.
- **Several classic games.** These are independent four-team chains, with about 3 students per team.

The game runs in two modes:

- **Test mode** (the default) keeps everything inside one browser. You can try the whole game by opening several tabs.
- **Classroom mode** stores the game in a free Firebase database so 60+ devices can play together.

---

## 1. Put the site online with GitHub Pages (15 minutes, free)

The files have to be served from a web address. They don't work if you double-click `index.html`.

1. Create a free account at **https://github.com** if you don't have one.
2. Click the **+** in the top right, then **New repository**.
   - Name it something like `beergame`.
   - Set it to **Public**. Free GitHub accounts can only publish public repositories as websites.
   - Leave the other options alone and click **Create repository**.
3. On the next page, click the link **uploading an existing file**.
4. Open the `beergame` folder on your computer and select **everything inside it**: `index.html`, `README.md`, `firestore.rules`, and the `css`, `js` and `tools` folders. Drag them all onto the upload area.
   - Drag the folder's contents, not the `beergame` folder itself. `index.html` must sit at the top level of the repository.
   - Chrome, Edge and Firefox keep the folders intact when you drag them. In Safari, use Chrome for this step if the folders don't appear.
5. Scroll down and click **Commit changes**. Wait for the upload to finish.
6. Go to the repository's **Settings** tab, then **Pages** in the left menu.
   - Under **Build and deployment → Source**, choose **Deploy from a branch**.
   - Under **Branch**, choose **main** and **/ (root)**, then click **Save**.
7. Wait a minute or two, then refresh the Pages screen. It shows your address, for example `https://yourusername.github.io/beergame/`.

The site is now live in **test mode**. To try it:

1. Open the address and click **Instructor**.
2. Create a session.
3. Open a few more tabs at the same address, click **Join a game**, and join as different students.
4. Back in the instructor tab, click **Form teams and start**.

*Alternative for trying it on your own computer only:* in a terminal, go into the folder, run `python3 -m http.server`, and open http://localhost:8000.

## 2. Create the Firebase database (15 minutes, free)

1. Go to **https://console.firebase.google.com**, sign in with a Google account, and click **Create a project**. Any name works, and you can turn off Google Analytics.
2. In the left menu, go to **Build → Authentication → Get started**. Under **Sign-in method**, click **Anonymous**, turn on **Enable**, and click **Save**.
3. Go to **Build → Firestore Database → Create database**.
   - For the location, pick a US one, for example `nam5` or `us-central1`.
   - Choose **Start in production mode**.
4. Open the **Rules** tab. Delete what's there, paste in the entire contents of `firestore.rules` from this folder, and click **Publish**.
5. Click the gear icon, then **Project settings**. Under **Your apps**, click the web icon `</>`.
   - Give it a nickname. Don't tick Hosting.
   - Click **Register app**.
   - You'll see a block of code containing `firebaseConfig = { apiKey: ..., ... }`.

## 3. Connect the game to Firebase

You can do this right on GitHub:

1. In your repository, open the `js` folder, click `config.js`, then click the pencil icon (**Edit this file**).
2. Change `export const BACKEND = "local";` to `export const BACKEND = "firebase";`
3. Replace each `PASTE-YOURS-HERE` value in `FIREBASE_CONFIG` with the matching value from step 2.5. Copy only the six values, keeping the quotes.
4. Click **Commit changes** (twice).

The site updates itself within a minute or two. Refresh your browser to pick up the change; if it still shows the old version, do a hard refresh (Cmd+Shift+R on a Mac). Any later edits work the same way.

Your repository is public, so anyone can see these values. That's expected: the Firebase "apiKey" is not a secret. It identifies your project, and the security rules you published in step 2.4 are what protect the data.

## 4. Do a dry run before class

Use a TA, or a laptop plus a phone and a couple of browser windows.

1. As the instructor, create a session.
2. Join as 2–3 students from other devices or browsers.
   - In classroom mode, each browser remembers one student.
   - To play several students from one browser, open a new tab, go to the join page, and click **"Testing with several tabs?"** That tab becomes a separate student.
3. Try the following:
   - Auto-assign, then move a student.
   - Start the game and play a few weeks.
   - Remind a team, use **Repeat last** and **Computer decides**, and correct a past order.
   - Use **+5 weeks**, then end the game and check the Debrief tab.

If anything doesn't work, the browser console usually says why: right-click the page, choose **Inspect**, then **Console**. Send me the message.

You can also open the **Simulation lab** (link at the bottom of the Instructor page). It plays a whole game with computer players in seconds, checks the simulation's bookkeeping every week, and lets you step through every team's state week by week. It doesn't use the database.

## 5. Running it in class

1. Open the site, click **Instructor**, choose your settings, and create the session.
2. Project the lobby screen, which shows the web address and the 4-letter code. Students join with their **first name and last initial**.
3. Click **Auto-assign teams**. Teams and roles are random and balanced. Then adjust:
   - Change any student's team from the dropdown.
   - Make someone captain.
   - Remove a duplicate entry.
   - Press **Reshuffle teams** to start over.

   You can also skip this step and press **Start game**, which assigns at random.
4. Click **Start game**.
5. **Keep the instructor tab open and the laptop awake for the whole game.** Your dashboard is what runs each week.
   - If it closes, nothing is lost. The game waits until you reopen the session from the same browser.
   - Your recent sessions are listed on the Instructor page.

**Rejoining.** A student who refreshes or loses their connection comes back to the same team by reopening the page in the same browser. If someone switches devices, they join again and you move the new entry to their team from the **Teams** tab, then remove the old entry.

**Late arrivals.** Students who join after the start are seated automatically on the smallest team, preferring teams the computer is playing. You can turn this off when creating the session and seat them yourself.

### Dashboard

| Where | Control | What it does |
|---|---|---|
| Top bar | **+5 weeks** | Lengthens the game. Students are never shown the length. Also resumes a game that has reached its end. |
| Top bar | Pause / Resume, Settings, End game | Settings (brewery capacity, surge cost, holding and backorder costs, order limits) take effect next week. End game opens the debrief. |
| Live | **Waiting on N teams** panel | Shows how long each team has waited, with **Remind**, **Repeat last (n)**, **Computer decides** and **Enter…** for each. The week advances by itself once every team has a decision. |
| Live | Advance now | Moves the week forward. Any team that hasn't submitted repeats last week's order. |
| Live | Undo last week, Restart | Steps a game back one week (and pauses), or back to week 1. |
| Live | Click a team | Shows the team's students, captain, computer toggle, recent weeks and chat. **Enter or correct an order** works for this week or any past week. |
| Teams | Roster | Move students between teams, set captains, hand a team to the computer or back, and remove entries. |
| Debrief | Charts | Bullwhip chart, brewery production vs. capacity, cumulative costs, a team comparison that can highlight one team or branch, inventory and backorders, costs by team, and bullwhip ratios. |
| Log | Instructor log | Every correction, reminder, decision made on a team's behalf, undo, settings change and roster change. |
| Export | CSV files | Game data (including who made each weekly decision), team chats, and the log. |

**Correcting a past order.** Pick the week and the right number. The game re-runs from that week with the corrected order and recalculates every later week, using the orders teams actually submitted. Inventories, shipments and backorders stay consistent everywhere. Computer-played teams re-decide based on the corrected situation. The team gets a note in its chat, and the change is logged.

## Changing the defaults

All default settings are in `js/config.js`, with comments. Every setting is also on the **New session** form, so you can change them per session without editing the file.

## Order checks

- Students can only enter whole numbers, 0 or more. Blank entries, negatives, decimals and text are rejected with a message.
- An order above about 3× what the team has recently been receiving asks the captain to confirm the exact amount.
- An order above the team's hard maximum is rejected with an explanation. It is never trimmed automatically.
  - The hard maximum is 10× normal weekly flow for retailers, 15× for wholesalers and 20× for distributors.
  - With the network defaults, that's 40, 120 and 320 cases.
  - The brewery's limit is its surge capacity.
- The database enforces the same limits, so they can't be bypassed through the browser's developer tools.
- Each team's order locks once submitted. Only you can change it.

## Computer players

Computer players fill teams without students. Their style is set on the New session form:

- **Steady** (the default) uses one predictable rule for every team.
- **Mixed** gives each team one of four styles: steady, conservative, reacts strongly, or forecast-based.

The **random seed** makes a mix repeatable: the same seed always gives the same assignment. The "reacts strongly" style pays less attention to beer already on the way, the way many people do. A game full of mixed computer players can therefore show a bullwhip on its own.

## Free-tier usage

A 60-student, 36-week session uses roughly 10,000–20,000 database reads and a few thousand writes. Chat is the biggest share. The free plan allows 50,000 reads and 20,000 writes per day, so two sections in a day is fine. You never need to add a credit card.

## Files

- `index.html`, `css/`, `js/`: the game
- `js/config.js`: settings and the Firebase connection
- `firestore.rules`: database security rules (paste into Firebase)
- `tools/test.mjs`: the integrity test suite. With Node.js installed, run `node tools/test.mjs`. It plays full 36-week games, then checks every rule: no negative inventory, exact delays, fair allocation, no lost or duplicated cases, consistent corrections, and records that reconcile row by row.
- `tools/simulate.mjs`: optional calibration script. Run `node tools/simulate.mjs network typical` to see how simulated players stress the brewery under the current settings.
