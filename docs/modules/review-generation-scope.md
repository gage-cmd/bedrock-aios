# Review Generation — v1 Scope

## Trigger
Manual only. Client initiates a review request from the dashboard. No automated triggers yet (e.g. post-appointment, post-invoice-paid).

## Channel
SMS first, via Twilio. Email is a fast-follow — not required for v1.

## Funnel
1. Customer receives a link via SMS.
2. Customer taps the link and rates 1-5 stars.
3. 4-5 stars: redirect to the tenant's Google review URL.
4. 1-3 stars: show a private feedback form instead. This feedback never goes public.

## Out of scope for v1
- Automated triggers
- Google Business Profile API integration
- Sentiment analysis on feedback text
- Multi-language templates
