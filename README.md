# wa-engine

One WhatsApp bot that sells and runs tests for **YNeet**, **TestMandi** and **ClassCoach**.
Students, buyers and tutors use it from WhatsApp with no app and no login: their phone number is their account.

## What each product does

| | YNeet | TestMandi | ClassCoach |
|---|---|---|---|
| Who chats | NEET student | Test buyer (seller gets alerts) | Tutor; students join by link |
| Entry | `Hi`, ads, `Hi REF CODE` from a friend | `TEST CODE` from a seller's share link | `Hi` (tutor), `JOIN CODE` (student) |
| Free hook | 30-day free trial, daily quiz, quick chapter practice, 1 free NEET mock, 1 chapter test a day | 5 free sample questions, free tests | 1-month free trial, 10 students |
| Paid | 30 days free once, then monthly by class (₹300–₹600 a month, 1–12 months at a time, each to month end), same as app.yneet.in | Test price (seller keeps 80%, same as testmandi.in) · bundles | Starter ₹499 · Growth ₹999 · Pro ₹1,999 (2 months, or ₹2,499 / ₹4,999 / ₹9,999 a year) · NEET/JEE ₹599–₹1,999 a month or yearly, same as classcoach.in |
| Brings people back | Streaks, 7 PM reminder, referral credits, Sunday parent report | Rank among buyers, rating, seller's pack and other tests | Results as they arrive, reminders, upgrade when class grows |

### Built-in sales tactics
- **Free first, pay at the moment of curiosity.** The score is free; the analysis and rank are what people pay for, offered right after the test.
- **Price ladder.** Three options with the middle one marked best value, so most people pick ₹199 instead of ₹49.
- **One-tap UPI.** Razorpay payment link inside the chat; the purchase arrives in the chat seconds after paying.
- **Unfinished payment reminder.** One friendly reminder 30 minutes after an unpaid link.
- **Streak rewards and referrals.** Every 3-day streak and every friend who joins earns a free analysis.
- **Real social proof only.** "312 students practised today" appears only when the real number is 20 or more. Ratings show after 5 ratings.
- **Real deadlines only.** Set `OFFER_ENDS_ON` for a genuine offer; nothing is shown otherwise.
- **Upgrade at the right moment.** ClassCoach asks tutors to upgrade when their class passes 20 students (students are never turned away mid-quiz; 5 extra are allowed) or when the trial is ending.
- **Sellers become marketers.** TestMandi sellers get a WhatsApp share link per test and an instant alert with their share for every sale.

### Question banks
`data/neet_bank.json` holds the 3,627-question NEET bank shared with YNeet and ClassCoach (98 chapters, Class 11–12, difficulty, PYQs 2016–2026). It loads at start-up into YNeet (Physics / Chemistry / Biology) and ClassCoach (NEET Biology / Physics / Chemistry). Replace the file and redeploy to update it.

### YNeet on WhatsApp
Class selection (sets the monthly price), daily quiz with streaks, chapter practice (5 in chat, or a 15-question test), previous-year papers by year, NEET-pattern mocks (45 Physics + 45 Chemistry + 90 Biology, 180 minutes, +4/−1), mistake revision, weekly leaderboard, parent reports. With `YNEET_DATABASE_URL` set, plans are shared with app.yneet.in in both directions.

### Refer & earn
| Product | Link people share | Friend gets | Inviter gets |
|---|---|---|---|
| YNeet | `Hi REF CODE` | 1 free premium test after first quiz | 1 free premium test, plus 1 free month when the friend buys Monthly |
| TestMandi buyer | `Hi TREF CODE` | ₹10 off first test | ₹10 wallet credit when the friend buys (used automatically) |
| TestMandi seller | `Hi SREF CODE` | Keeps the normal 80% | 5% of the invited seller's sales for 6 months, paid from TestMandi's share |
| ClassCoach | `Hi CREF CODE` | 1-month free trial | 2 months free for every 2 teachers who buy a plan |

People get their link by sending `REFER` (TestMandi sellers: `SELLER`).

### TestMandi catalogue
With `TESTMANDI_SYNC=true` the bot copies every test, bundle, price, rating and question from testmandi.in (database `TESTMANDI_DB` on the same cluster) at start-up and every 15 minutes. Each test gets a short WhatsApp code (`TEST K7QM2X`). Every WhatsApp sale is written to TestMandi's `purchases` / `bundlePurchases` at the list price (buyer shown as `<phone>@whatsapp.testmandi.in`), so it counts in the seller's normal TestMandi payout. Sellers are matched by the phone on their TestMandi account; their referral code is TestMandi's own, and TestMandi's ₹200 seller programme pays those bonuses.

`BROWSE` (or the Browse button) shows categories with test counts, then 8 tests per page with "More tests". `SEARCH ssc gk` searches titles, categories and teacher names. Tests priced ₹0 open straight away with no payment. Give each test a `category` when creating it (SSC, NEET, TNPSC, Banking…).

Prices and limits are in `src/products.js`. Change them there.

## Try it locally (no WhatsApp needed)

```bash
npm install
npm run dev
# open http://localhost:8080/sim
```

The simulator lets you chat as any phone number. Test and payment links open real pages; payments are simulated.

```bash
npm test   # runs full conversations for all three products
```

## Go live

### 1. Deploy (Railway)
1. Push this folder to a new GitHub repo (for example `alimail791/wa-engine`).
2. In Railway: New service → from that repo. Railway runs `npm start`.
3. Add the variables from `.env.example`. Use your existing MongoDB Atlas cluster with a new database name (`MONGODB_DB=wa_engine`).
4. Give it a domain, for example `wa.yneet.in`, and set `BASE_URL` to it.
5. Check `https://<domain>/health` shows `"provider":"meta","store":"mongo"`.

### 2. Connect WhatsApp
The bot speaks the **WhatsApp Cloud API** format (interactive buttons, lists, URL buttons, templates).
- **Meta direct:** create a WhatsApp app in Meta for Developers, add your numbers, create a permanent token. Webhook URL: `https://<domain>/webhooks/whatsapp`, verify token = `WA_VERIFY_TOKEN`, subscribe to `messages`.
- **Through a BSP:** works with any provider that exposes the same Cloud API (set `WA_API_BASE` to their URL and `WA_TOKEN` to their key, and point their webhook at the URL above). Check with AiSensy whether your plan includes direct Cloud API access with webhooks for incoming messages; some plans only offer campaign sending, which is not enough for a two-way bot.
- **Raise Academy setup: one number for all three products** (+91 94434 24064). Put its **Phone number ID** (shown in WhatsApp Manager / your BSP, not the phone number itself) in `WA_PHONE_ID_SHARED`.
  - Share links skip the menu: `TEST CODE` goes to TestMandi, `JOIN CODE` to ClassCoach, `Hi REF CODE` to YNeet.
  - Anyone else who says Hi gets a 3-button menu (NEET preparation / Buy mock tests / I'm a teacher). The choice is remembered; `SWITCH` shows the menu again.
- You can move to separate numbers later with `WA_PHONE_ID_YNEET` / `_TESTMANDI` / `_CLASSCOACH`.
- Your existing WhatsApp AI agent should not be on the same number, or two bots will answer each message.

#### AiSensy API key
The normal AiSensy API key (Manage → API Key) is for **API campaigns**: it sends approved templates only. It does not deliver incoming messages to this bot and cannot send buttons, lists or free replies, so it cannot run the conversations on its own.
- Set `AISENSY_API_KEY` to send the reminder templates (daily quiz, parent report, seller sale, class quiz, upgrade, trial ending) through AiSensy. Create one API campaign per template in AiSensy and put the **campaign name** in the matching `TEMPLATE_*` variable.
- For the two-way bot, you also need Cloud API access for the number (`WA_TOKEN` + `WA_PHONE_ID_SHARED`), either directly from Meta or from AiSensy if they offer Cloud API passthrough with an incoming-message webhook on your plan.

### 3. Connect Razorpay
1. Add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. Razorpay Dashboard → Webhooks → URL `https://<domain>/webhooks/razorpay`, event `payment_link.paid`, set a secret and copy it to `RAZORPAY_WEBHOOK_SECRET`.

### 4. Load your questions
Upload your CSV (the 4,000+ PCB bank works). Common column names are recognised: `subject, topic/chapter, question, option_a…option_d, answer (A–D, 1–4 or the option text), explanation`.

```bash
# check first without saving
curl -X POST "https://<domain>/admin/questions/import?product=yneet&dryRun=1" \
  -H "x-api-key: $ADMIN_KEY" -H "Content-Type: text/csv" --data-binary @questions.csv
# then import for real
curl -X POST "https://<domain>/admin/questions/import?product=yneet" \
  -H "x-api-key: $ADMIN_KEY" -H "Content-Type: text/csv" --data-binary @questions.csv
```
- YNeet: `product=yneet`.
- ClassCoach: `product=classcoach`. Subjects that start with `NEET` or `JEE` (for example `NEET Biology`) are treated as the paid pack. Upload the PCB bank with `&subject=NEET Biology` etc. if your CSV has no such subject names.
- TestMandi: `product=testmandi&tag=SSC-GK-1`, then create the test:

```bash
curl -X POST https://<domain>/admin/tests -H "x-api-key: $ADMIN_KEY" -H "Content-Type: application/json" -d '{
  "code":"SSC-GK-101","title":"SSC CGL GK Mock 1","category":"SSC","price":29,"durationMin":30,
  "tag":"SSC-GK-1","count":50,"sellerPhone":"91XXXXXXXXXX","sellerName":"Raise Academy"}'
# a bundle
curl -X POST https://<domain>/admin/tests -H "x-api-key: $ADMIN_KEY" -H "Content-Type: application/json" -d '{
  "code":"SSC-GK-PACK","type":"bundle","title":"SSC GK Mock Pack","price":149,"testCodes":["SSC-GK-101","SSC-GK-102"],"sellerName":"Raise Academy"}'
```
The response includes the WhatsApp share link for the test.

### 5. Get templates approved (optional, for messages outside 24 hours)
Inside 24 hours of a person's last message, the bot replies for free. To message first, Meta requires approved templates, charged per message. Create these in WhatsApp Manager and put their names in the `TEMPLATE_*` variables. Without them, those messages are simply skipped.

| Variable | Category | Suggested text ({{n}} = parameters in this order) |
|---|---|---|
| `TEMPLATE_DAILY_QUIZ` | Marketing | Your NEET quiz for today is ready. Current streak: {{1}} days. Reply QUIZ to start. |
| `TEMPLATE_PARENT_REPORT` | Utility | Weekly YNeet report for {{1}}: {{2}} daily quizzes, {{3}} mock tests, best score {{4}}. Topics to revise: {{5}}. |
| `TEMPLATE_SELLER_SALE` | Utility | New sale on TestMandi: {{1}}. Your share: {{2}}. Sales today: {{3}}. |
| `TEMPLATE_CLASS_QUIZ` | Utility | {{1}} has a new quiz: {{2}}. Reply {{3}} to get your link. |
| `TEMPLATE_CLASS_RESULTS` | Utility | Results for "{{1}}": {{2}} students have finished. Reply RESULTS to see marks. |
| `TEMPLATE_UPGRADE` | Utility | {{1}} now has {{2}} students. Reply PLANS to add everyone. |
| `TEMPLATE_TRIAL_ENDING` | Utility | Your ClassCoach Pro trial ends in 2 days. Your class has {{1}} students. Reply PLANS to keep Pro. |
| `TEMPLATE_YNEET_TRIAL_D3` | Marketing | Hi {{1}}, your YNeet free trial is on, but you haven't taken a test yet. Start with one 20-minute chapter test and see your score with every explanation. |
| `TEMPLATE_YNEET_TRIAL_D7` | Marketing | Week 1 done, {{1}}! You solved {{2}} questions with {{3}} accuracy. Your weakest chapter is {{4}}. Practise it today on YNeet. |
| `TEMPLATE_YNEET_TRIAL_D20` | Marketing | Hi {{1}}, 10 days left in your YNeet free trial. Your full mock score: {{2}}. Take one full NEET mock this week to see how far you've come. |
| `TEMPLATE_YNEET_TRIAL_D27` | Marketing | Hi {{1}}, your YNeet free trial ends in 3 days. This month: {{2}} days studied, {{3}} tests. Continue from ₹399/month, or ₹3,199 for a full year. Your progress stays saved. |
| `TEMPLATE_YNEET_TRIAL_ENDED` | Marketing | Hi {{1}}, your YNeet free trial has ended. Your tests, mistake notebook and streak are saved. Pick a plan to carry on from where you stopped. |

| `TEMPLATE_YNEET_WELCOME` | Marketing | Hi {{1}}, welcome to YNeet! Your account is ready. Start with one 20-minute chapter test today and see your weak chapters. Any doubt, just reply to this message. |
| `TEMPLATE_YNEET_VERIFY` | Utility | Hi {{1}}, please confirm your WhatsApp number or email on YNeet. It takes 30 seconds and keeps your account active. |
| `TEMPLATE_YNEET_PARENT` | Marketing | Hi {{1}}, add your parent's WhatsApp number or email in YNeet (Profile, Parent updates). They will get a short weekly report of your tests and progress. |
| `TEMPLATE_YNEET_REFER` | Marketing | Hi {{1}}, enjoying YNeet? Share it with your NEET friends. When a friend joins with your link and takes a plan, you get 1 month of YNeet free. Your link: {{2}} |
| `TEMPLATE_YNEET_MISSYOU` | Marketing | Hi {{1}}, we miss you on YNeet! It has been {{2}} days since your last practice. A 20-minute chapter test today keeps your NEET prep on track. |

Lifecycle messages (`src/yneetLifecycle.js`): welcome every 10 minutes from 8 AM to 9:30 PM IST; verify, parent, refer and miss-you once a day at 5:30 PM IST, at most one per student per day and never on a day the trial journey already messaged them.

The five `TEMPLATE_YNEET_TRIAL_*` templates drive the 30-day trial journey (`src/yneetJourney.js`, daily 11:15 IST, needs `YNEET_DATABASE_URL`). Give each one a "Visit website" button with the static URL `https://app.yneet.in/pricing` (D3: `https://app.yneet.in`). Inside the 24-hour window the bot sends a free message with a button instead.

#### TestMandi account messages (`src/tmLifecycle.js`)
Every 30 min, 10:00–20:00 IST, reading testmandi.in's users (needs `TESTMANDI_SYNC=true`). At most one message per user per run, each sent once. Welcome and verify go only to accounts created after the first run (or `TM_LIFECYCLE_SINCE`). Set `TM_LIFECYCLE=off` to pause.

| Variable | Category | Text ({{n}} in this order) | Quick-reply button (payload) |
|---|---|---|---|
| `TEMPLATE_TM_WELCOME` | Marketing | Hi {{1}}, welcome to TestMandi! 🎉 Practise mock tests for NEET, JEE, SSC and more, with instant results, your rank and an explanation for every question. Teachers can sell their own tests and keep 80% of every sale. Start at testmandi.in or tap below to browse tests here on WhatsApp. Reply STOP to opt out. | Browse tests (`tm:browse`) |
| `TEMPLATE_TM_VERIFY_EMAIL` | Utility | Hi {{1}}, your TestMandi account is almost ready. Please verify your email: log in at testmandi.in and enter the code we emailed you (or tap Resend code). Is this WhatsApp number yours? Tap below to confirm it for order and test updates. | Yes, it's me (`tm:phoneok`) |
| `TEMPLATE_TM_VERIFY_PHONE` | Utility | Hi {{1}}, please confirm this WhatsApp number for your TestMandi account so we can send your order and test updates here. | Yes, it's me (`tm:phoneok`) |
| `TEMPLATE_TM_REFER` | Marketing | 🎁 {{1}}, invite friends to TestMandi and earn. Share your referral code {{2}} and get {{3}}. Friends enter the code when they register at testmandi.in. | Share my code (`tm:refer`) |
| `TEMPLATE_TM_MISS_YOU` | Marketing | We miss you, {{1}}! 👋 It's been {{2}} days since your last visit to TestMandi. New tests are added every week. One 20-minute chapter test today keeps your preparation on track. | Browse tests (`tm:browse`) |

"Yes, it's me" sets `phoneVerified` on the testmandi.in user; "Not my number" (free message only) stops these messages for that account.

Only message people who contacted you or agreed to messages. Parent numbers come from the student; tell parents how to stop (STOP) in the first message.

## Watch the numbers
```bash
curl https://<domain>/admin/stats -H "x-api-key: $ADMIN_KEY"
```
Shows, per product for the last 7 days: users, new users, payment links created, paid orders, revenue, tests taken and payment conversion. If many links are created but few are paid, test a lower first price; if few links are created, improve the free hook.

## Commands people can type
- Everyone: `MENU`, `STOP`, `START`
- YNeet: `QUIZ`, `MOCK`, `CHAPTER`, `PYQ`, `MISTAKES`, `RANK`, `PLANS`, `REPORT`, `REFER`, `PARENT`, `CLASS`, `Hi REF CODE`
- TestMandi: `TEST CODE`, `BROWSE`, `SEARCH words`, `REFER`, `SELLER`
- ClassCoach tutor: `QUIZ`, `RESULTS`, `CLASS`, `PLANS`, `REFER` · student: `JOIN CODE`

## Using your own web apps instead of the built-in test page
Magic links open a built-in test page at `/t/<token>` so everything works today. To run tests inside app.yneet.in, testmandi.in or classcoach.in instead, have the app call `POST /api/magic/verify` with `{ token }` and header `x-api-key`. It returns the phone, question ids and a signed session. When the student submits, the app calls `POST /api/results` with `{ token, answers: { <questionId>: <optionIndex> } }` and the same header, so the WhatsApp result and upsell still go out.

## Code map
```
src/server.js         start-up
src/app.js            routes: webhook, test pages, payments, simulator, admin
src/engine.js         turns a message into a flow call
src/flows/*.js        yneet, testmandi, classcoach conversations
src/products.js       names, prices, limits
src/payments.js       Razorpay payment links and webhook
src/magic.js          one-time login links
src/nudges.js         reminders on a schedule (India time)
src/questions.js      picking, grading, CSV import
src/providers/        WhatsApp Cloud API sender and the simulator
```

## Live tests (TestMandi)
Teachers schedule live tests on testmandi.in. The bot syncs them every 2 minutes, shows a "🔴 Live tests" row in Browse and the live time on the test card, sends every owner the join link when the window opens (template `TEMPLATE_LIVE_START` with params title, minutes left for people outside the 24-hour window), and puts WhatsApp attempts made inside the window on testmandi.in's live leaderboard.

## Referral rewards that mirror testmandi.in
- A TestMandi seller who invites a student (TREF link) gets ₹200 in their testmandi.in payout balance when the student's first WhatsApp purchase is paid.
- A teacher who signs up with a seller's code earns that seller ₹200 when they publish their first test (handled by testmandi.in).

## Lead engine (open /admin/leads?key=ADMIN_KEY)
Import Excel/CSV contact lists → the bot sends a safe daily campaign (daily cap, 10 AM–7 PM, Mon–Sat) with a template matched to each contact type → button taps open live demos (ClassCoach quiz maker, YNeet practice, TestMandi earnings calculator) → "Talk to us" / HELP hands the chat to a person and alerts the owner → automatic follow-ups after 3 and 7 days, then stops → onboarding nudges after demo/trial/payment.
Safety: auto-pause on WhatsApp spam/limit errors, quality downgrades, or when Stop taps pass LEAD_MAX_STOP_PCT. Replies typed in the WhatsApp Business app pause the bot for that chat (subscribe the app webhook to `smb_message_echoes`). Owner can send REPORT to the bot for a summary; a summary is also sent at 9 AM.
