# wa-engine

One WhatsApp bot that sells and runs tests for **YNeet**, **TestMandi** and **ClassCoach**.
Students, buyers and tutors use it from WhatsApp with no app and no login: their phone number is their account.

## What each product does

| | YNeet | TestMandi | ClassCoach |
|---|---|---|---|
| Who chats | NEET student | Test buyer (seller gets alerts) | Tutor; students join by link |
| Entry | `Hi`, ads, `Hi REF CODE` from a friend | `TEST CODE` from a seller's share link | `Hi` (tutor), `JOIN CODE` (student) |
| Free hook | Daily 3-question quiz + 1 free full mock | 5 free sample questions in chat | 14-day Pro trial, free up to 20 students |
| Paid | ₹49 analysis · ₹199 10-mock pack (highlighted) · ₹999 season pass | Test price (seller keeps 70%) · bundles | ₹299 / ₹499 a month · ₹4,990 a year · ₹199 NEET/JEE pack |
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
  "code":"SSC-GK-101","title":"SSC CGL GK Mock 1","price":29,"durationMin":30,
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

Only message people who contacted you or agreed to messages. Parent numbers come from the student; tell parents how to stop (STOP) in the first message.

## Watch the numbers
```bash
curl https://<domain>/admin/stats -H "x-api-key: $ADMIN_KEY"
```
Shows, per product for the last 7 days: users, new users, payment links created, paid orders, revenue, tests taken and payment conversion. If many links are created but few are paid, test a lower first price; if few links are created, improve the free hook.

## Commands people can type
- Everyone: `MENU`, `STOP`, `START`
- YNeet: `QUIZ`, `MOCK`, `PLANS`, `REPORT`, `REFER`, `PARENT`, `UNLOCK`, `Hi REF CODE`
- TestMandi: `TEST CODE`, `SELLER`
- ClassCoach tutor: `QUIZ`, `RESULTS`, `CLASS`, `PLANS` · student: `JOIN CODE`

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
