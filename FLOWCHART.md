# Flowchart

How VidHelp runs today, as built (7 Oct 2026). The first chart shows the whole app across roles; the rest show each module.

## 1. The whole app: host, operator, admin, finance

```mermaid
flowchart TD
  subgraph HOST["Host (phone)"]
    H1["Sign up<br/>email or Google"]
    H2["My schedule +<br/>product knowledge"]
    H3["Check in → live →<br/>check out"]
    H4["Live report<br/>within 24 h"]
    H5["Request or cover<br/>a backup"]
    H6["Claim event blocks"]
    H7["Score, SP,<br/>salary slips"]
    H8["Leader (brand PIC):<br/>request payment<br/>when target is reached"]
  end
  subgraph ADMIN["Admin"]
    A1["Approve sign-ups,<br/>create accounts"]
    A2["Brands, rate levels,<br/>settings"]
    A3["Monthly ratings,<br/>SP corrections"]
  end
  subgraph OPS["Operator"]
    O1["Assign hosts<br/>to brands"]
    O2["Weekly slots"]
    O3["Decide backups"]
    O4["Review flagged<br/>reports"]
    O5["Special events"]
    O6["Record violations"]
  end
  subgraph FIN["Finance"]
    F1["Track pay periods,<br/>close one early"]
    F2["Mark paid →<br/>salary slips"]
    F3["Kasbon"]
  end
  subgraph AUTO["Automatic"]
    S1["Auto-approve<br/>reports"]
    S2["Auto-pick cover<br/>30 min before"]
    S3["Close a pay period<br/>when its target is reached"]
    S4["Point penalties,<br/>automatic SP"]
  end
  H1 --> A1 --> O1
  A2 --> O1
  O1 --> O2 --> H2 --> H3 --> H4
  H4 -->|fits the schedule| S1
  H4 -->|flagged| O4
  S1 --> F1
  O4 --> F1
  S3 --> F1
  H5 --> O3 --> H2
  H5 -.->|no decision| S2 --> H2
  O5 --> H6 --> H3
  O6 --> S4 --> H7
  A3 --> S4
  F1 --> F2 --> H7
  F3 --> F2
```

Every step that concerns someone sends a notice to the in-app bell, and to Discord when it is set up. Admins can do everything operators and finance can.

## 2. Accounts and sign-in

```mermaid
flowchart TD
  A(["New person"]) --> B{"How?"}
  B -->|Registers with email or Google| C["Host account, pending"]
  B -->|Admin creates the account| D["Active at once, any role"]
  C --> E["Admins notified"]
  E --> F{"Admin activates?"}
  F -->|Not yet| C
  F -->|Yes| G["Active; host profile made;<br/>host notified"]
  G --> H["Sign in: password or Google"]
  D --> H
  H --> I{"Account active?"}
  I -->|No| X["Refused: pending or deactivated"]
  I -->|Yes| J{"Admin or finance?"}
  J -->|No| K["Home page for the role"]
  J -->|Yes, 2FA not set up| L["Set up authenticator app,<br/>save 8 recovery codes"]
  J -->|Yes, 2FA on| M["Enter 6-digit code<br/>or a recovery code"]
  L --> K
  M -->|5 wrong codes| H
  M --> K
  K --> N["Host: Live · Operator: Dashboard<br/>Admin: Dashboard · Finance: Payroll"]
```

```mermaid
flowchart LR
  A["Active"] -->|Leave: deactivate| B["Inactive<br/>signed out, schedule kept"]
  B -->|Activate| A
  A -->|Resigned: archive| C["Archived<br/>signed out, taken off the schedule"]
  B -->|Archive| C
  C -->|Banned from a brand<br/>or asked to be deleted| D["Deleted permanently<br/>personal data wiped, pay history kept"]
```

## 3. Brands, assignments and weekly schedule

```mermaid
flowchart TD
  A["Admin creates a brand:<br/>target hours per period, payroll start,<br/>product knowledge"] --> B["Operator assigns hosts,<br/>picks one leader"]
  B --> C["Operator adds a weekly slot:<br/>host, one or more days (or every day),<br/>time, from date; sees each host's free times"]
  C --> D{"Clash? the brand already live then,<br/>or the host busy elsewhere"}
  D -->|Yes| C
  D -->|No| E["Slot saved<br/>can be undone within 10 min"]
  E --> F["Host sees it in My Schedule,<br/>with the brand's product knowledge"]
  E --> G{"Change later?"}
  G -->|Edit a slot that already ran| H["Old slot ends the day before;<br/>a linked new slot continues;<br/>past weeks and pay unchanged"]
  G -->|Stop from a date| I["Slot ends that day;<br/>a slot not started yet is deleted"]
  G -->|Admin locks it| J["Only admin can change it"]
```

## 4. Backup (izin)

```mermaid
flowchart TD
  A(["Host can't make a session"]) --> B{"At least 24 h before?"}
  B -->|No| C["Admin or operator requests it,<br/>any time; may assign a cover at once"]
  B -->|Yes| D["Host requests:<br/>sick, permit or other + optional letter"]
  D --> E{"Named hosts?"}
  E -->|No| F["Open board:<br/>all hosts notified"]
  E -->|Yes, 2 to 5| G["Only the named hosts,<br/>asked by Discord DM"]
  C --> F
  F --> H["A host applies"]
  G --> H
  H --> I{"Can cover? free then, active,<br/>not banned from the brand,<br/>cross-brand quota left,<br/>not rejected for this request"}
  I -->|No| X["Refused with the reason"]
  I -->|Yes| J["Pending; staff notified"]
  J --> K{"Admin or operator"}
  K -->|Reject applicant| L["Applicant told;<br/>reopens if nobody else waits"]
  L --> H
  K -->|Approve| M["Filled"]
  K -->|No decision 30 min before| N["Best applicant auto-approved:<br/>rating, same brand, earliest"]
  N --> M
  N -.->|nobody eligible| O["Staff alerted<br/>to assign by hand"]
  M --> P["Cover's name on the schedule;<br/>both notified; other applicants<br/>told not picked, kept on standby"]
  P --> Q["Cover checks in and reports;<br/>hours paid to the cover"]
  P -->|Cover drops out before start| R["Points penalty;<br/>request reopens"]
  R --> H
```

Cancelling: the requester can cancel until a cover is approved; staff can cancel any time. The cover and anyone still waiting are told.

## 5. Sick letter (surat sakit)

```mermaid
flowchart TD
  A["Backup request, reason: sick"] --> B{"Letter attached<br/>with the request?"}
  B -->|Yes| D["Staff can open the letter<br/>before deciding"]
  B -->|No| C["Host uploads it later"]
  C --> E{"Uploaded within 24 h<br/>after the session starts?"}
  E -->|Yes| D
  E -->|No| F["Points deducted automatically<br/>checked every 10 min"]
```

## 6. Attendance and live report

```mermaid
flowchart TD
  A(["Session in My Schedule"]) --> B["Check-in opens<br/>60 min before start"]
  B --> C["Host checks in"]
  C --> C2{"More than 10 min<br/>after the start?"}
  C2 -->|Yes| C3["Late: Telat points<br/>deducted automatically"]
  C3 --> D
  C2 -->|No| D["Live"]
  D --> E["Host checks out"]
  E --> F["Live report within 24 h:<br/>hours, GMV, orders, viewers"]
  F --> G{"Fits? sent on time, checked out,<br/>hours within 15 min of the slot,<br/>not more than attended"}
  G -->|Yes| H["Approved automatically"]
  G -->|No| I["Flagged; staff notified"]
  I --> J{"Operator reviews"}
  J -->|Approve, hours can be corrected| H
  J -->|Reject with a note| K["Not paid; host notified"]
  H --> L["Paid work session<br/>in the brand's pay period"]
  F -.->|not sent in 24 h| M["Overdue on the dashboard"]
  B -.->|never checked in| N["Missed on the dashboard"]
```

## 7. Special events (PD, double date)

```mermaid
flowchart TD
  A["Operator creates an event for a brand:<br/>dates, daily hours, block length,<br/>max blocks per host"] --> B{"Replaces the<br/>regular schedule?"}
  B -->|Yes| C["That brand's regular slots<br/>don't run those days"]
  B -->|No| D["Runs next to regular slots"]
  C --> E["Hosts of the brand notified"]
  D --> E
  E --> F["Host claims a block<br/>in the Event menu"]
  F --> G{"Allowed? not started, own brand,<br/>under the max, not taken,<br/>host free, brand free"}
  G -->|No| X["Refused with the reason"]
  G -->|Yes| H["Block is theirs"]
  H -->|Host releases before start| I["Block free again"]
  H -->|Operator reassigns| J["Given to another host"]
  H --> K["Check in and report as usual;<br/>paid at the normal rate"]
```

## 8. Points, warning letters (SP) and rating

```mermaid
flowchart TD
  A["Each host starts the period with 100 points<br/>reset every 3 months"] --> B["Point history"]
  C["Operator records a violation<br/>or a brand complaint"] --> D["Points deducted<br/>by violation type"]
  E["Automatic: late check-in, dropped backup,<br/>late or missing sick letter"] --> D
  D --> F["Host told privately:<br/>bell + Discord DM"]
  F --> G{"At or below 75 / 50 / 25?"}
  G -->|Yes| H["SP1 / SP2 / SP3 issued<br/>automatically; host and admins told"]
  G -->|No| B
  H --> B
  I["Admin corrects: void a point entry,<br/>issue or void an SP"] --> B
  J["Admin rates each host monthly, 1 to 5,<br/>with a suggestion from violations"] --> K["Latest rating ranks<br/>backup applicants"]
  B --> L["Admin exports ratings, points<br/>and SP history to Excel"]
```

## 9. Payroll

```mermaid
flowchart TD
  A["Pay period per brand:<br/>starts on payroll start,<br/>runs until the target hours (e.g. 720)"] --> B["Approved hours collect;<br/>finance can add hour adjustments"]
  B --> B2{"Carried-in + worked hours<br/>reach the target?"}
  B2 -->|No| B3{"Brand stopped live?"}
  B3 -->|No| B
  B3 -->|Yes| B4["Admin/finance closes<br/>the period early"]
  B4 --> C
  B2 -->|Yes| C["Period ends on its last session's day;<br/>next period starts the day after;<br/>brand leader (PIC) and finance notified"]
  C --> D{"Reports waiting for review,<br/>sick letters still due, or the<br/>previous period not requested?"}
  D -->|Yes| E["Request blocked<br/>until resolved"]
  E --> D
  D -->|No| F["Brand leader (PIC) requests payment<br/>(finance can on their behalf):<br/>pay frozen at current rates;<br/>carried-in hours paid first, then this period's,<br/>up to the target (billed = paid);<br/>extra hours carry to next period,<br/>cut from every host by the same share"]
  F --> G{"Mistake found?"}
  G -->|Yes| H["Cancel the request with a reason:<br/>period reopens, carry-over undone"]
  H --> C
  G -->|No, brand paid| I["Finance marks paid<br/>(optional transfer reference)"]
  I --> J["Salary slip per host paid this period;<br/>kasbon installment deducted if it fits"]
  J --> K["Host notified,<br/>sees the slip in Pay"]
```

## 10. Kasbon

```mermaid
flowchart TD
  A(["Host asks for kasbon"]) --> A2{"Open kasbon + new one<br/>within the monthly salary?<br/>(weekly slot hours × 52/12 × rate)"}
  A2 -->|No| A3(["Refused"])
  A2 -->|Yes| B["Finance records it:<br/>amount, number of installments"]
  B --> C["Installment schedule"]
  C --> D["Next salary slip, any brand"]
  D --> E{"Installment fits<br/>in the slip?"}
  E -->|Yes| F["Deducted, shown on the slip"]
  E -->|No| G["Skipped, listed on the slip,<br/>waits for the next one"]
  G --> D
  F --> H{"All paid?"}
  H -->|No| D
  H -->|Yes| I(["Kasbon paid"])
  J["Host pays back in cash or transfer"] --> K["Finance: paid back directly;<br/>remaining installments closed"]
  K --> I
  L["Finance reschedules what is owed<br/>over a new number of installments"] --> C
```

A kasbon can be deleted only before any installment is deducted.

## 11. Notifications

```mermaid
flowchart LR
  A["Something happens:<br/>sign-up, backup, report,<br/>SP, slip, event"] --> B["Notifier"]
  B --> C["In-app bell<br/>always"]
  B --> D{"Personal notice and<br/>Discord linked?"}
  D -->|Yes| E["Discord DM"]
  B --> F{"Who else?"}
  F -->|Staff| G["Discord admin channel"]
  F -->|All hosts| H["Discord backups channel"]
  E --> I{"Sent?"}
  G --> I
  H --> I
  I -->|Failed| J["Retried every 5 min"]
```

## 12. Settings, security and audit log

```mermaid
flowchart TD
  A["Admin changes a rule on Settings:<br/>quota, deadlines, points, SP,<br/>2FA, audit retention"] --> B{"Within limits?<br/>SP1 above SP2 above SP3,<br/>all below starting points"}
  B -->|No| A
  B -->|Yes| C["Applies at once everywhere,<br/>including help texts"]
  C --> D["Audit log"]
  E["Sign-ins, approvals, role changes,<br/>2FA events, changes to important records"] --> D
  D --> F["Admin filters the log;<br/>passwords, KTP, bank shown as hidden"]
  D --> G["Entries older than 365 days<br/>deleted nightly"]
```
